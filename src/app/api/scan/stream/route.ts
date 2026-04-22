import { runScan } from "@/lib/scan/runScan";
import { parseScanRequest } from "@/lib/scan/validation";

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
  | { type: "error"; error: string };

function sseEncode(event: PhaseEvent): Uint8Array {
  const lines: string[] = [];
  lines.push(`event: ${event.type}`);
  lines.push(`data: ${JSON.stringify(event)}`);
  lines.push("");
  return new TextEncoder().encode(lines.join("\n"));
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

      void (async () => {
        try {
          send({ type: "phase", phase: "validate", status: "start" });
          const body = await req.json();
          const parsed = parseScanRequest(body);
          send({ type: "phase", phase: "validate", status: "done" });

          const result = await runScan(parsed, {
            signal: req.signal,
            onPhase(ev) {
              send(ev);
            }
          });

          send({ type: "result", result });
          send({ type: "phase", phase: "done", status: "done" });
          close();
        } catch (e) {
          if (req.signal.aborted) {
            send({ type: "phase", phase: "aborted", status: "done", message: "Abgebrochen." });
            close();
            return;
          }
          const message = e instanceof Error ? e.message : "Unbekannter Fehler";
          send({ type: "error", error: message });
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
      connection: "keep-alive"
    }
  });
}
