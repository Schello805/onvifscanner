import type { ScanResult, VendorUrlResult } from "@/lib/types";
import { fetchWithDigestAuth } from "@/lib/http/digestFetch";
import { probeRtsp } from "@/lib/rtsp/probeRtsp";
import { orderedProfiles } from "@/lib/vendor/cameraProfiles";

export async function probeVendorUrls(args: {
  result: ScanResult;
  timeoutMs: number;
  credentials?: { username: string; password: string };
  signal?: AbortSignal;
}): Promise<VendorUrlResult | undefined> {
  const manufacturer = args.result.onvif?.deviceInformation?.manufacturer;
  const model = args.result.onvif?.deviceInformation?.model;
  const profiles = orderedProfiles(manufacturer, model);
  const httpBase = buildHttpBase(args.result);
  const rtspPort = args.result.rtsp?.port ?? 554;
  const log: string[] = [];
  const rtspUris: string[] = [];
  const httpStreamUris: string[] = [];
  const snapshotUris: string[] = [];
  let matchedProfile = profiles[0]?.label ?? "Vendor-Katalog";

  for (const profile of profiles) {
    if (args.signal?.aborted) throw new Error("Scan abgebrochen.");
    log.push(`Vendor profile: ${profile.label}`);
    let profileHit = false;

    for (const candidate of profile.snapshot) {
      if (snapshotUris.length >= 2) break;
      const url = `${httpBase}${candidate.path}`;
      log.push(`Snapshot probe: ${candidate.label} ${url}`);
      const ok = await probeHttpUrl({
        url,
        purpose: "snapshot",
        timeoutMs: args.timeoutMs,
        credentials: args.credentials,
        signal: args.signal,
        log
      });
      if (ok) {
        snapshotUris.push(url);
        profileHit = true;
        log.push(`Snapshot OK: ${url}`);
      }
    }

    for (const candidate of profile.httpStream) {
      if (httpStreamUris.length >= 2) break;
      const url = `${httpBase}${candidate.path}`;
      log.push(`HTTP stream probe: ${candidate.label} ${url}`);
      const ok = await probeHttpUrl({
        url,
        purpose: "stream",
        timeoutMs: args.timeoutMs,
        credentials: args.credentials,
        signal: args.signal,
        log
      });
      if (ok) {
        httpStreamUris.push(url);
        profileHit = true;
        log.push(`HTTP stream OK: ${url}`);
      }
    }

    for (const candidate of profile.rtsp) {
      if (rtspUris.length >= 2) break;
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
    rtspUris: rtspUris.length ? unique(rtspUris) : undefined,
    httpStreamUris: httpStreamUris.length ? unique(httpStreamUris) : undefined,
    snapshotUris: snapshotUris.length ? unique(snapshotUris) : undefined,
    log: limitLog(log)
  };
}

async function probeHttpUrl(args: {
  url: string;
  purpose: "snapshot" | "stream";
  timeoutMs: number;
  credentials?: { username: string; password: string };
  signal?: AbortSignal;
  log: string[];
}): Promise<boolean> {
  const res = await fetchWithDigestAuth({
    url: args.url,
    method: "GET",
    timeoutMs: Math.min(Math.max(args.timeoutMs, 800), 2200),
    credentials: args.credentials,
    signal: args.signal,
    fastMode: false,
    headers: {
      accept: args.purpose === "snapshot" ? "image/*,*/*;q=0.8" : "multipart/x-mixed-replace,image/*,*/*;q=0.8",
      "user-agent": "ONVIFscanner/0.1"
    }
  });
  args.log.push(`HTTP ${res.status}: ${args.url}`);

  const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
  try {
    await res.body?.cancel();
  } catch {
    // ignore
  }
  if (!res.ok) return false;
  if (args.purpose === "snapshot") {
    return contentType.startsWith("image/") || contentType.includes("jpeg");
  }
  return (
    contentType.startsWith("image/") ||
    contentType.includes("multipart") ||
    contentType.includes("mjpeg") ||
    contentType.includes("octet-stream")
  );
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
