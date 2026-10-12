import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isPrivateIpv4 } from "@/lib/net/ip";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MEDIA_MTX_API = process.env.MEDIAMTX_API_URL ?? "http://127.0.0.1:9997";
const execFileAsync = promisify(execFile);
const codecCache = new Map<string, { codec: string | null; expiresAt: number }>();

async function probeVideoCodec(source: string): Promise<string | null> {
  const cached = codecCache.get(source);
  if (cached && cached.expiresAt > Date.now()) return cached.codec;

  let codec: string | null = null;
  try {
    const result = await execFileAsync("ffprobe", [
      "-v", "error",
      "-rtsp_transport", "tcp",
      "-rw_timeout", "5000000",
      "-select_streams", "v:0",
      "-show_entries", "stream=codec_name",
      "-of", "default=noprint_wrappers=1:nokey=1",
      source,
    ], { timeout: 7_000, maxBuffer: 64 * 1024 });
    codec = String(result.stdout || "").trim().toLowerCase() || null;
  } catch {}

  codecCache.set(source, { codec, expiresAt: Date.now() + 30 * 60_000 });
  return codec;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { cameraId?: string };
    const cameraId = body.cameraId?.trim();
    if (!cameraId) return NextResponse.json({ error: "Kamera-ID fehlt." }, { status: 400 });

    const camera = await prisma.camera.findUnique({ where: { id: cameraId } });
    if (!camera) return NextResponse.json({ error: "Kamera wurde nicht gefunden." }, { status: 404 });

    let streamUris: unknown = [];
    try {
      streamUris = JSON.parse(camera.streamUris);
    } catch {
      streamUris = [];
    }
    const streamUri = Array.isArray(streamUris)
      ? streamUris.find((value): value is string =>
          typeof value === "string" && /^rtsps?:\/\//i.test(value.trim())
        )
      : undefined;
    if (!streamUri) {
      return NextResponse.json({ error: "Für diese Kamera ist keine RTSP-Stream-URL gespeichert." }, { status: 400 });
    }

    let source: URL;
    try {
      source = new URL(streamUri);
    } catch {
      return NextResponse.json({ error: "Die gespeicherte Stream-URL ist ungültig." }, { status: 400 });
    }
    if (source.protocol !== "rtsp:" && source.protocol !== "rtsps:") {
      return NextResponse.json({ error: "Live-Ansicht unterstützt derzeit RTSP-Streams." }, { status: 400 });
    }
    if ((process.env.ALLOW_PUBLIC_SCAN ?? "false") !== "true" && !isPrivateIpv4(source.hostname)) {
      return NextResponse.json({ error: "Die Stream-URL muss auf eine private Netzwerkadresse zeigen." }, { status: 400 });
    }

    if (camera.username) {
      source.username = camera.username;
      source.password = camera.password ?? "";
    }

    const codec = await probeVideoCodec(source.toString());
    if (codec && !["h264", "vp8", "vp9", "av1"].includes(codec)) {
      const codecLabel = codec === "hevc" || codec === "h265" ? "H.265/HEVC" : codec.toUpperCase();
      return NextResponse.json(
        {
          error: `${codecLabel} kann auf diesem Gerät nicht zuverlässig als WebRTC wiedergegeben werden. Die Snapshot-Ansicht bleibt aktiv.`,
          code: "UNSUPPORTED_WEBRTC_CODEC",
          codec,
          fallback: "snapshot",
        },
        { status: 409 }
      );
    }

    const pathName = camera.id;
    const encodedPath = encodeURIComponent(pathName);
    const config = { source: source.toString(), sourceOnDemand: true, rtspTransport: "tcp" };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);

    try {
      const existing = await fetch(`${MEDIA_MTX_API}/v3/config/paths/get/${encodedPath}`, {
        cache: "no-store",
        signal: controller.signal
      });
      const endpoint = existing.ok
        ? `${MEDIA_MTX_API}/v3/config/paths/patch/${encodedPath}`
        : `${MEDIA_MTX_API}/v3/config/paths/add/${encodedPath}`;
      const response = await fetch(endpoint, {
        method: existing.ok ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(config),
        signal: controller.signal
      });
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 300);
        throw new Error(`MediaMTX HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
      }
    } catch (error) {
      const detail = error instanceof Error && error.name === "AbortError"
        ? "Zeitüberschreitung"
        : error instanceof Error ? error.message : "unbekannter Fehler";
      return NextResponse.json(
        { error: `Live-Streaming-Dienst ist nicht erreichbar (${detail}).` },
        { status: 503 }
      );
    } finally {
      clearTimeout(timeout);
    }

    return NextResponse.json({
      ok: true,
      codec,
      playbackUrl: `/api/webrtc/${encodeURIComponent(pathName)}/?controls=false&muted=true&autoplay=true&playsInline=true`
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Stream konnte nicht vorbereitet werden." },
      { status: 500 }
    );
  }
}
