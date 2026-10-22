import { promises as fs } from "fs";
import { recordingFile } from "@/lib/recordingFile";
import { recordingProfile, recordingManifest, recordingSegment } from "@/lib/recordingHls";

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
    const profile = await recordingProfile(source);
    return new Response(recordingManifest(clipId, profile.duration, profile.boundaries), {
      headers: { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "private, no-cache" },
    });
  } catch (error) {
    console.error("[Recording HLS]", error);
    const message = error instanceof Error ? error.message : "Videosegment konnte nicht geladen werden";
    const failure = error as { code?: string; killed?: boolean; path?: string };
    const status = message === "Access denied" || failure.code === "EACCES" ? 403
      : failure.code === "ENOENT" ? (failure.path?.includes("ffprobe") || failure.path?.includes("ffmpeg") ? 503 : 404)
      : failure.killed ? 504 : message === "Ungültiges Videosegment" ? 400 : 500;
    return new Response(message, { status });
  }
}
