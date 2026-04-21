import { NextResponse } from "next/server";
import { fetchWithDigestAuth } from "@/lib/http/digestFetch";
import { sanitizeUrlString } from "@/lib/util/url";
import { isPrivateIpv4 } from "@/lib/net/ip";

export const runtime = "nodejs";

type Body = {
  url?: string;
  urls?: string[];
  size?: number;
  timeoutMs?: number;
  fastAuth?: boolean;
  credentials?: { username: string; password: string };
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
  const concurrency = clampInt(process.env.THUMBNAIL_SHARP_CONCURRENCY ?? 2, 1, 8);
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

async function acquireSlot(max: number): Promise<void> {
  if (inFlight < max) {
    inFlight += 1;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  inFlight += 1;
}

function releaseSlot() {
  inFlight = Math.max(0, inFlight - 1);
  const next = waiters.shift();
  if (next) next();
}

type CacheEntry = { ts: number; bytes: Buffer; contentType: string };
const cache = new Map<string, CacheEntry>();
const CACHE_MAX_ENTRIES = clampInt(process.env.THUMBNAIL_CACHE_MAX_ENTRIES ?? 256, 0, 2048);

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
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
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return NextResponse.json({ error: "Only http/https allowed." }, { status: 400 });
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

  const size = clampInt(body.size ?? 200, 64, 512);
  const timeoutMs = clampInt(body.timeoutMs ?? 1500, 300, 8000);
  const fastAuth = body.fastAuth !== false;

  let acquired = false;
  try {
    const maxConcurrency = clampInt(process.env.THUMBNAIL_MAX_CONCURRENCY ?? 2, 1, 8);
    const cacheTtlMs = clampInt(process.env.THUMBNAIL_CACHE_TTL_MS ?? 30_000, 0, 300_000);
    const attemptLog: string[] = [];

    await acquireSlot(maxConcurrency);
    acquired = true;

    for (const url of parsedCandidates) {
      const cacheKey = `${url.toString()}|s=${size}|u=${body.credentials?.username ?? ""}`;
      const cached = cache.get(cacheKey);
      if (cached && cacheTtlMs > 0 && Date.now() - cached.ts <= cacheTtlMs) {
        return new NextResponse(cached.bytes as unknown as BodyInit, {
          status: 200,
          headers: {
            "content-type": cached.contentType,
            "cache-control": "no-store",
            "x-thumbnail-source": url.toString()
          }
        });
      }

      attemptLog.push(`Try: ${url.toString()}`);
      if (body.credentials?.username) {
        attemptLog.push(`Creds: username=${body.credentials.username}`);
      } else {
        attemptLog.push("Creds: none");
      }
      const debugLog: string[] = [];
      const res = await fetchWithDigestAuth({
        url: url.toString(),
        method: "GET",
        timeoutMs,
        credentials: body.credentials,
        signal: req.signal,
        fastMode: fastAuth,
        headers: { accept: "image/*", "user-agent": "ONVIFscanner/0.1" },
        debugLog
      });

      attemptLog.push(`Status: ${res.status}`);
      const www = res.headers.get("www-authenticate");
      if (res.status === 401 && www && /digest/i.test(www) && !body.credentials?.username) {
        attemptLog.push("Hinweis: Digest auth nötig (Credentials fehlen).");
      }
      for (const line of debugLog.slice(0, 12)) attemptLog.push(line);
      if (!res.ok) continue;

      const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
      if (!contentType.startsWith("image/")) {
        attemptLog.push("Not an image");
        continue;
      }

      const maxBytes = 6_000_000;
      const contentLength = Number(res.headers.get("content-length") ?? "0");
      if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        attemptLog.push("Too large (content-length)");
        continue;
      }

      const ab = await res.arrayBuffer();
      if (ab.byteLength <= 0 || ab.byteLength > maxBytes) {
        attemptLog.push("Too large (body)");
        continue;
      }

      const input = Buffer.from(ab);
      const sharp = await getSharp();
      configureSharpOnce(sharp);

      const output = await sharp(input, { limitInputPixels: 32_000_000 })
        .rotate()
        .resize(size, size, { fit: "cover" })
        .jpeg({ quality: 65, mozjpeg: true })
        .toBuffer();

      cache.set(cacheKey, { ts: Date.now(), bytes: output, contentType: "image/jpeg" });
      if (CACHE_MAX_ENTRIES > 0 && cache.size > CACHE_MAX_ENTRIES) {
        // Drop the oldest entry (in insertion order) to keep memory bounded.
        const firstKey = cache.keys().next().value as string | undefined;
        if (firstKey) cache.delete(firstKey);
      }

      return new NextResponse(output as unknown as BodyInit, {
        status: 200,
        headers: {
          "content-type": "image/jpeg",
          "cache-control": "no-store",
          "x-thumbnail-source": url.toString()
        }
      });
    }

    return NextResponse.json(
      { error: "No usable image from candidates.", log: attemptLog },
      { status: 502 }
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Thumbnail error" },
      { status: 500 }
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
