import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isPrivateIpv4 } from "@/lib/net/ip";
import { decryptSecret } from "@/lib/security";
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
    const body = (await request.json()) as { cameraId?: string; quality?: "main" | "sub" };
    const cameraId = body.cameraId?.trim();
    const preferredQuality = body.quality === "sub" ? "sub" : "main";
    if (!cameraId) return NextResponse.json({ error: "Kamera-ID fehlt." }, { status: 400 });

    const camera = await prisma.camera.findUnique({ where: { id: cameraId } });
    if (!camera) return NextResponse.json({ error: "Kamera wurde nicht gefunden." }, { status: 404 });

    let streamUris: unknown = [];
    try {
      streamUris = JSON.parse(camera.streamUris);
    } catch {
      streamUris = [];
    }
    const rtspCandidates = Array.isArray(streamUris)
      ? streamUris.filter(
          (value): value is string =>
            typeof value === "string" && /^rtsps?:\/\//i.test(value.trim())
        )
      : [];
    if (!rtspCandidates.length) {
      return NextResponse.json({ error: "Für diese Kamera ist keine RTSP-Stream-URL gespeichert." }, { status: 400 });
    }

    const isLikelySubStream = (uri: string, index: number) => {
      const lower = uri.toLowerCase();
      if (
        lower.includes("subtype=1") ||
        lower.includes("/102") ||
        lower.includes("stream2") ||
        lower.includes("stream=1") ||
        lower.includes("_sub") ||
        lower.includes("/sub") ||
        lower.includes("/video2") ||
        lower.includes("/s2/live")
      ) {
        return true;
      }
      return index > 0;
    };

    const orderedCandidates = [...rtspCandidates].sort((a, b) => {
      const idxA = rtspCandidates.indexOf(a);
      const idxB = rtspCandidates.indexOf(b);
      const subA = isLikelySubStream(a, idxA) ? 1 : 0;
      const subB = isLikelySubStream(b, idxB) ? 1 : 0;
      if (preferredQuality === "sub" && subA !== subB) return subB - subA;
      if (preferredQuality === "main" && subA !== subB) return subA - subB;
      return idxA - idxB;
    });

    const allowPublic = (process.env.ALLOW_PUBLIC_SCAN ?? "false") === "true";
    let chosenSource: URL | null = null;
    let chosenCodec: string | null = null;
    let chosenIsSub = false;
    let unsupportedCodecSeen: string | null = null;

    const plainPassword = decryptSecret(camera.password);
    for (const candidate of orderedCandidates) {
      let parsed: URL;
      try {
        parsed = new URL(candidate);
      } catch {
        continue;
      }
      if (parsed.protocol !== "rtsp:" && parsed.protocol !== "rtsps:") continue;
      if (!allowPublic && !isPrivateIpv4(parsed.hostname)) continue;

      if (camera.username) {
        parsed.username = camera.username;
        parsed.password = plainPassword;
      }

      const codec = await probeVideoCodec(parsed.toString());
      if (codec && !["h264", "vp8", "vp9", "av1"].includes(codec)) {
        unsupportedCodecSeen = codec;
        continue;
      }

      chosenSource = parsed;
      chosenCodec = codec;
      chosenIsSub = isLikelySubStream(candidate, rtspCandidates.indexOf(candidate));
      break;
    }

    if (!chosenSource) {
      if (unsupportedCodecSeen) {
        const codecLabel =
          unsupportedCodecSeen === "hevc" || unsupportedCodecSeen === "h265"
            ? "H.265/HEVC"
            : unsupportedCodecSeen.toUpperCase();
        return NextResponse.json(
          {
            error: `${codecLabel} kann auf diesem Gerät nicht zuverlässig als WebRTC wiedergegeben werden. Die Snapshot-Ansicht bleibt aktiv.`,
            code: "UNSUPPORTED_WEBRTC_CODEC",
            codec: unsupportedCodecSeen,
            fallback: "snapshot",
          },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: "Die gespeicherte Stream-URL ist ungültig." }, { status: 400 });
    }

    const pathName = chosenIsSub && rtspCandidates.length > 1 ? `${camera.id}_sub` : `${camera.id}_live`;
    const encodedPath = encodeURIComponent(pathName);
    const config = {
      source: chosenSource.toString(),
      sourceOnDemand: true,
      sourceOnDemandCloseAfter: "30s",
      rtspTransport: "tcp",
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

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
      codec: chosenCodec,
      quality: chosenIsSub ? "sub" : "main",
      whepUrl: `/api/webrtc/${encodeURIComponent(pathName)}/whep`,
      playbackUrl: `/api/webrtc/${encodeURIComponent(pathName)}/?controls=false&muted=true&autoplay=true&playsInline=true`
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Stream konnte nicht vorbereitet werden." },
      { status: 500 }
    );
  }
}
