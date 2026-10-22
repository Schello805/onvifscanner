import { createHash } from "crypto";
import { spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";

const conversions = new Map<string, Promise<string>>();
let conversionQueue: Promise<unknown> = Promise.resolve();

export async function compatiblePlaybackVideo(source: string): Promise<string> {
  const stat = await fs.stat(source);
  const directory = path.resolve(process.env.PLAYBACK_CACHE_DIR || path.join(process.cwd(), "data", "playback-cache"));
  const key = createHash("sha256").update(`${source}:${stat.size}:${stat.mtimeMs}`).digest("hex");
  const destination = path.join(directory, `${key}.mp4`);
  try {
    await fs.access(destination);
    return destination;
  } catch {}
  const existing = conversions.get(key);
  if (existing) return existing;
  const conversion = conversionQueue.catch(() => undefined).then(async () => {
    await fs.mkdir(directory, { recursive: true });
    const files = await fs.readdir(directory);
    for (const file of files) {
      if (!/^[a-f0-9]{64}\.mp4$/.test(file)) continue;
      const cached = path.join(directory, file);
      const cachedStat = await fs.stat(cached).catch(() => null);
      if (cachedStat && Date.now() - cachedStat.mtimeMs > 86_400_000) {
        await fs.rm(cached, { force: true });
      }
    }
    const temporary = path.join(directory, `${key}.${process.pid}.tmp.mp4`);
    try {
      await new Promise<void>((resolve, reject) => {
        const process = spawn("ffmpeg", [
          "-y", "-hide_banner", "-loglevel", "error", "-i", source,
          "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "libx264",
          "-preset", "veryfast", "-crf", "23", "-threads", "2", "-pix_fmt", "yuv420p",
          "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", temporary,
        ], { stdio: ["ignore", "ignore", "pipe"] });
        let error = "";
        process.stderr.on("data", (chunk: Buffer) => { error = (error + chunk.toString()).slice(-2000); });
        const timeout = setTimeout(() => process.kill("SIGKILL"), 600_000);
        process.once("error", (failure) => { clearTimeout(timeout); reject(failure); });
        process.once("close", (code) => {
          clearTimeout(timeout);
          if (code === 0) resolve();
          else reject(new Error(`Videokonvertierung fehlgeschlagen: ${error}`));
        });
      });
      await fs.rename(temporary, destination);
      return destination;
    } finally {
      await fs.rm(temporary, { force: true });
    }
  });
  conversionQueue = conversion;
  conversions.set(key, conversion);
  try { return await conversion; }
  finally { conversions.delete(key); }
}
