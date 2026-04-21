import { NextResponse } from "next/server";
import sharp from "sharp";
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

  try {
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
    const output = await sharp(input)
      .rotate()
      .resize(size, size, { fit: "cover" })
      .jpeg({ quality: 65, mozjpeg: true })
      .toBuffer();

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
  }
}

function clampInt(value: unknown, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return min;
  const i = Math.trunc(n);
  return Math.min(max, Math.max(min, i));
}
