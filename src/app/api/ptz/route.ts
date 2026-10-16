import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isPrivateIpv4 } from "@/lib/net/ip";
import { decryptSecret } from "@/lib/security";
import { onvifSoapCall } from "@/lib/onvif/soap";
import { probeOnvifFromXaddr } from "@/lib/onvif/probeOnvif";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PtzSession = {
  ptzUrls: string[];
  profileToken: string;
  credentials?: { username: string; password: string };
  expiresAt: number;
};

const ptzSessionCache = new Map<string, PtzSession>();

function clampSpeed(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(-1, Math.min(1, num));
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function isSafeCameraHttpUrl(rawUrl: string, cameraIp: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    if (parsed.hostname !== cameraIp) return false;
    const port = parsed.port ? Number(parsed.port) : parsed.protocol === "https:" ? 443 : 80;
    if (!Number.isInteger(port) || port < 1 || port > 65535) return false;
    // Block internal control ports
    if (port === 9997 || port === 3000) return false;
    return true;
  } catch {
    return false;
  }
}

async function resolvePtzSession(camera: {
  id: string;
  ip: string;
  username: string | null;
  password: string | null;
  snapshotUris: string;
}): Promise<PtzSession> {
  const cached = ptzSessionCache.get(camera.id);
  if (cached && cached.expiresAt > Date.now()) {
    return cached;
  }

  const plainPassword = decryptSecret(camera.password);
  const credentials =
    camera.username || plainPassword
      ? { username: camera.username ?? "admin", password: plainPassword }
      : { username: "admin", password: "" };

  // Infer preferred ports from snapshotUris if available
  const ports = new Set<number>([80, 8899, 8000, 2020, 8080]);
  try {
    const snaps = JSON.parse(camera.snapshotUris);
    if (Array.isArray(snaps)) {
      for (const s of snaps) {
        if (typeof s === "string") {
          const u = new URL(s);
          if (u.port) {
            const p = Number(u.port);
            if (p > 0 && p <= 65535 && p !== 9997 && p !== 3000) ports.add(p);
          }
        }
      }
    }
  } catch {
    // ignore
  }

  const xaddrs: string[] = [];
  for (const port of ports) {
    const hostPort = port === 80 ? camera.ip : `${camera.ip}:${port}`;
    xaddrs.push(`http://${hostPort}/onvif/device_service`);
    xaddrs.push(`http://${hostPort}/onvif/devices`);
  }

  const probe = await probeOnvifFromXaddr({
    ip: camera.ip,
    xaddrs,
    timeoutMs: 2200,
    credentials
  });

  const ptzUrls: string[] = [];
  if (probe.ptzServiceUrl && isSafeCameraHttpUrl(probe.ptzServiceUrl, camera.ip)) {
    ptzUrls.push(probe.ptzServiceUrl);
  }
  if (probe.deviceServiceUrl && isSafeCameraHttpUrl(probe.deviceServiceUrl, camera.ip)) {
    try {
      const u = new URL(probe.deviceServiceUrl);
      const base = `${u.protocol}//${u.host}`;
      ptzUrls.push(`${base}/onvif/ptz_service`);
      ptzUrls.push(`${base}/onvif/PTZ`);
      ptzUrls.push(probe.deviceServiceUrl);
    } catch {
      ptzUrls.push(probe.deviceServiceUrl);
    }
  }
  for (const port of [8899, 80, 8000, 2020]) {
    const hostPort = port === 80 ? camera.ip : `${camera.ip}:${port}`;
    ptzUrls.push(`http://${hostPort}/onvif/ptz_service`);
    ptzUrls.push(`http://${hostPort}/onvif/device_service`);
  }

  const uniqueUrls = Array.from(new Set(ptzUrls)).filter((u) => isSafeCameraHttpUrl(u, camera.ip));
  const profileToken =
    probe.rtspUris?.[0]?.profileToken ??
    probe.snapshotUris?.[0]?.profileToken ??
    "000";

  const session: PtzSession = {
    ptzUrls: uniqueUrls,
    profileToken,
    credentials: probe.credentials ?? credentials,
    expiresAt: Date.now() + 15 * 60_000
  };
  ptzSessionCache.set(camera.id, session);
  return session;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      cameraId?: string;
      action?: "move" | "stop";
      x?: number;
      y?: number;
      zoom?: number;
    };

    const cameraId = body.cameraId?.trim();
    if (!cameraId) {
      return NextResponse.json({ error: "Kamera-ID fehlt." }, { status: 400 });
    }

    const camera = await prisma.camera.findUnique({ where: { id: cameraId } });
    if (!camera) {
      return NextResponse.json({ error: "Kamera nicht gefunden." }, { status: 404 });
    }

    const allowPublic = (process.env.ALLOW_PUBLIC_SCAN ?? "false") === "true";
    if (!allowPublic && !isPrivateIpv4(camera.ip)) {
      return NextResponse.json(
        { error: "PTZ ist nur für lokale Netzwerk-Kameras erlaubt." },
        { status: 400 }
      );
    }

    const session = await resolvePtzSession(camera);
    const tokenXml = escapeXml(session.profileToken);
    const actionType = body.action === "stop" ? "stop" : "move";

    let soapAction: string;
    let soapBody: string;

    if (actionType === "stop") {
      soapAction = "http://www.onvif.org/ver20/ptz/wsdl/Stop";
      soapBody = `<tptz:Stop xmlns:tptz="http://www.onvif.org/ver20/ptz/wsdl">
  <tptz:ProfileToken>${tokenXml}</tptz:ProfileToken>
  <tptz:PanTilt>true</tptz:PanTilt>
  <tptz:Zoom>true</tptz:Zoom>
</tptz:Stop>`;
    } else {
      const x = clampSpeed(body.x);
      const y = clampSpeed(body.y);
      const zoom = clampSpeed(body.zoom);
      soapAction = "http://www.onvif.org/ver20/ptz/wsdl/ContinuousMove";
      const panTiltXml =
        x !== 0 || y !== 0
          ? `<tt:PanTilt x="${x.toFixed(2)}" y="${y.toFixed(2)}" xmlns:tt="http://www.onvif.org/ver10/schema" />`
          : "";
      const zoomXml =
        zoom !== 0
          ? `<tt:Zoom x="${zoom.toFixed(2)}" xmlns:tt="http://www.onvif.org/ver10/schema" />`
          : "";
      soapBody = `<tptz:ContinuousMove xmlns:tptz="http://www.onvif.org/ver20/ptz/wsdl">
  <tptz:ProfileToken>${tokenXml}</tptz:ProfileToken>
  <tptz:Velocity>
    ${panTiltXml}
    ${zoomXml}
  </tptz:Velocity>
  <tptz:Timeout>PT2S</tptz:Timeout>
</tptz:ContinuousMove>`;
    }

    let lastStatus = 0;
    for (const url of session.ptzUrls.slice(0, 4)) {
      try {
        const res = await onvifSoapCall({
          url,
          action: soapAction,
          timeoutMs: 1800,
          credentials: session.credentials,
          body: soapBody
        });
        lastStatus = res.status;
        if (res.ok) {
          // Put working URL first for subsequent PTZ commands
          session.ptzUrls = [url, ...session.ptzUrls.filter((u) => u !== url)];
          return NextResponse.json({ ok: true, action: actionType });
        }
      } catch {
        // try next URL
      }
    }

    return NextResponse.json(
      { error: `PTZ-Befehl wurde von der Kamera nicht unterstützt (HTTP ${lastStatus || "Timeout"}).` },
      { status: 502 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "PTZ-Steuerung fehlgeschlagen." },
      { status: 500 }
    );
  }
}
