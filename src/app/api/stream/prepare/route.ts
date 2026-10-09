import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isPrivateIpv4 } from "@/lib/net/ip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MEDIA_MTX_API = process.env.MEDIAMTX_API_URL ?? "http://127.0.0.1:9997";

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
      playbackUrl: `/api/webrtc/${encodeURIComponent(pathName)}/?controls=false&muted=true&autoplay=true&playsInline=true`
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Stream konnte nicht vorbereitet werden." },
      { status: 500 }
    );
  }
}
