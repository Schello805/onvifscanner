import type { ScanResponse, ScanResult } from "@/lib/types";
import { runScan } from "@/lib/scan/runScan";
import { parseScanRequest } from "@/lib/scan/validation";
import { wsDiscoveryProbe, wsDiscoveryRawLive } from "@/lib/wsdiscovery/wsDiscovery";
import { probeOnvifFromXaddr } from "@/lib/onvif/probeOnvif";
import { buildRtspCandidates } from "@/lib/rtsp/candidates";
import { scanTcpPorts } from "@/lib/scan/tcpScan";
import { probeRtsp } from "@/lib/rtsp/probeRtsp";
import { mapLimit } from "@/lib/util/mapLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Phase =
  | "validate"
  | "discovery"
  | "onvif"
  | "rtsp"
  | "cidr"
  | "done"
  | "aborted"
  | "error";

type PhaseEvent =
  | { type: "phase"; phase: Phase; status: "start" | "done"; message?: string }
  | { type: "progress"; phase: Phase; done: number; total: number; message?: string }
  | { type: "result"; result: unknown }
  | { type: "item"; item: Partial<ScanResult> & { ip: string } }
  | { type: "error"; error: string };

function sseEncode(event: PhaseEvent): Uint8Array {
  const lines: string[] = [];
  lines.push(`event: ${event.type}`);
  lines.push(`data: ${JSON.stringify(event)}`);
  lines.push("");
  return new TextEncoder().encode(lines.join("\n"));
}

function sseCommentPadding(bytes: number): Uint8Array {
  // Some clients/proxies (notably Safari/fetch streaming) buffer small chunks.
  // Send an initial SSE comment with padding to force flush.
  const pad = " ".repeat(Math.max(0, bytes));
  return new TextEncoder().encode(`:${pad}\n\n`);
}

export async function POST(req: Request) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (e: PhaseEvent) => controller.enqueue(sseEncode(e));
      const close = () => {
        try {
          controller.close();
        } catch {
          // ignore
        }
      };

      // Force early flush + keep the connection alive.
      try {
        controller.enqueue(sseCommentPadding(2048));
      } catch {
        // ignore
      }
      const ping = setInterval(() => {
        try {
          controller.enqueue(sseEncode({ type: "progress", phase: "validate", done: 0, total: 0, message: "ping" }));
        } catch {
          // ignore
        }
      }, 1000);

      void (async () => {
        try {
          send({ type: "phase", phase: "validate", status: "start" });
          const body = await req.json();
          const parsed = parseScanRequest(body);
          send({ type: "phase", phase: "validate", status: "done" });

          const startedAt = new Date();

          // Progressive WS-Discovery: send discovery results immediately, then enrich via ONVIF/RTSP.
          if (parsed.preset === "ws-discovery" && parsed.deepProbe) {
            const discoveryTimeoutMs = clampInt(
              process.env.WS_DISCOVERY_TIMEOUT_MS ?? "4000",
              500,
              15000
            );
            send({ type: "phase", phase: "discovery", status: "start" });
            const baselineByIp = new Map<string, ScanResult>();
            let foundCount = 0;

            const discovered = await wsDiscoveryRawLive({
              timeoutMs: discoveryTimeoutMs,
              signal: req.signal,
              onFound(d) {
                const existing = baselineByIp.get(d.ip);
                const xaddrs = existing?.onvif?.xaddrs ?? [];
                const merged = Array.from(new Set([...xaddrs, ...d.xaddrs]));

                const updated: ScanResult = {
                  ip: d.ip,
                  onvif: {
                    ok: false,
                    discoveryOnly: true,
                    deviceServiceUrl: merged[0],
                    xaddrs: merged,
                    log: ["WS-Discovery: XAddr(s) gefunden. Deep Probe läuft…"]
                  },
                  rtsp: {
                    ok: false,
                    discoveryOnly: true,
                    port: 554,
                    candidates: buildRtspCandidates({ ip: d.ip, port: 554 }),
                    log: ["RTSP Probe: pending (Deep Probe)."]
                  }
                };

                baselineByIp.set(d.ip, updated);
                foundCount = baselineByIp.size;
                send({ type: "item", item: updated });
                send({
                  type: "progress",
                  phase: "discovery",
                  done: foundCount,
                  total: foundCount,
                  message: `${foundCount} gefunden`
                });
              }
            });

            const baseline = Array.from(baselineByIp.values());
            send({
              type: "phase",
              phase: "discovery",
              status: "done",
              message: `${baseline.length} Gerät(e), ${discovered.length} Antwort(en)`
            });

            const initial: ScanResponse = {
              meta: {
                mode: "ws-discovery",
                startedAt: startedAt.toISOString(),
                durationMs: Date.now() - startedAt.getTime()
              },
              results: baseline,
              warnings: ["Deep Probe läuft im Hintergrund – Ergebnisse werden nachgeladen."]
            };
            send({ type: "result", result: initial });

            // ONVIF enrichment
            send({ type: "phase", phase: "onvif", status: "start" });
            const results = baseline;
            let doneOnvif = 0;
            await mapLimit(results, Math.min(12, results.length || 1), async (r) => {
              if (req.signal.aborted) return null;
              const xaddrs = r.onvif?.xaddrs ?? [];
              if (!xaddrs.length) {
                doneOnvif += 1;
                send({ type: "progress", phase: "onvif", done: doneOnvif, total: results.length });
                return null;
              }
              const onvif = await probeOnvifFromXaddr({
                ip: r.ip,
                xaddrs,
                timeoutMs: parsed.timeoutMs,
                credentials: parsed.credentials
              });
              r.onvif = onvif;
              send({ type: "item", item: { ip: r.ip, onvif } });
              doneOnvif += 1;
              send({ type: "progress", phase: "onvif", done: doneOnvif, total: results.length });
              return null;
            });
            send({ type: "phase", phase: "onvif", status: "done" });

            // RTSP enrichment
            send({ type: "phase", phase: "rtsp", status: "start" });
            let doneRtsp = 0;
            await mapLimit(results, Math.min(12, results.length || 1), async (r) => {
              if (req.signal.aborted) return null;
              const commonPorts = [554, 8554];
              const open = await scanTcpPorts(
                r.ip,
                commonPorts,
                Math.min(parsed.timeoutMs, 900)
              );
              const port = open[0] ?? 554;

              const onvifUris = r.onvif?.rtspUris?.map((u) => u.uri).filter(Boolean) ?? [];
              const candidates = buildRtspCandidates({ ip: r.ip, port });
              const uris = Array.from(new Set([...onvifUris]));
              const probeList = [...uris, ...candidates].slice(0, 4);

              for (const uri of probeList) {
                const res = await probeRtsp({
                  ip: r.ip,
                  port,
                  timeoutMs: Math.min(parsed.timeoutMs, 1200),
                  credentials: parsed.credentials,
                  uri
                });
                r.rtsp = {
                  ...res,
                  port,
                  uris: uris.length ? uris : undefined,
                  candidates
                };
                send({ type: "item", item: { ip: r.ip, rtsp: r.rtsp } });
                if (res.ok) break;
                if (req.signal.aborted) break;
              }

              if (!r.rtsp) {
                r.rtsp = { ok: false, port, candidates, uris: uris.length ? uris : undefined };
                send({ type: "item", item: { ip: r.ip, rtsp: r.rtsp } });
              }

              doneRtsp += 1;
              send({ type: "progress", phase: "rtsp", done: doneRtsp, total: results.length });
              return null;
            });
            send({ type: "phase", phase: "rtsp", status: "done" });

            const final: ScanResponse = {
              meta: {
                mode: "ws-discovery",
                startedAt: startedAt.toISOString(),
                durationMs: Date.now() - startedAt.getTime()
              },
              results,
              warnings: initial.warnings
            };
            send({ type: "result", result: final });
          } else {
            const result = await runScan(parsed, {
              signal: req.signal,
              onPhase(ev) {
                send(ev);
              }
            });
            send({ type: "result", result });
          }

          send({ type: "phase", phase: "done", status: "done" });
          clearInterval(ping);
          close();
        } catch (e) {
          if (req.signal.aborted) {
            send({ type: "phase", phase: "aborted", status: "done", message: "Abgebrochen." });
            clearInterval(ping);
            close();
            return;
          }
          const message = e instanceof Error ? e.message : "Unbekannter Fehler";
          send({ type: "error", error: message });
          clearInterval(ping);
          close();
        }
      })();
    }
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      connection: "keep-alive"
    }
  });
}

function clampInt(value: unknown, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return min;
  const i = Math.trunc(n);
  return Math.min(max, Math.max(min, i));
}
