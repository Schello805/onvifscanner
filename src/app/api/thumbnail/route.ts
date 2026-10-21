import { NextResponse } from "next/server";
import { fetchWithDigestAuth } from "@/lib/http/digestFetch";
import { sanitizeUrlString } from "@/lib/util/url";
import { isPrivateIpv4 } from "@/lib/net/ip";
import { prisma } from "@/lib/db";
import { decryptSecret, ENC_PREFIX, MASKED_PASSWORD } from "@/lib/security";
import { getFfmpegHwaccelArgs } from "@/lib/ffmpegHwaccel";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const runtime = "nodejs";

type Body = {
  cameraId?: string;
  url?: string;
  urls?: string[];
  size?: number;
  height?: number;
  quality?: number;
  output?: "jpeg" | "gray";
  timeoutMs?: number;
  fastAuth?: boolean;
  fresh?: boolean;
  preferCaptured?: boolean;
  credentials?: { username: string; password: string };
  credentialsList?: Array<{ username: string; password: string }>;
};

type SharpModule = typeof import("sharp");

let sharpInstance: any | null = null;
let sharpConfigured = false;

async function getSharp(): Promise<any> {
  if (sharpInstance) return sharpInstance;
  const mod = (await import("sharp")) as unknown as SharpModule & { default?: any };
  sharpInstance = (mod as any).default ?? mod;
  return sharpInstance;
}

function configureSharpOnce(sharp: any) {
  if (sharpConfigured) return;
  sharpConfigured = true;
  const concurrency = clampInt(process.env.THUMBNAIL_SHARP_CONCURRENCY ?? 1, 1, 8);
  try {
    sharp.cache(false);
    sharp.concurrency(concurrency);
  } catch {
    // ignore
  }
}

// Simple in-process concurrency guard to avoid overwhelming libvips / Node.
let inFlight = 0;
const waiters: Array<() => void> = [];

async function acquireSlot(max: number, signal?: AbortSignal): Promise<void> {
  if (inFlight < max) {
    inFlight += 1;
    return;
  }
  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Aborted before acquire"));
      return;
    }
    const wake = () => {
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve();
    };
    const onAbort = () => {
      const idx = waiters.indexOf(wake);
      if (idx !== -1) waiters.splice(idx, 1);
      reject(new Error("Aborted while waiting"));
    };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });

    waiters.push(wake);
  });
  inFlight += 1;
}

function releaseSlot() {
  inFlight = Math.max(0, inFlight - 1);
  const next = waiters.shift();
  if (next) next();
}

type CacheEntry = { ts: number; bytes: Buffer; contentType: string; width?: number; height?: number };
const cache = new Map<string, CacheEntry>();
const CACHE_MAX_ENTRIES = clampInt(process.env.THUMBNAIL_CACHE_MAX_ENTRIES ?? 256, 0, 2048);
const latestCameraSnapshots = new Map<string, { ts: number; bytes: Buffer }>();

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  // Fast path: if the caller prefers the exact frame captured during the motion check,
  // return the cached camera snapshot from that exact millisecond without another network round-trip.
  if (body.preferCaptured && body.cameraId) {
    const recent = latestCameraSnapshots.get(body.cameraId);
    if (recent && Date.now() - recent.ts < 8000) {
      try {
        const sharp = await getSharp();
        configureSharpOnce(sharp);
        const quality = clampInt(body.quality ?? 82, 30, 95);
        const size = clampInt(body.size ?? 768, 128, 2560);
        const resized = await sharp(recent.bytes, { limitInputPixels: 32_000_000 })
          .rotate()
          .resize({ width: size, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality })
          .toBuffer({ resolveWithObject: true });
        return new NextResponse(resized.data as unknown as BodyInit, {
          status: 200,
          headers: {
            "content-type": "image/jpeg",
            "cache-control": "no-store",
            "x-image-width": String(resized.info.width),
            "x-image-height": String(resized.info.height),
            "x-captured-frame": "true",
          },
        });
      } catch {
        // Fall back to camera fetch if resizing fails
      }
    }
  }

  const rawUrls: string[] = [];
  if (typeof body.url === "string") rawUrls.push(body.url);
  if (Array.isArray(body.urls)) {
    for (const u of body.urls) {
      if (typeof u === "string") rawUrls.push(u);
    }
  }
  const candidates = Array.from(
    new Set(rawUrls.map((u) => sanitizeUrlString(u)).filter(Boolean))
  ).slice(0, 4);

  if (!candidates.length) {
    return NextResponse.json({ error: "Missing url." }, { status: 400 });
  }

  const parsedCandidates: URL[] = [];
  for (const u of candidates) {
    try {
      parsedCandidates.push(new URL(u));
    } catch {
      // skip invalid
    }
  }
  if (!parsedCandidates.length) {
    return NextResponse.json({ error: "Invalid url." }, { status: 400 });
  }

  for (const url of parsedCandidates) {
    if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "rtsp:") {
      return NextResponse.json({ error: "Only http/https/rtsp allowed." }, { status: 400 });
    }
  }

  // SSRF guard: thumbnails only for private IPv4 hosts unless explicitly allowed.
  const allowPublic = (process.env.ALLOW_PUBLIC_SCAN ?? "false") === "true";
  if (!allowPublic) {
    for (const url of parsedCandidates) {
      if (!isPrivateIpv4(url.hostname)) {
        return NextResponse.json(
          { error: "Public hosts are not allowed for thumbnails." },
          { status: 400 }
        );
      }
    }
  }

  const size = clampInt(body.size ?? 200, 64, 2560);
  const outputHeight = body.height === undefined ? undefined : clampInt(body.height, 36, 2560);
  const quality = clampInt(body.quality ?? 65, 45, 92);
  const outputMode = body.output === "gray" ? "gray" : "jpeg";
  const timeoutMs = clampInt(body.timeoutMs ?? 1500, 300, 8000);
  const fastAuth = body.fastAuth !== false;

  let acquired = false;
  try {
    const maxConcurrency = clampInt(process.env.THUMBNAIL_MAX_CONCURRENCY ?? 2, 1, 8);
    const cacheTtlMs = clampInt(process.env.THUMBNAIL_CACHE_TTL_MS ?? 10_000, 0, 300_000);
    const attemptLog: string[] = [];
    let attempts = 0;
    let authFailures = 0;

    // Resolve masked or server-stored credentials if needed
    let resolvedDirectCreds = body.credentials;
    if (resolvedDirectCreds?.password?.startsWith(ENC_PREFIX)) {
      resolvedDirectCreds = {
        username: resolvedDirectCreds.username,
        password: decryptSecret(resolvedDirectCreds.password),
      };
    } else if (
      body.cameraId ||
      resolvedDirectCreds?.password === MASKED_PASSWORD ||
      !resolvedDirectCreds
    ) {
      try {
        const hostIp = parsedCandidates[0]?.hostname;
        const dbCam = body.cameraId
          ? await prisma.camera.findUnique({
              where: { id: body.cameraId },
              select: { username: true, password: true },
            })
          : hostIp
          ? await prisma.camera.findFirst({
              where: { ip: hostIp },
              select: { username: true, password: true },
            })
          : null;
        if (dbCam?.username) {
          resolvedDirectCreds = {
            username: resolvedDirectCreds?.username || dbCam.username,
            password:
              resolvedDirectCreds &&
              resolvedDirectCreds.password !== MASKED_PASSWORD &&
              resolvedDirectCreds.password !== ""
                ? decryptSecret(resolvedDirectCreds.password)
                : decryptSecret(dbCam.password),
          };
        }
      } catch {
        // ignore DB lookup failure
      }
    }

    const credCandidates: Array<{ username: string; password: string } | undefined> = [];
    if (resolvedDirectCreds?.username || resolvedDirectCreds?.password) {
      if (resolvedDirectCreds.password !== MASKED_PASSWORD) {
        credCandidates.push(resolvedDirectCreds);
      }
    }
    if (body.credentialsList?.length) {
      for (const c of body.credentialsList) {
        const cleanPass = c.password?.startsWith(ENC_PREFIX) ? decryptSecret(c.password) : c.password;
        if (cleanPass === MASKED_PASSWORD) continue;
        if (!credCandidates.some((x) => x?.username === c.username && x?.password === cleanPass)) {
          credCandidates.push({ username: c.username, password: cleanPass });
        }
      }
    }
    if (credCandidates.length === 0) {
      credCandidates.push(undefined);
    }

    await acquireSlot(maxConcurrency, req.signal);
    acquired = true;

    for (const url of parsedCandidates) {
      const cacheKey = `${url.toString()}|s=${size}|h=${outputHeight ?? 0}|q=${quality}|o=${outputMode}|u=${resolvedDirectCreds?.username ?? ""}`;
      const cached = cache.get(cacheKey);
      if (!body.fresh && cached && cacheTtlMs > 0 && Date.now() - cached.ts <= cacheTtlMs) {
        return new NextResponse(cached.bytes as unknown as BodyInit, {
          status: 200,
          headers: {
            "content-type": cached.contentType,
            "cache-control": "no-store",
            "x-thumbnail-source": url.toString(),
            "x-image-width": String(cached.width ?? 0),
            "x-image-height": String(cached.height ?? 0)
          }
        });
      }

      attemptLog.push(`Try: ${url.toString()}`);
      let ab: ArrayBuffer | undefined;
      let contentType = "";

      if (url.protocol === "rtsp:") {
        attemptLog.push("Protocol: RTSP (using ffmpeg)");
        for (const cred of credCandidates) {
          try {
            let rtspUrl = url.toString();
            if (cred?.username) {
              const authUrl = new URL(rtspUrl);
              authUrl.username = cred.username;
              authUrl.password = cred.password ?? "";
              rtspUrl = authUrl.toString();
            }
            const hwArgs = getFfmpegHwaccelArgs();
            const args = [
              "-y",
              ...hwArgs,
              "-rtsp_transport", "tcp",
              "-t", String(Math.ceil(timeoutMs / 1000) + 1),
              "-i", rtspUrl,
              "-vframes", "1",
              "-q:v", "4",
              "-f", "image2",
              "-"
            ];
            let stdout: Buffer | null = null;
            try {
              const res = await execFileAsync("ffmpeg", args, {
                encoding: "buffer",
                timeout: timeoutMs + 2000,
                signal: req.signal as any
              });
              stdout = res.stdout as Buffer;
            } catch (errHw) {
              if (hwArgs.length > 0) {
                // Retry without hwaccel
                const fallbackArgs = [
                  "-y",
                  "-rtsp_transport", "tcp",
                  "-t", String(Math.ceil(timeoutMs / 1000) + 1),
                  "-i", rtspUrl,
                  "-vframes", "1",
                  "-q:v", "4",
                  "-f", "image2",
                  "-"
                ];
                const resFallback = await execFileAsync("ffmpeg", fallbackArgs, {
                  encoding: "buffer",
                  timeout: timeoutMs + 2000,
                  signal: req.signal as any
                });
                stdout = resFallback.stdout as Buffer;
              } else {
                throw errHw;
              }
            }
            if (!stdout || stdout.length === 0) throw new Error("ffmpeg returned empty output");
            ab = stdout.buffer.slice(stdout.byteOffset, stdout.byteOffset + stdout.byteLength) as ArrayBuffer;
            contentType = "image/jpeg";
            attemptLog.push(`Status: ffmpeg success (${cred?.username || "unauth"})`);
            break;
          } catch (e) {
            attemptLog.push(`ffmpeg error (${cred?.username || "unauth"}): ${e instanceof Error ? e.message : "Unknown"}`);
          }
        }
        if (!ab) continue;
      } else {
        const debugLog: string[] = [];
        for (const cred of credCandidates) {
          const res = await fetchWithDigestAuth({
            url: url.toString(),
            method: "GET",
            timeoutMs,
            credentials: cred,
            signal: req.signal,
            fastMode: fastAuth,
            headers: { accept: "image/*", "user-agent": "ONVIFscanner/0.1" },
            debugLog
          });

          attemptLog.push(`Status: ${res.status} (${cred?.username || "unauth"})`);
          attempts += 1;
          if (res.status === 401) {
            authFailures += 1;
            continue;
          }
          for (const line of debugLog.slice(0, 12)) attemptLog.push(line);
          if (!res.ok) continue;

          const cType = (res.headers.get("content-type") ?? "").toLowerCase();
          if (!cType.startsWith("image/")) {
            attemptLog.push("Not an image");
            continue;
          }

          const maxBytes = 6_000_000;
          const contentLength = Number(res.headers.get("content-length") ?? "0");
          if (Number.isFinite(contentLength) && contentLength > maxBytes) {
            attemptLog.push("Too large (content-length)");
            continue;
          }

          const resBuf = await res.arrayBuffer();
          if (resBuf.byteLength <= 0 || resBuf.byteLength > maxBytes) {
            attemptLog.push("Too large (body)");
            continue;
          }
          ab = resBuf;
          contentType = cType;
          break;
        }
        if (!ab) continue;
      }

      const input = Buffer.from(ab);
      if (body.cameraId) {
        latestCameraSnapshots.set(body.cameraId, { ts: Date.now(), bytes: input });
      }
      const sharp = await getSharp();
      configureSharpOnce(sharp);

      let origWidth = 0;
      let origHeight = 0;
      try {
        const meta = await sharp(input).metadata();
        origWidth = meta.width ?? 0;
        origHeight = meta.height ?? 0;
      } catch {
        // ignore
      }

      const pipeline = sharp(input, { limitInputPixels: 32_000_000 }).rotate();
      const { data: output, info: outputInfo } = outputMode === "gray"
        ? await pipeline
            .resize({ width: size, height: outputHeight, fit: outputHeight ? "fill" : "inside" })
            .greyscale()
            .blur(0.5)
            .raw()
            .toBuffer({ resolveWithObject: true })
        : await pipeline
            .resize({ width: size })
            .jpeg({ quality })
            .toBuffer({ resolveWithObject: true });
      const outputContentType = outputMode === "gray" ? "application/octet-stream" : "image/jpeg";
      const responseWidth = outputInfo.width;
      const responseHeight = outputInfo.height;

      cache.set(cacheKey, {
        ts: Date.now(),
        bytes: output,
        contentType: outputContentType,
        width: responseWidth,
        height: responseHeight
      });
      if (CACHE_MAX_ENTRIES > 0 && cache.size > CACHE_MAX_ENTRIES) {
        // Drop the oldest entry (in insertion order) to keep memory bounded.
        const firstKey = cache.keys().next().value as string | undefined;
        if (firstKey) cache.delete(firstKey);
      }

      return new NextResponse(output as unknown as BodyInit, {
        status: 200,
        headers: {
          "content-type": outputContentType,
          "cache-control": "no-store",
          "x-thumbnail-source": url.toString(),
          "x-image-width": String(responseWidth),
          "x-image-height": String(responseHeight)
        }
      });
    }

    return NextResponse.json(
      { error: "No usable image from candidates.", log: attemptLog },
      { status: 200 }
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Thumbnail error" },
      { status: 200 }
    );
  } finally {
    if (acquired) releaseSlot();
  }
}

function clampInt(value: unknown, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return min;
  const i = Math.trunc(n);
  return Math.min(max, Math.max(min, i));
}
