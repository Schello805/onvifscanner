import type { ParsedScanRequest } from "@/lib/scan/validation";
import type { ScanResponse, ScanResult } from "@/lib/types";
import { wsDiscoveryProbe } from "@/lib/wsdiscovery/wsDiscovery";
import { expandCidr } from "@/lib/net/ip";
import { mapLimit } from "@/lib/util/mapLimit";
import { scanTcpPorts } from "@/lib/scan/tcpScan";
import { probeRtsp } from "@/lib/rtsp/probeRtsp";
import { probeOnvifFromXaddr } from "@/lib/onvif/probeOnvif";
import { buildRtspCandidates } from "@/lib/rtsp/candidates";
import { probeVendorUrls } from "@/lib/vendor/probeVendorUrls";
import { reverseHostname } from "@/lib/net/hostname";
import { getArpTable, lookupVendorByMac } from "@/lib/net/arp";

type Phase =
  | "onvif"
  | "rtsp"
  | "cidr"
  | "discovery"
  | "vendor";

export type PhaseEvent =
  | { type: "phase"; phase: Phase; status: "start" | "done"; message?: string }
  | { type: "progress"; phase: Phase; done: number; total: number; message?: string }
  | { type: "item"; item: ScanResult };

export async function runScan(
  req: ParsedScanRequest,
  opts?: { signal?: AbortSignal; onPhase?: (ev: PhaseEvent) => void }
): Promise<ScanResponse> {
  const startedAt = new Date();

  const warnings: string[] = [];
  const results: ScanResult[] = [];
  const onPhase = opts?.onPhase;
  const signal = opts?.signal;

  function throwIfAborted() {
    if (signal?.aborted) throw new Error("Scan abgebrochen.");
  }

  if (req.preset === "ws-discovery" || req.preset === "auto") {
    onPhase?.({ type: "phase", phase: "discovery", status: "start", message: "WS-Discovery im Netzwerk…" });
    const discoveryTimeoutMs = clampInt(
      process.env.WS_DISCOVERY_TIMEOUT_MS ?? "4000",
      500,
      15000
    );
    const found = await wsDiscoveryProbe({
      discoveryTimeoutMs,
      timeoutMs: req.timeoutMs,
      deepProbe: req.deepProbe,
      credentials: req.credentials,
      signal,
      onProgress(done, total) {
        onPhase?.({ type: "progress", phase: "onvif", done, total, message: `ONVIF Analyse: ${done}/${total}` });
      },
      onPhase(ev) {
        onPhase?.(ev);
      }
    });

    for (const r of found) {
      finalizeCameraResult(r);
      onPhase?.({ type: "item", item: r });
    }
    results.push(...found);
    onPhase?.({ type: "phase", phase: "discovery", status: "done", message: `${found.length} Kamera(s) per WS-Discovery gefunden` });
  }

  if (req.preset === "ws-discovery") {
    // Fast scan: show RTSP candidates without actively probing (keeps scans snappy).
    for (const r of results) {
      throwIfAborted();
      const port = 554;
      r.rtsp = {
        ok: false,
        discoveryOnly: true,
        port,
        candidates: buildRtspCandidates({ ip: r.ip, port }),
        log: ["RTSP Probe: übersprungen (Fast Scan)."]
      };
      onPhase?.({ type: "item", item: r });
    }
  }

  if (req.preset === "cidr" || req.preset === "auto") {
    const ips = expandCidr(req.cidr!);
    if (ips.length === 0) {
      throw new Error("CIDR enthält keine Hosts.");
    }
    onPhase?.({
      type: "phase",
      phase: "cidr",
      status: "start",
      message: `Port-Scan (${ips.length} Hosts auf Ports ${req.ports?.join(",")})…`
    });

    const ports = req.ports ?? [];
    const concurrency = req.concurrency;
    const deepProbeCidr = req.deepProbe && req.preset !== "auto";

    let done = 0;
    const scanned = await mapLimit(ips, concurrency, async (ip) => {
      throwIfAborted();
      const openTcpPorts = await scanTcpPorts(ip, ports, req.timeoutMs);
      const result: ScanResult = { ip, openTcpPorts };

      const rtspPort = openTcpPorts.find((p) =>
        [554, 8554, 10554, 8555].includes(p)
      );
      if (rtspPort) {
        if (deepProbeCidr) {
          const rtsp = await probeRtsp({
            ip,
            port: rtspPort,
            timeoutMs: req.timeoutMs,
            credentials: req.credentials
          });
          rtsp.candidates = buildRtspCandidates({ ip, port: rtspPort });
          result.rtsp = rtsp;
        } else {
          result.rtsp = {
            ok: false,
            discoveryOnly: true,
            port: rtspPort,
            candidates: buildRtspCandidates({ ip, port: rtspPort }),
            log: ["RTSP Probe: übersprungen (Deep Probe deaktiviert)."]
          };
        }
      }

      // If HTTP is open, try common ONVIF device_service path as a hint.
      const httpPort = openTcpPorts.find((p) => p === 80 || p === 8000 || p === 8080);
      const httpsPort = openTcpPorts.find((p) => p === 443);
      const xaddrs: string[] = [];
      if (httpPort) xaddrs.push(`http://${ip}:${httpPort}/onvif/device_service`);
      if (httpsPort) xaddrs.push(`https://${ip}:${httpsPort}/onvif/device_service`);

      if (xaddrs.length) {
        if (deepProbeCidr) {
          result.onvif = await probeOnvifFromXaddr({
            ip,
            xaddrs,
            timeoutMs: req.timeoutMs,
            credentials: req.credentials
          });

          const onvifRtsp = result.onvif.rtspUris?.map((u) => u.uri) ?? [];
          if (onvifRtsp.length) {
            if (!result.rtsp) {
              result.rtsp = { ok: false, port: 554, uris: onvifRtsp };
            } else {
              result.rtsp.uris = Array.from(
                new Set([...(result.rtsp.uris ?? []), ...onvifRtsp])
              );
            }
          }
        } else if (req.preset !== "auto") {
          result.onvif = {
            ok: false,
            discoveryOnly: true,
            deviceServiceUrl: xaddrs[0],
            xaddrs,
            log: [
              deepProbeCidr
                ? "ONVIF SOAP Probe: nicht ausgeführt."
                : "ONVIF SOAP Probe: im Auto-CIDR-Schritt übersprungen; Vendor/URL-Erkennung läuft danach."
            ]
          };
        }
      }

      done += 1;
      if (isConfirmedCamera(result)) {
        onPhase?.({ type: "item", item: result });
      }
      onPhase?.({
        type: "progress",
        phase: "cidr",
        done,
        total: ips.length,
        message: `${done} von ${ips.length} Hosts geprüft`
      });
      return result;
    });

    const cameraCandidates = scanned.filter((r) => {
      if (isConfirmedCamera(r)) return true;
      const ports = r.openTcpPorts ?? [];
      return ports.some((p) => [554, 8554, 8000, 8899].includes(p));
    });
    mergeResults(results, cameraCandidates);
    warnings.push(
      req.preset === "auto"
        ? "Auto-Scan nutzt WS-Discovery plus gezielte Kamera-Port-Prüfung im lokalen Netzwerk."
        : "Port-Scan läuft lokal im angegebenen Heimnetz/LAN."
    );
    onPhase?.({ type: "phase", phase: "cidr", status: "done", message: `Portscan abgeschlossen` });
  }

  // Enrich with ARP MAC table & OUI manufacturer detection
  try {
    const arpTable = await getArpTable();
    for (const r of results) {
      if (!r.mac) r.mac = arpTable.get(r.ip);
      const ouiVendor = lookupVendorByMac(r.mac);
      if (!r.manufacturer && ouiVendor) {
        r.manufacturer = ouiVendor;
      }
      if (isConfirmedCamera(r)) {
        onPhase?.({ type: "item", item: r });
      }
    }
  } catch {
    // ARP lookup failed or unneeded
  }

  if (req.deepProbe && results.length) {
    onPhase?.({ type: "phase", phase: "vendor", status: "start", message: "Hersteller-Profile & URLs werden ermittelt…" });
    let done = 0;
    const vendorLimit = clampInt(process.env.SCAN_VENDOR_MAX_DEVICES ?? String(results.length), 1, results.length);
    const vendorTargets = results.slice(0, vendorLimit);
    await mapLimit(vendorTargets, Math.min(4, vendorTargets.length), async (r) => {
      throwIfAborted();
      let vendor;
      try {
        vendor = await probeVendorUrls({
          result: r,
          timeoutMs: req.timeoutMs,
          credentials: req.credentials,
          signal
        });
      } catch (e) {
        if (signal?.aborted) throw e;
        vendor = {
          profile: "Vendor-Katalog",
          log: [`Vendor probe failed: ${e instanceof Error ? e.message : String(e)}`]
        };
      }
      if (vendor) {
        r.vendor = vendor;
        if (vendor.rtspUris?.length) {
          r.rtsp = {
            ...(r.rtsp ?? { ok: true, port: 554 }),
            ok: true,
            port: r.rtsp?.port ?? 554,
            uris: Array.from(new Set([...(r.rtsp?.uris ?? []), ...vendor.rtspUris])),
            candidates: r.rtsp?.candidates,
            log: r.rtsp?.log
          };
        }
      }
      finalizeCameraResult(r);
      if (isConfirmedCamera(r)) {
        onPhase?.({ type: "item", item: r });
      }
      done += 1;
      onPhase?.({ type: "progress", phase: "vendor", done, total: vendorTargets.length, message: `${done}/${vendorTargets.length} analysiert` });
    });
    if (vendorTargets.length < results.length) {
      warnings.push(
        `Vendor-URL-Prüfung auf ${vendorTargets.length}/${results.length} Geräte begrenzt, damit der Scan schnell antwortet.`
      );
    }
    onPhase?.({ type: "phase", phase: "vendor", status: "done", message: "Hersteller-Prüfung beendet" });
  }

  await mapLimit(results, Math.min(16, results.length || 1), async (r) => {
    r.hostname = await reverseHostname(r.ip);
    finalizeCameraResult(r);
    if (isConfirmedCamera(r)) {
      onPhase?.({ type: "item", item: r });
    }
  });
  const cameraResults = results.filter(isConfirmedCamera);

  const durationMs = Date.now() - startedAt.getTime();
  return {
    meta: {
      mode: req.preset,
      startedAt: startedAt.toISOString(),
      durationMs
    },
    results: cameraResults,
    warnings: warnings.length ? warnings : undefined
  };
}

function isConfirmedCamera(result: ScanResult): boolean {
  // 1. Validated ONVIF device service
  if (result.onvif?.ok) return true;

  // 2. Discovered via WS-Discovery specifically for ONVIF video devices
  if (
    result.onvif?.discoveryOnly &&
    (result.onvif.deviceServiceUrl ||
      result.onvif.xaddrs?.some(
        (x) =>
          x.toLowerCase().includes("/onvif") ||
          x.toLowerCase().includes("device_service")
      ) ||
      result.onvif.log?.some((line) => line.toLowerCase().includes("ws-discovery")))
  ) {
    return true;
  }

  // 3. Genuine RTSP server handshake was successful
  if (result.rtsp?.ok) return true;

  // 4. Validated stream or snapshot URIs exist
  if ((result.streamUris && result.streamUris.length > 0) || (result.snapshotUris && result.snapshotUris.length > 0)) {
    return true;
  }

  // 5. Vendor profile was matched and verified (with verified snapshot/stream)
  if (result.vendor?.profile && result.vendor.profile !== "Vendor-Katalog") {
    return true;
  }

  // 6. RTSP server responded with standard RTSP status (e.g. RTSP/1.0 401 Unauthorized), provided it is not an Apple TV / AirPlay server
  if (result.rtsp?.statusLine?.startsWith("RTSP/") && !result.rtsp.statusLine.toLowerCase().includes("airtunes")) {
    if ([554, 8554, 10554, 8555].includes(result.rtsp.port)) {
      return true;
    }
  }

  // 7. MAC vendor OUI is a known camera vendor AND has camera port (RTSP or ONVIF port) open
  if (result.manufacturer) {
    const m = result.manufacturer.toLowerCase();
    const cameraVendors = [
      "hikvision",
      "dahua",
      "reolink",
      "axis",
      "uniview",
      "geutebrueck",
      "foscam",
      "amcrest",
      "vivotek",
      "hanwha",
      "mobotix",
      "instar",
      "tapo",
      "eufy",
      "ezviz",
      "imou",
      "annke"
    ];
    if (cameraVendors.some((cv) => m.includes(cv))) {
      const hasCameraPort = result.openTcpPorts?.some((p) => [554, 8554, 8000, 8899].includes(p));
      if (hasCameraPort) return true;
    }
  }

  return false;
}

function mergeResults(target: ScanResult[], incoming: ScanResult[]) {
  const byIp = new Map(target.map((r) => [r.ip, r]));
  for (const next of incoming) {
    const existing = byIp.get(next.ip);
    if (!existing) {
      target.push(next);
      byIp.set(next.ip, next);
      continue;
    }
    existing.mac ??= next.mac;
    existing.openTcpPorts = uniqueNumbers([
      ...(existing.openTcpPorts ?? []),
      ...(next.openTcpPorts ?? [])
    ]);
    existing.onvif = preferDetailedOnvif(existing.onvif, next.onvif);
    existing.rtsp = preferDetailedRtsp(existing.rtsp, next.rtsp);
    existing.vendor ??= next.vendor;
    existing.hostname ??= next.hostname;
    existing.manufacturer ??= next.manufacturer;
    existing.model ??= next.model;
  }
}

function preferDetailedOnvif(
  current: ScanResult["onvif"],
  next: ScanResult["onvif"]
): ScanResult["onvif"] {
  if (!current) return next;
  if (!next) return current;
  if (next.ok && !current.ok) return next;
  if ((next.rtspUris?.length ?? 0) > (current.rtspUris?.length ?? 0)) return next;
  if ((next.snapshotUris?.length ?? 0) > (current.snapshotUris?.length ?? 0)) return next;
  return {
    ...current,
    xaddrs: unique([...(current.xaddrs ?? []), ...(next.xaddrs ?? [])]),
    log: unique([...(current.log ?? []), ...(next.log ?? [])])
  };
}

function preferDetailedRtsp(
  current: ScanResult["rtsp"],
  next: ScanResult["rtsp"]
): ScanResult["rtsp"] {
  if (!current) return next;
  if (!next) return current;
  if (next.ok && !current.ok) return next;
  return {
    ...current,
    uris: unique([...(current.uris ?? []), ...(next.uris ?? [])]),
    candidates: unique([...(current.candidates ?? []), ...(next.candidates ?? [])]),
    log: unique([...(current.log ?? []), ...(next.log ?? [])])
  };
}

function formatResolutionLabel(width: number, height: number): string {
  if (width === 3840 && height === 2160) return "3840×2160 (4K UHD)";
  if (width === 2560 && height === 1440) return "2560×1440 (2K QHD)";
  if (width === 2688 && height === 1520) return "2688×1520 (4MP)";
  if (width === 2304 && height === 1296) return "2304×1296 (3MP)";
  if (width === 1920 && height === 1080) return "1920×1080 (1080p FHD)";
  if (width === 1280 && height === 720) return "1280×720 (720p HD)";
  if (width === 704 && (height === 576 || height === 480)) return `${width}×${height} (D1)`;
  if (width === 640 && height === 480) return "640×480 (VGA)";
  if (width === 640 && height === 360) return "640×360 (nHD)";

  const area = width * height;
  if (area >= 8000000) return `${width}×${height} (4K)`;
  if (area >= 3600000) return `${width}×${height} (QHD)`;
  if (area >= 2000000) return `${width}×${height} (FHD)`;
  if (area >= 900000) return `${width}×${height} (HD)`;
  if (area < 500000) return `${width}×${height} (Sub)`;
  return `${width}×${height}`;
}

function finalizeCameraResult(result: ScanResult) {
  const info = result.onvif?.deviceInformation;
  const vendorProfile =
    result.vendor?.profile && result.vendor.profile !== "Vendor-Katalog"
      ? result.vendor.profile
      : undefined;

  result.manufacturer =
    info?.manufacturer ??
    result.vendor?.deviceInformation?.manufacturer ??
    vendorProfile ??
    result.manufacturer;
  result.model = info?.model ?? result.vendor?.deviceInformation?.model ?? result.model;
  result.hostname = info?.hostname ?? result.vendor?.deviceInformation?.hostname ?? result.hostname;
  result.streamUris = unique([
    ...(result.onvif?.rtspUris?.map((u) => u.uri) ?? []),
    ...(result.vendor?.rtspUris ?? []),
    ...(result.vendor?.httpStreamUris ?? []),
    ...(result.rtsp?.uris ?? [])
  ]);
  result.snapshotUris = unique([
    ...(result.onvif?.snapshotUris?.map((u) => u.uri) ?? []),
    ...(result.vendor?.snapshotUris ?? [])
  ]);

  // Aggregate detected resolutions
  const resList: Array<{
    width: number;
    height: number;
    encoding?: string;
    fps?: number;
    label?: string;
  }> = [];
  const seenRes = new Set<string>();

  for (const u of result.onvif?.rtspUris ?? []) {
    if (u.width && u.height) {
      const key = `${u.width}x${u.height}`;
      if (!seenRes.has(key)) {
        seenRes.add(key);
        resList.push({
          width: u.width,
          height: u.height,
          encoding: u.encoding,
          fps: u.fps,
          label: formatResolutionLabel(u.width, u.height)
        });
      }
    }
  }

  for (const u of result.onvif?.snapshotUris ?? []) {
    if (u.width && u.height) {
      const key = `${u.width}x${u.height}`;
      if (!seenRes.has(key)) {
        seenRes.add(key);
        resList.push({
          width: u.width,
          height: u.height,
          encoding: u.encoding,
          fps: u.fps,
          label: formatResolutionLabel(u.width, u.height)
        });
      }
    }
  }

  resList.sort((a, b) => b.width * b.height - a.width * a.height);
  if (resList.length > 0) {
    result.resolutions = resList;
    result.primaryResolution = resList[0]?.label ?? `${resList[0]?.width}×${resList[0]?.height}`;
  }
}

function unique(values: string[]): string[] | undefined {
  const out = Array.from(new Set(values.filter(Boolean)));
  return out.length ? out : undefined;
}

function uniqueNumbers(values: number[]): number[] | undefined {
  const out = Array.from(new Set(values.filter((n) => Number.isFinite(n)))).sort((a, b) => a - b);
  return out.length ? out : undefined;
}

function clampInt(value: unknown, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return min;
  const i = Math.trunc(n);
  return Math.min(max, Math.max(min, i));
}
