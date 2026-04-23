import type { ScanResult, VendorUrlResult } from "@/lib/types";
import { fetchWithDigestAuth } from "@/lib/http/digestFetch";
import { probeRtsp } from "@/lib/rtsp/probeRtsp";
import { VENDOR_CAMERA_PROFILES, orderedProfiles } from "@/lib/vendor/cameraProfiles";

export async function probeVendorUrls(args: {
  result: ScanResult;
  timeoutMs: number;
  credentials?: { username: string; password: string };
  signal?: AbortSignal;
}): Promise<VendorUrlResult | undefined> {
  const manufacturer = args.result.onvif?.deviceInformation?.manufacturer;
  const model = args.result.onvif?.deviceInformation?.model;
  const hasVendorHint = Boolean(manufacturer || model);
  const profiles = chooseProfiles(args.result, manufacturer, model, hasVendorHint);
  const httpBase = buildHttpBase(args.result);
  const rtspPort = args.result.rtsp?.port ?? 554;
  const log: string[] = [];
  const rtspUris: string[] = [];
  const httpStreamUris: string[] = [];
  const snapshotUris: string[] = [];
  let deviceInformation: VendorUrlResult["deviceInformation"];
  const deadlineAt = Date.now() + clampInt(process.env.VENDOR_PROBE_CAMERA_BUDGET_MS ?? "2500", 900, 8000);
  let matchedProfile = "Vendor-Katalog";

  for (const profile of profiles) {
    if (args.signal?.aborted) throw new Error("Scan abgebrochen.");
    if (Date.now() >= deadlineAt) {
      log.push("Vendor probe: Zeitbudget erreicht.");
      break;
    }
    log.push(`Vendor profile: ${profile.label}`);
    let profileHit = false;

    if (profile.id === "hikvision") {
      const isapiInfo = await probeHikvisionDeviceInfo({
        httpBase,
        timeoutMs: args.timeoutMs,
        credentials: args.credentials,
        signal: args.signal,
        log
      });
      if (isapiInfo.exists) {
        profileHit = true;
        matchedProfile = profile.label;
        deviceInformation = {
          manufacturer: "Hikvision",
          model: isapiInfo.model,
          hostname: isapiInfo.hostname
        };
      }
    }

    for (const candidate of profile.snapshot.slice(0, 2)) {
      if (snapshotUris.length >= 1 || Date.now() >= deadlineAt) break;
      const url = `${httpBase}${candidate.path}`;
      log.push(`Snapshot probe: ${candidate.label} ${url}`);
      const probe = await probeHttpUrl({
        url: withReolinkQueryCredentials(url, args.credentials),
        purpose: "snapshot",
        timeoutMs: args.timeoutMs,
        credentials: args.credentials,
        signal: args.signal,
        log
      });
      if (probe.ok || (profile.id === "hikvision" && probe.exists)) {
        snapshotUris.push(withReolinkQueryCredentials(url, args.credentials));
        profileHit = true;
        log.push(`${probe.ok ? "Snapshot OK" : "Snapshot endpoint exists"}: ${url}`);
      }
    }

    for (const candidate of profile.httpStream.slice(0, 1)) {
      if (httpStreamUris.length >= 1 || Date.now() >= deadlineAt) break;
      const url = `${httpBase}${candidate.path}`;
      log.push(`HTTP stream probe: ${candidate.label} ${url}`);
      const probe = await probeHttpUrl({
        url: withReolinkQueryCredentials(url, args.credentials),
        purpose: "stream",
        timeoutMs: args.timeoutMs,
        credentials: args.credentials,
        signal: args.signal,
        log
      });
      if (probe.ok || (profile.id === "hikvision" && probe.exists)) {
        httpStreamUris.push(withReolinkQueryCredentials(url, args.credentials));
        profileHit = true;
        log.push(`${probe.ok ? "HTTP stream OK" : "HTTP stream endpoint exists"}: ${url}`);
      }
    }

    for (const candidate of profile.rtsp.slice(0, 2)) {
      if (rtspUris.length >= 2 || Date.now() >= deadlineAt) break;
      const url = `rtsp://${args.result.ip}:${rtspPort}${candidate.path}`;
      log.push(`RTSP probe: ${candidate.label} ${url}`);
      const rtsp = await probeRtsp({
        ip: args.result.ip,
        port: rtspPort,
        uri: url,
        timeoutMs: args.timeoutMs,
        credentials: args.credentials
      });
      log.push(...(rtsp.log ?? []).slice(0, 8));
      if (rtsp.ok) {
        rtspUris.push(rtsp.uriTried ?? url);
        profileHit = true;
        log.push(`RTSP OK: ${rtsp.uriTried ?? url}`);
      }
    }

    if (profile.id === "hikvision" && profileHit && !rtspUris.length) {
      rtspUris.push(`rtsp://${args.result.ip}:${rtspPort}/Streaming/Channels/101`);
      rtspUris.push(`rtsp://${args.result.ip}:${rtspPort}/Streaming/Channels/102`);
      log.push("RTSP: Hikvision Standardpfade anhand ISAPI-Erkennung übernommen.");
    }

    if (profileHit) {
      matchedProfile = profile.label;
      if (snapshotUris.length && (rtspUris.length || httpStreamUris.length)) break;
    }
  }

  if (!snapshotUris.length && !rtspUris.length && !httpStreamUris.length) {
    log.push("Vendor probe: keine passende URL gefunden.");
    return { profile: matchedProfile, log: limitLog(log) };
  }

  return {
    profile: matchedProfile,
    deviceInformation,
    rtspUris: rtspUris.length ? unique(rtspUris) : undefined,
    httpStreamUris: httpStreamUris.length ? unique(httpStreamUris) : undefined,
    snapshotUris: snapshotUris.length ? unique(snapshotUris) : undefined,
    log: limitLog(log)
  };
}

function chooseProfiles(
  result: ScanResult,
  manufacturer?: string,
  model?: string,
  hasVendorHint?: boolean
) {
  const ordered = orderedProfiles(manufacturer, model);
  if (hasVendorHint) return ordered.slice(0, 2);

  const xaddrText = [
    result.onvif?.deviceServiceUrl,
    ...(result.onvif?.xaddrs ?? [])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (xaddrText.includes(":8000/")) {
    const reolink = VENDOR_CAMERA_PROFILES.find((p) => p.id === "reolink");
    const hikvision = VENDOR_CAMERA_PROFILES.find((p) => p.id === "hikvision");
    return [reolink, hikvision].filter((p): p is NonNullable<typeof p> => Boolean(p)).slice(0, 2);
  }

  return ordered.filter((p) => p.id !== "reolink").slice(0, 1);
}

function withReolinkQueryCredentials(
  url: string,
  credentials?: { username: string; password: string }
): string {
  if (!credentials?.username) return url;
  if (!url.includes("/cgi-bin/api.cgi") && !url.includes("/flv?")) return url;
  try {
    const u = new URL(url);
    if (!u.searchParams.has("user")) u.searchParams.set("user", credentials.username);
    if (!u.searchParams.has("password")) u.searchParams.set("password", credentials.password);
    return u.toString();
  } catch {
    return url;
  }
}

async function probeHttpUrl(args: {
  url: string;
  purpose: "snapshot" | "stream";
  timeoutMs: number;
  credentials?: { username: string; password: string };
  signal?: AbortSignal;
  log: string[];
}): Promise<{ ok: boolean; exists: boolean; status?: number }> {
  let res: Response;
  try {
    res = await fetchWithDigestAuth({
      url: args.url,
      method: "GET",
      timeoutMs: Math.min(Math.max(args.timeoutMs, 500), 800),
      credentials: args.credentials,
      signal: args.signal,
      fastMode: false,
      headers: {
        accept: args.purpose === "snapshot" ? "image/*,*/*;q=0.8" : "multipart/x-mixed-replace,image/*,*/*;q=0.8",
        "user-agent": "ONVIFscanner/0.1"
      }
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    args.log.push(`HTTP failed: ${args.url} (${message})`);
    return { ok: false, exists: false };
  }

  args.log.push(`HTTP ${res.status}: ${args.url}`);
  const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
  try {
    await res.body?.cancel();
  } catch {
    // ignore
  }
  const exists = res.ok || res.status === 401 || res.status === 403;
  if (!res.ok) return { ok: false, exists, status: res.status };
  if (args.purpose === "snapshot") {
    return {
      ok: contentType.startsWith("image/") || contentType.includes("jpeg"),
      exists,
      status: res.status
    };
  }
  return {
    ok:
      contentType.startsWith("image/") ||
      contentType.includes("multipart") ||
      contentType.includes("mjpeg") ||
      contentType.includes("octet-stream"),
    exists,
    status: res.status
  };
}

async function probeHikvisionDeviceInfo(args: {
  httpBase: string;
  timeoutMs: number;
  credentials?: { username: string; password: string };
  signal?: AbortSignal;
  log: string[];
}): Promise<{ exists: boolean; model?: string; hostname?: string }> {
  const url = `${args.httpBase}/ISAPI/System/deviceInfo`;
  args.log.push(`DeviceInfo probe: ${url}`);
  try {
    const res = await fetchWithDigestAuth({
      url,
      method: "GET",
      timeoutMs: Math.min(Math.max(args.timeoutMs, 700), 1400),
      credentials: args.credentials,
      signal: args.signal,
      fastMode: false,
      headers: {
        accept: "application/xml,text/xml,*/*;q=0.8",
        "user-agent": "ONVIFscanner/0.1"
      }
    });
    args.log.push(`DeviceInfo HTTP ${res.status}: ${url}`);
    const exists = res.ok || res.status === 401 || res.status === 403;
    if (!res.ok) return { exists };
    const text = await res.text();
    return {
      exists,
      model: extractXmlText(text, "model") ?? extractXmlText(text, "deviceModel"),
      hostname: extractXmlText(text, "deviceName") ?? extractXmlText(text, "hostName")
    };
  } catch (e) {
    args.log.push(`DeviceInfo failed: ${e instanceof Error ? e.message : String(e)}`);
    return { exists: false };
  }
}

function extractXmlText(xml: string, tag: string): string | undefined {
  const re = new RegExp(`<(?:[A-Za-z0-9_]+:)?${tag}[^>]*>([^<]+)</(?:[A-Za-z0-9_]+:)?${tag}>`, "i");
  const value = re.exec(xml)?.[1]?.trim();
  return value || undefined;
}

function buildHttpBase(result: ScanResult): string {
  const xaddr = result.onvif?.deviceServiceUrl ?? result.onvif?.xaddrs?.[0];
  if (xaddr) {
    try {
      const u = new URL(xaddr);
      return `${u.protocol}//${u.host}`;
    } catch {
      // fallback below
    }
  }
  const httpPort = result.openTcpPorts?.find((p) => [80, 8080, 8000].includes(p));
  if (!httpPort || httpPort === 80) return `http://${result.ip}`;
  return `http://${result.ip}:${httpPort}`;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function limitLog(lines: string[]): string[] {
  const max = 100;
  if (lines.length <= max) return lines;
  return [...lines.slice(0, 35), `... (${lines.length - 70} more) ...`, ...lines.slice(-34)];
}

function clampInt(value: unknown, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return min;
  const i = Math.trunc(n);
  return Math.min(max, Math.max(min, i));
}
