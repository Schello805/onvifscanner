import { createHash } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { promises as fs } from "fs";
import path from "path";

const run = promisify(execFile);
export const SEGMENT_SECONDS = 6;
const jobs = new Map<string, Promise<string>>();
type Profile = { duration: number; copyVideo: boolean; boundaries: number[] };
const metadata = new Map<string, Promise<Profile>>();
let running = 0;
const waiting: Array<() => void> = [];
let lastCleanup = 0;

async function cleanSegments(directory: string) {
  if (Date.now() - lastCleanup < 60_000) return;
  lastCleanup = Date.now();
  const entries = await fs.readdir(directory);
  const files = await Promise.all(entries.filter((entry) => /^[a-f0-9]{64}-\d+\.ts$/.test(entry)).map(async (entry) => {
    const filename = path.join(directory, entry);
    const stat = await fs.stat(filename).catch(() => null);
    return stat ? { filename, size: stat.size, modified: stat.mtimeMs } : null;
  }));
  const sorted = files.filter((file): file is NonNullable<typeof file> => file !== null).sort((first, second) => first.modified - second.modified);
  let bytes = sorted.reduce((sum, file) => sum + file.size, 0);
  for (const file of sorted) {
    const age = Date.now() - file.modified;
    if (age > 86_400_000 || (bytes > 2 * 1024 ** 3 && age > 300_000)) {
      await fs.rm(file.filename, { force: true });
      bytes -= file.size;
    }
  }
}

async function limited<T>(job: () => Promise<T>): Promise<T> {
  if (running >= 1) await new Promise<void>((resolve) => waiting.push(resolve));
  else running += 1;
  try { return await job(); }
  finally {
    const next = waiting.shift();
    if (next) next();
    else running -= 1;
  }
}

async function sourceKey(source: string) {
  const stat = await fs.stat(source);
  return createHash("sha256").update(`hls-v2:${source}:${stat.size}:${stat.mtimeMs}`).digest("hex");
}

export async function recordingProfile(source: string): Promise<Profile> {
  const key = await sourceKey(source);
  let pending = metadata.get(key);
  if (!pending) {
    pending = (async () => {
      const { stdout } = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_packets", "-show_entries", "format=duration:stream=codec_name,pix_fmt,start_time,duration:packet=pts_time,flags", "-of", "json", source], { timeout: 60_000, maxBuffer: 32 * 1024 * 1024 });
      const result = JSON.parse(stdout) as { format?: { duration?: string }; streams?: Array<{ codec_name?: string; pix_fmt?: string; start_time?: string; duration?: string }>; packets?: Array<{ pts_time?: string; flags?: string }> };
      const stream = result.streams?.[0];
      const duration = [Number(stream?.duration), Number(result.format?.duration)].find((value) => Number.isFinite(value) && value > 0) || 0;
      if (!Number.isFinite(duration) || duration <= 0) throw new Error("Ungültige Videodauer");
      const startTime = Number(stream?.start_time) || 0;
      const copyVideo = stream?.codec_name === "h264" && (stream.pix_fmt === "yuv420p" || stream.pix_fmt === "yuvj420p");
      const boundaries = [0];
      if (copyVideo) {
        const keyframes = (result.packets || []).filter((packet) => packet.flags?.includes("K"))
          .map((packet) => Number(packet.pts_time) - startTime).filter(Number.isFinite).sort((first, second) => first - second);
        for (const time of keyframes) {
          if (time >= boundaries[boundaries.length - 1] + SEGMENT_SECONDS - 0.001 && time < duration - 0.05) boundaries.push(time);
        }
      } else {
        for (let time = SEGMENT_SECONDS; time < duration; time += SEGMENT_SECONDS) boundaries.push(time);
      }
      boundaries.push(duration);
      return { duration, copyVideo, boundaries };
    })();
    if (metadata.size > 1000) metadata.clear();
    metadata.set(key, pending);
    pending.catch(() => metadata.delete(key));
  }
  return pending;
}

export async function recordingDuration(source: string): Promise<number> {
  return (await recordingProfile(source)).duration;
}

export function recordingManifest(clipId: string, duration: number, boundaries = Array.from({ length: Math.ceil(duration / SEGMENT_SECONDS) + 1 }, (_, index) => Math.min(duration, index * SEGMENT_SECONDS))): string {
  const target = Math.ceil(Math.max(...boundaries.slice(1).map((end, index) => end - boundaries[index])));
  const lines = ["#EXTM3U", "#EXT-X-VERSION:3", `#EXT-X-TARGETDURATION:${target}`, "#EXT-X-MEDIA-SEQUENCE:0", "#EXT-X-PLAYLIST-TYPE:VOD", "#EXT-X-INDEPENDENT-SEGMENTS"];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    lines.push(`#EXTINF:${(boundaries[index + 1] - boundaries[index]).toFixed(6)},`,
      `/api/nvr/recordings/hls?clipId=${encodeURIComponent(clipId)}&segment=${index}`);
  }
  return [...lines, "#EXT-X-ENDLIST", ""].join("\n");
}

export async function recordingSegment(source: string, index: number): Promise<string> {
  const profile = await recordingProfile(source);
  if (!Number.isSafeInteger(index) || index < 0 || index >= profile.boundaries.length - 1) throw new Error("Ungültiges Videosegment");
  const start = profile.boundaries[index];
  const length = profile.boundaries[index + 1] - start;
  const directory = path.resolve(process.env.PLAYBACK_CACHE_DIR || "data/playback-cache", "segments");
  const key = `${await sourceKey(source)}-${index}`;
  const destination = path.join(directory, `${key}.ts`);
  try { await fs.access(destination); return destination; } catch {}
  const existing = jobs.get(key);
  if (existing) return existing;
  const pending = limited(async () => {
    await fs.mkdir(directory, { recursive: true });
    await cleanSegments(directory);
    const temporary = `${destination}.${process.pid}.tmp`;
    try {
      await run("ffmpeg", [
        "-y", "-hide_banner", "-loglevel", "error", "-threads", "1", "-ss", String(start), "-i", source,
        "-t", String(length), "-map", "0:v:0", "-map", "0:a:0?",
        ...(profile.copyVideo ? ["-c:v", "copy"] : ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-pix_fmt", "yuv420p",
          "-vf", "scale=w='min(1280,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2", "-maxrate", "4M", "-bufsize", "8M"]),
        "-threads", "1", "-c:a", "aac", "-b:a", "96k",
        "-output_ts_offset", String(start), "-muxdelay", "0", "-muxpreload", "0",
        "-f", "mpegts", temporary,
      ], { timeout: 60_000, maxBuffer: 64 * 1024 });
      await fs.rename(temporary, destination);
      return destination;
    } finally { await fs.rm(temporary, { force: true }); }
  });
  jobs.set(key, pending);
  try { return await pending; }
  finally { jobs.delete(key); }
}
