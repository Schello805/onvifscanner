import { runScan, type PhaseEvent } from "@/lib/scan/runScan";
import { parseScanRequest } from "@/lib/scan/validation";
import type { ScanResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type StreamEvent =
  | PhaseEvent
  | { type: "result"; result: ScanResponse }
  | { type: "error"; error: string };

function sseEncode(event: StreamEvent): Uint8Array {
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
      const send = (e: StreamEvent) => {
        try {
          controller.enqueue(sseEncode(e));
        } catch {
          // ignore if controller closed
        }
      };
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
        send({ type: "progress", phase: "discovery", done: 0, total: 0, message: "ping" });
      }, 1500);

      void (async () => {
        try {
          send({ type: "phase", phase: "discovery", status: "start", message: "Scan wird initialisiert…" });
          const body = await req.json();
          const parsed = parseScanRequest(body);

          const result = await runScan(parsed, {
            signal: req.signal,
            onPhase(ev) {
              send(ev);
            }
          });

          send({ type: "result", result });
          send({ type: "phase", phase: "discovery", status: "done", message: "Scan abgeschlossen." });
          clearInterval(ping);
          close();
        } catch (e) {
          clearInterval(ping);
          if (req.signal.aborted) {
            send({ type: "phase", phase: "discovery", status: "done", message: "Scan abgebrochen." });
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
      "x-accel-buffering": "no",
      connection: "keep-alive"
    }
  });
}
