import { createHash } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { promises as fs } from "fs";
import path from "path";

const run = promisify(execFile);
export const SEGMENT_SECONDS = 6;
const jobs = new Map<string, Promise<string>>();
const metadata = new Map<string, Promise<number>>();
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
  if (running >= 2) await new Promise<void>((resolve) => waiting.push(resolve));
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
  return createHash("sha256").update(`hls-v1:${source}:${stat.size}:${stat.mtimeMs}`).digest("hex");
}

export async function recordingDuration(source: string): Promise<number> {
  const key = await sourceKey(source);
  let pending = metadata.get(key);
  if (!pending) {
    pending = limited(async () => {
      const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", source], { timeout: 15_000 });
      const duration = Number(stdout.trim());
      if (!Number.isFinite(duration) || duration <= 0) throw new Error("Ungültige Videodauer");
      return duration;
    });
    if (metadata.size > 1000) metadata.clear();
    metadata.set(key, pending);
    pending.catch(() => metadata.delete(key));
  }
  return pending;
}

export function recordingManifest(clipId: string, duration: number): string {
  const lines = ["#EXTM3U", "#EXT-X-VERSION:3", `#EXT-X-TARGETDURATION:${SEGMENT_SECONDS}`, "#EXT-X-MEDIA-SEQUENCE:0", "#EXT-X-PLAYLIST-TYPE:VOD", "#EXT-X-INDEPENDENT-SEGMENTS"];
  for (let index = 0; index * SEGMENT_SECONDS < duration; index += 1) {
    lines.push(`#EXTINF:${Math.min(SEGMENT_SECONDS, duration - index * SEGMENT_SECONDS).toFixed(6)},`,
      `/api/nvr/recordings/hls?clipId=${encodeURIComponent(clipId)}&segment=${index}`);
  }
  return [...lines, "#EXT-X-ENDLIST", ""].join("\n");
}

export async function recordingSegment(source: string, index: number): Promise<string> {
  const duration = await recordingDuration(source);
  if (!Number.isSafeInteger(index) || index < 0 || index * SEGMENT_SECONDS >= duration) throw new Error("Ungültiges Videosegment");
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
        "-y", "-hide_banner", "-loglevel", "error", "-ss", String(index * SEGMENT_SECONDS), "-i", source,
        "-t", String(Math.min(SEGMENT_SECONDS, duration - index * SEGMENT_SECONDS)),
        "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "ultrafast",
        "-crf", "23", "-threads", "2", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k",
        "-output_ts_offset", String(index * SEGMENT_SECONDS), "-muxdelay", "0", "-muxpreload", "0",
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
