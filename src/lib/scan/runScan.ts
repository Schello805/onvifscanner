import type { ParsedScanRequest } from "@/lib/scan/validation";
import type { ScanResponse, ScanResult } from "@/lib/types";
import { wsDiscoveryProbe } from "@/lib/wsdiscovery/wsDiscovery";
import { expandCidr } from "@/lib/net/ip";
import { mapLimit } from "@/lib/util/mapLimit";
import { scanTcpPorts } from "@/lib/scan/tcpScan";
import { probeRtsp } from "@/lib/rtsp/probeRtsp";
import { probeOnvifFromXaddr } from "@/lib/onvif/probeOnvif";
import { fetchThumbnailDataUrl } from "@/lib/preview/fetchThumbnail";
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

    // Optional RTSP check based on ONVIF-provided RTSP URIs.
    await mapLimit(results, 16, async (r) => {
      const rtspUri = r.onvif?.rtspUris?.[0]?.uri;
      if (!rtspUri) return;
      try {
        const u = new URL(rtspUri);
        const port = Number(u.port || "554");
        if (!Number.isInteger(port) || port <= 0 || port > 65535) return;
        const rtsp = await probeRtsp({
          ip: r.ip,
          port,
          timeoutMs: req.timeoutMs,
          credentials: req.credentials,
          uri: rtspUri
        });
        rtsp.uris = Array.from(new Set([...(rtsp.uris ?? []), rtspUri]));
        rtsp.candidates = buildRtspCandidates({ ip: r.ip, port });
        r.rtsp = rtsp;
      } catch {
        // ignore invalid URL parsing
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

  const thumbnailsEnabled = (process.env.ENABLE_THUMBNAILS ?? "true") !== "false";
  if (thumbnailsEnabled) {
    const maxThumbs = Number(process.env.THUMBNAILS_MAX ?? "12");
    const candidates = results
      .filter((r) => r.onvif?.ok && r.onvif.snapshotUris?.[0]?.uri)
      .slice(0, Math.max(0, maxThumbs));

    await mapLimit(candidates, 4, async (r) => {
      const url = r.onvif?.snapshotUris?.[0]?.uri;
      if (!url || !r.onvif) return;
      const dataUrl = await fetchThumbnailDataUrl({
        url,
        timeoutMs: Math.min(1500, req.timeoutMs),
        credentials: req.credentials
      });
      if (dataUrl) r.onvif.thumbnailDataUrl = dataUrl;
    });
  }

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
