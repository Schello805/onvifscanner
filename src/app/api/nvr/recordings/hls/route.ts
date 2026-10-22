import { promises as fs } from "fs";
import { recordingFile } from "@/lib/recordingFile";
import { recordingDuration, recordingManifest, recordingSegment } from "@/lib/recordingHls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const clipId = params.get("clipId");
    if (!clipId) return new Response("Clip ID missing", { status: 400 });
    const source = await recordingFile(clipId);
    const segment = params.get("segment");
    if (segment !== null) {
      const file = await recordingSegment(source, Number(segment));
      return new Response(new Uint8Array(await fs.readFile(file)), {
        headers: { "Content-Type": "video/mp2t", "Cache-Control": "private, max-age=3600" },
      });
    }
    return new Response(recordingManifest(clipId, await recordingDuration(source)), {
      headers: { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "private, no-cache" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Videosegment konnte nicht geladen werden";
    return new Response(message, { status: message === "Access denied" ? 403 : 500 });
  }
}
