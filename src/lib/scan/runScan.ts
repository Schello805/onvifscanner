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

type Phase =
  | "onvif"
  | "rtsp"
  | "cidr"
  | "discovery"
  | "vendor";

type PhaseEvent =
  | { type: "phase"; phase: Phase; status: "start" | "done"; message?: string }
  | { type: "progress"; phase: Phase; done: number; total: number; message?: string };

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

  if (req.preset === "ws-discovery") {
    const discoveryTimeoutMs = clampInt(
      process.env.WS_DISCOVERY_TIMEOUT_MS ?? "4000",
      500,
      15000
    );
    const found = await wsDiscoveryProbe({
      discoveryTimeoutMs,
      timeoutMs: req.timeoutMs,
      // Keep the main scan short and reliable. Deep analysis should not block showing devices.
      deepProbe: false,
      credentials: req.credentials,
      signal,
      onProgress(done, total) {
        onPhase?.({ type: "progress", phase: "onvif", done, total });
      },
      onPhase(ev) {
        onPhase?.(ev);
      }
    });
    results.push(...found);

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
    }

    if (req.deepProbe && results.length) {
      onPhase?.({ type: "phase", phase: "onvif", status: "start" });
      let onvifDone = 0;
      await mapLimit(results, Math.min(8, results.length), async (r) => {
        throwIfAborted();
        if (r.onvif?.xaddrs?.length) {
          r.onvif = await probeOnvifFromXaddr({
            ip: r.ip,
            xaddrs: r.onvif.xaddrs,
            timeoutMs: req.timeoutMs,
            credentials: req.credentials
          });
        }
        onvifDone += 1;
        onPhase?.({ type: "progress", phase: "onvif", done: onvifDone, total: results.length });
      });
      onPhase?.({ type: "phase", phase: "onvif", status: "done" });
    }
  } else {
    onPhase?.({ type: "phase", phase: "cidr", status: "start" });
    const ips = expandCidr(req.cidr!);
    if (ips.length === 0) {
      throw new Error("CIDR enthält keine Hosts.");
    }
    const ports = req.ports ?? [];
    const concurrency = req.concurrency;

    let done = 0;
    const scanned = await mapLimit(ips, concurrency, async (ip) => {
      throwIfAborted();
      const openTcpPorts = await scanTcpPorts(ip, ports, req.timeoutMs);
      const result: ScanResult = { ip, openTcpPorts };

      const rtspPort = openTcpPorts.find((p) =>
        [554, 8554, 10554, 8555].includes(p)
      );
      if (rtspPort) {
        if (req.deepProbe) {
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
        if (req.deepProbe) {
          result.onvif = await probeOnvifFromXaddr({
            ip,
            xaddrs,
            timeoutMs: req.timeoutMs,
            credentials: req.credentials
          });

          const onvifRtsp = result.onvif.rtspUris?.map((u) => u.uri) ?? [];
          if (onvifRtsp.length) {
            if (!result.rtsp) {
              // No RTSP port probe happened, but we can still present URLs.
              result.rtsp = { ok: false, port: 554, uris: onvifRtsp };
            } else {
              result.rtsp.uris = Array.from(
                new Set([...(result.rtsp.uris ?? []), ...onvifRtsp])
              );
            }
          }
        } else {
          result.onvif = {
            ok: false,
            discoveryOnly: true,
            deviceServiceUrl: xaddrs[0],
            xaddrs,
            log: ["ONVIF SOAP Probe: übersprungen (Deep Probe deaktiviert)."]
          };
        }
      }

      done += 1;
      onPhase?.({ type: "progress", phase: "cidr", done, total: ips.length });
      return result;
    });

    results.push(...scanned);
    warnings.push(
      "CIDR/Port-Scan kann in großen Netzen lange dauern und als aggressiv wahrgenommen werden."
    );
    onPhase?.({ type: "phase", phase: "cidr", status: "done" });
  }

  if (req.deepProbe && results.length) {
    onPhase?.({ type: "phase", phase: "vendor", status: "start" });
    let done = 0;
    await mapLimit(results, Math.min(4, results.length), async (r) => {
      throwIfAborted();
      const vendor = await probeVendorUrls({
        result: r,
        timeoutMs: req.timeoutMs,
        credentials: req.credentials,
        signal
      });
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
      done += 1;
      onPhase?.({ type: "progress", phase: "vendor", done, total: results.length });
    });
    onPhase?.({ type: "phase", phase: "vendor", status: "done" });
  }

  // Thumbnails are loaded separately via `/api/thumbnail` to keep the scan response small.

  const durationMs = Date.now() - startedAt.getTime();
  return {
    meta: {
      mode: req.preset,
      startedAt: startedAt.toISOString(),
      durationMs
    },
    results,
    warnings: warnings.length ? warnings : undefined
  };
}

function clampInt(value: unknown, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return min;
  const i = Math.trunc(n);
  return Math.min(max, Math.max(min, i));
}
