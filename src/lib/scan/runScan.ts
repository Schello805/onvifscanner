import type { ParsedScanRequest } from "@/lib/scan/validation";
import type { ScanResponse, ScanResult } from "@/lib/types";
import { wsDiscoveryProbe } from "@/lib/wsdiscovery/wsDiscovery";
import { expandCidr } from "@/lib/net/ip";
import { mapLimit } from "@/lib/util/mapLimit";
import { scanTcpPorts } from "@/lib/scan/tcpScan";
import { probeRtsp } from "@/lib/rtsp/probeRtsp";
import { probeOnvifFromXaddr } from "@/lib/onvif/probeOnvif";
import { buildRtspCandidates } from "@/lib/rtsp/candidates";

export async function runScan(req: ParsedScanRequest): Promise<ScanResponse> {
  const startedAt = new Date();

  const warnings: string[] = [];
  const results: ScanResult[] = [];

  if (req.preset === "ws-discovery") {
    const discoveryTimeoutMs = Number(
      process.env.WS_DISCOVERY_TIMEOUT_MS ?? "1800"
    );
    const found = await wsDiscoveryProbe({
      timeoutMs: Math.min(req.timeoutMs, discoveryTimeoutMs),
      credentials: req.credentials
    });
    results.push(...found);

    // RTSP: always attach candidates so each camera shows something useful,
    // and attempt a lightweight probe on common ports.
    await mapLimit(results, 32, async (r) => {
      const commonPorts = [554, 8554];
      const open = await scanTcpPorts(r.ip, commonPorts, Math.min(req.timeoutMs, 900));
      const port = open[0] ?? 554;

      const onvifUris = r.onvif?.rtspUris?.map((u) => u.uri).filter(Boolean) ?? [];
      const candidates = buildRtspCandidates({ ip: r.ip, port });
      const uris = Array.from(new Set([...onvifUris]));

      // Try ONVIF-provided first, then candidates.
      const probeList = [...uris, ...candidates].slice(0, 4);
      for (const uri of probeList) {
        const res = await probeRtsp({
          ip: r.ip,
          port,
          timeoutMs: Math.min(req.timeoutMs, 1200),
          credentials: req.credentials,
          uri
        });
        r.rtsp = {
          ...res,
          port,
          uris: uris.length ? uris : undefined,
          candidates
        };
        if (res.ok) break;
      }

      if (!r.rtsp) {
        r.rtsp = { ok: false, port, candidates, uris: uris.length ? uris : undefined };
      }
    });
  } else {
    const ips = expandCidr(req.cidr!);
    if (ips.length === 0) {
      throw new Error("CIDR enthält keine Hosts.");
    }
    const ports = req.ports ?? [];
    const concurrency = req.concurrency;

    const scanned = await mapLimit(ips, concurrency, async (ip) => {
      const openTcpPorts = await scanTcpPorts(ip, ports, req.timeoutMs);
      const result: ScanResult = { ip, openTcpPorts };

      const rtspPort = openTcpPorts.find((p) =>
        [554, 8554, 10554, 8555].includes(p)
      );
      if (rtspPort) {
        const rtsp = await probeRtsp({
          ip,
          port: rtspPort,
          timeoutMs: req.timeoutMs,
          credentials: req.credentials
        });
        rtsp.candidates = buildRtspCandidates({ ip, port: rtspPort });
        result.rtsp = rtsp;
      }

      // If HTTP is open, try common ONVIF device_service path as a hint.
      const httpPort = openTcpPorts.find((p) => p === 80 || p === 8000 || p === 8080);
      const httpsPort = openTcpPorts.find((p) => p === 443);
      const xaddrs: string[] = [];
      if (httpPort) xaddrs.push(`http://${ip}:${httpPort}/onvif/device_service`);
      if (httpsPort) xaddrs.push(`https://${ip}:${httpsPort}/onvif/device_service`);

      if (xaddrs.length) {
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
            result.rtsp.uris = Array.from(new Set([...(result.rtsp.uris ?? []), ...onvifRtsp]));
          }
        }
      }

      return result;
    });

    results.push(...scanned);
    warnings.push(
      "CIDR/Port-Scan kann in großen Netzen lange dauern und als aggressiv wahrgenommen werden."
    );
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
