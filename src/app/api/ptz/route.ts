import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isPrivateIpv4 } from "@/lib/net/ip";
import { decryptSecret } from "@/lib/security";
import { onvifSoapCall } from "@/lib/onvif/soap";
import { extractCapabilityXAddr, extractProfiles } from "@/lib/onvif/probeOnvif";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PtzSession = {
  ptzUrls: string[];
  profileToken: string;
  alternativeTokens?: string[];
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

function extractPortFromUrl(raw: string): number | undefined {
  try {
    const u = new URL(raw);
    if (u.port) {
      const p = Number(u.port);
      if (p > 0 && p <= 65535 && p !== 9997 && p !== 3000) return p;
    }
  } catch {
    // ignore
  }
  return undefined;
}

function normalizeServiceUrl(rawUrl: string, ip: string, defaultPort: number): string | undefined {
  try {
    const u = new URL(rawUrl);
    u.hostname = ip;
    if (!u.port && defaultPort !== 80) {
      u.port = String(defaultPort);
    }
    return u.toString();
  } catch {
    return undefined;
  }
}

async function resolvePtzSession(camera: {
  id: string;
  ip: string;
  username: string | null;
  password: string | null;
  snapshotUris: string;
  streamUris?: string;
  manufacturer?: string | null;
  model?: string | null;
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

  // 1. Extract preferred ports directly from camera's stored snapshot and stream URLs
  const preferredPorts: number[] = [];
  try {
    const snaps = JSON.parse(camera.snapshotUris || "[]");
    if (Array.isArray(snaps)) {
      for (const s of snaps) {
        if (typeof s === "string") {
          const p = extractPortFromUrl(s);
          if (p && !preferredPorts.includes(p)) preferredPorts.push(p);
        }
      }
    }
  } catch {
    // ignore
  }

  try {
    const streams = JSON.parse(camera.streamUris || "[]");
    if (Array.isArray(streams)) {
      for (const s of streams) {
        if (typeof s === "string") {
          const p = extractPortFromUrl(s);
          if (p && p !== 554 && !preferredPorts.includes(p)) preferredPorts.push(p);
        }
      }
    }
  } catch {
    // ignore
  }

  // 2. Vendor port hints based on manufacturer or model
  const mfg = `${camera.manufacturer ?? ""} ${camera.model ?? ""}`.toLowerCase();
  const vendorPorts: number[] = [];
  if (mfg.includes("hikvision") || mfg.includes("ezviz") || mfg.includes("safire") || mfg.includes("reolink")) {
    vendorPorts.push(8000, 80);
  } else if (mfg.includes("tapo") || mfg.includes("tp-link")) {
    vendorPorts.push(2020, 80);
  } else if (mfg.includes("xiongmai") || mfg.includes("xm") || mfg.includes("besder")) {
    vendorPorts.push(8899, 80);
  } else if (mfg.includes("dahua") || mfg.includes("amcrest") || mfg.includes("imou")) {
    vendorPorts.push(80, 8080);
  }

  const candidatePorts = Array.from(
    new Set([...preferredPorts, ...vendorPorts, 80, 8899, 8000, 2020, 8080, 5000])
  );

  let detectedWorkingPort: number | undefined;
  let resolvedPtzUrl: string | undefined;
  let resolvedMediaUrl: string | undefined;
  const ptzUrls: string[] = [];
  let foundTokens: string[] = [];

  // 3. Fast probe candidate ports with GetCapabilities (1200ms per port)
  for (const port of candidatePorts.slice(0, 6)) {
    const hostPort = port === 80 ? camera.ip : `${camera.ip}:${port}`;
    const deviceUrl = `http://${hostPort}/onvif/device_service`;

    try {
      const caps = await onvifSoapCall({
        url: deviceUrl,
        action: "http://www.onvif.org/ver10/device/wsdl/GetCapabilities",
        timeoutMs: 1200,
        credentials,
        body: `<tds:GetCapabilities xmlns:tds="http://www.onvif.org/ver10/device/wsdl"><tds:Category>All</tds:Category></tds:GetCapabilities>`
      });

      if (caps.ok && caps.text) {
        detectedWorkingPort = port;
        const ptzRaw = extractCapabilityXAddr(caps.text, "PTZ");
        const mediaRaw =
          extractCapabilityXAddr(caps.text, "Media") ||
          extractCapabilityXAddr(caps.text, "Media2");

        if (ptzRaw) {
          const norm = normalizeServiceUrl(ptzRaw, camera.ip, port);
          if (norm && isSafeCameraHttpUrl(norm, camera.ip)) {
            resolvedPtzUrl = norm;
          }
        }
        if (mediaRaw) {
          resolvedMediaUrl = normalizeServiceUrl(mediaRaw, camera.ip, port);
        }
        break;
      }
    } catch {
      // try next port
    }
  }

  // 4. Query profile tokens if working port or media URL was found
  const workingPort = detectedWorkingPort ?? candidatePorts[0] ?? 80;
  const hostPort = workingPort === 80 ? camera.ip : `${camera.ip}:${workingPort}`;
  const profileProbeUrl = resolvedMediaUrl || `http://${hostPort}/onvif/device_service`;

  try {
    const profRes = await onvifSoapCall({
      url: profileProbeUrl,
      action: "http://www.onvif.org/ver10/media/wsdl/GetProfiles",
      timeoutMs: 1200,
      credentials,
      body: `<trt:GetProfiles xmlns:trt="http://www.onvif.org/ver10/media/wsdl" />`
    });
    if (profRes.ok && profRes.text) {
      const parsed = extractProfiles(profRes.text);
      foundTokens = parsed.map((p) => p.token).filter(Boolean) as string[];
    }
  } catch {
    // ignore
  }

  // 5. Build prioritized PTZ URLs
  if (resolvedPtzUrl) {
    ptzUrls.push(resolvedPtzUrl);
  }
  ptzUrls.push(`http://${hostPort}/onvif/ptz_service`);
  ptzUrls.push(`http://${hostPort}/onvif/PTZ`);
  ptzUrls.push(`http://${hostPort}/onvif/device_service`);

  // Add fallbacks on other likely ports
  for (const port of candidatePorts.filter((p) => p !== workingPort).slice(0, 3)) {
    const hp = port === 80 ? camera.ip : `${camera.ip}:${port}`;
    ptzUrls.push(`http://${hp}/onvif/ptz_service`);
    ptzUrls.push(`http://${hp}/onvif/PTZ`);
  }

  const uniqueUrls = Array.from(new Set(ptzUrls)).filter((u) => isSafeCameraHttpUrl(u, camera.ip));
  const primaryToken = foundTokens[0] || "Profile_1";
  const alternativeTokens = Array.from(
    new Set([...foundTokens.slice(1), "profile_1", "000", "01", "token1"])
  ).filter((t) => t !== primaryToken);

  const session: PtzSession = {
    ptzUrls: uniqueUrls,
    profileToken: primaryToken,
    alternativeTokens,
    credentials,
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
    const actionType = body.action === "stop" ? "stop" : "move";
    const x = clampSpeed(body.x);
    const y = clampSpeed(body.y);
    const zoom = clampSpeed(body.zoom);

    const buildSoap = (token: string) => {
      const tokenXml = escapeXml(token);
      if (actionType === "stop") {
        return {
          action: "http://www.onvif.org/ver20/ptz/wsdl/Stop",
          body: `<tptz:Stop xmlns:tptz="http://www.onvif.org/ver20/ptz/wsdl">
  <tptz:ProfileToken>${tokenXml}</tptz:ProfileToken>
  <tptz:PanTilt>true</tptz:PanTilt>
  <tptz:Zoom>true</tptz:Zoom>
</tptz:Stop>`
        };
      }
      const panTiltXml =
        x !== 0 || y !== 0
          ? `<tt:PanTilt x="${x.toFixed(2)}" y="${y.toFixed(2)}" xmlns:tt="http://www.onvif.org/ver10/schema" />`
          : "";
      const zoomXml =
        zoom !== 0
          ? `<tt:Zoom x="${zoom.toFixed(2)}" xmlns:tt="http://www.onvif.org/ver10/schema" />`
          : "";
      return {
        action: "http://www.onvif.org/ver20/ptz/wsdl/ContinuousMove",
        body: `<tptz:ContinuousMove xmlns:tptz="http://www.onvif.org/ver20/ptz/wsdl">
  <tptz:ProfileToken>${tokenXml}</tptz:ProfileToken>
  <tptz:Velocity>
    ${panTiltXml}
    ${zoomXml}
  </tptz:Velocity>
</tptz:ContinuousMove>`
      };
    };

    let lastStatus = 0;
    const tokensToTry = [session.profileToken, ...(session.alternativeTokens ?? [])];

    for (const token of tokensToTry.slice(0, 3)) {
      const { action: soapAction, body: soapBody } = buildSoap(token);

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
            // Put working URL and token first for subsequent PTZ commands
            session.ptzUrls = [url, ...session.ptzUrls.filter((u) => u !== url)];
            session.profileToken = token;
            ptzSessionCache.set(camera.id, session);
            return NextResponse.json({ ok: true, action: actionType });
          }
        } catch {
          // try next URL
        }
      }
    }

    // Invalidate cache on total failure so next click re-probes cleanly
    ptzSessionCache.delete(camera.id);

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
