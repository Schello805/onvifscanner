import { NextResponse } from "next/server";
import { fetchWithDigestAuth } from "@/lib/http/digestFetch";
import { sanitizeUrlString } from "@/lib/util/url";
import { isPrivateIpv4 } from "@/lib/net/ip";

export const runtime = "nodejs";

type Body = {
  url: string;
  size?: number;
  timeoutMs?: number;
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

  const urlStr = typeof body.url === "string" ? sanitizeUrlString(body.url) : "";
  if (!urlStr) return NextResponse.json({ error: "Missing url." }, { status: 400 });

  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    return NextResponse.json({ error: "Invalid url." }, { status: 400 });
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return NextResponse.json({ error: "Only http/https allowed." }, { status: 400 });
  }

  // SSRF guard: thumbnails only for private IPv4 hosts unless explicitly allowed.
  const allowPublic = (process.env.ALLOW_PUBLIC_SCAN ?? "false") === "true";
  if (!allowPublic) {
    if (!isPrivateIpv4(url.hostname)) {
      return NextResponse.json(
        { error: "Public hosts are not allowed for thumbnails." },
        { status: 400 }
      );
    }
  }

  const size = clampInt(body.size ?? 200, 64, 512);
  const timeoutMs = clampInt(body.timeoutMs ?? 1500, 300, 8000);

  let acquired = false;
  try {
    const maxConcurrency = clampInt(process.env.THUMBNAIL_MAX_CONCURRENCY ?? 2, 1, 8);
    const cacheTtlMs = clampInt(process.env.THUMBNAIL_CACHE_TTL_MS ?? 30_000, 0, 300_000);
    const cacheKey = `${url.toString()}|s=${size}|u=${body.credentials?.username ?? ""}`;

    const cached = cache.get(cacheKey);
    if (cached && cacheTtlMs > 0 && Date.now() - cached.ts <= cacheTtlMs) {
      return new NextResponse(cached.bytes as unknown as BodyInit, {
        status: 200,
        headers: { "content-type": cached.contentType, "cache-control": "no-store" }
      });
    }

    await acquireSlot(maxConcurrency);
    acquired = true;
    const res = await fetchWithDigestAuth({
      url: url.toString(),
      method: "GET",
      timeoutMs,
      credentials: body.credentials,
      headers: { accept: "image/*", "user-agent": "ONVIFscanner/0.1" }
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `Upstream status ${res.status}` },
        { status: 502 }
      );
    }

    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    if (!contentType.startsWith("image/")) {
      return NextResponse.json({ error: "Upstream is not an image." }, { status: 502 });
    }

    const maxBytes = 6_000_000;
    const contentLength = Number(res.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      return NextResponse.json({ error: "Image too large." }, { status: 413 });
    }

    const ab = await res.arrayBuffer();
    if (ab.byteLength <= 0 || ab.byteLength > maxBytes) {
      return NextResponse.json({ error: "Image too large." }, { status: 413 });
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
        "cache-control": "no-store"
      }
    });
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
