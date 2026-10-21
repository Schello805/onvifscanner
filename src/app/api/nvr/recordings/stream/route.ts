import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import crypto from "crypto";
import { Readable } from "stream";
import { execFile } from "child_process";
import { promisify } from "util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);
const compatibilityJobs = new Map<string, Promise<string>>();
const PLAYBACK_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

async function cleanupPlaybackCache(cacheDirectory: string) {
  const entries = await fsp.readdir(cacheDirectory, { withFileTypes: true }).catch(() => []);
  const cutoff = Date.now() - PLAYBACK_CACHE_MAX_AGE_MS;
  await Promise.all(entries.map(async (entry) => {
    if (!entry.isFile() || !entry.name.endsWith(".mp4")) return;
    const filePath = path.join(cacheDirectory, entry.name);
    const stat = await fsp.stat(filePath).catch(() => null);
    if (stat && stat.mtimeMs < cutoff) await fsp.unlink(filePath).catch(() => undefined);
  }));
}

async function ensureCompatibleVideo(sourcePath: string, sourceStat: fs.Stats) {
  const cacheDirectory = process.env.PLAYBACK_CACHE_DIR || path.join(process.cwd(), "data", "playback-cache");
  await fsp.mkdir(cacheDirectory, { recursive: true });
  const cacheKey = crypto
    .createHash("sha256")
    .update(`${sourcePath}:${sourceStat.size}:${sourceStat.mtimeMs}`)
    .digest("hex");
  const outputPath = path.join(cacheDirectory, `${cacheKey}.mp4`);
  const existing = await fsp.stat(outputPath).catch(() => null);
  if (existing?.isFile() && existing.size > 0) return outputPath;

  const runningJob = compatibilityJobs.get(cacheKey);
  if (runningJob) return runningJob;

  const job = (async () => {
    const temporaryPath = path.join(cacheDirectory, `.${cacheKey}.${process.pid}.tmp.mp4`);
    try {
      // 1. Ultra-fast stream-copy: keep H.264 video untouched, remux audio to AAC, add faststart moov atom
      // Runs in < 1 second even for 500MB+ files!
      try {
        await execFileAsync("ffmpeg", [
          "-y", "-hide_banner", "-loglevel", "error",
          "-i", sourcePath,
          "-map", "0:v:0", "-map", "0:a:0?",
          "-c:v", "copy",
          "-c:a", "aac", "-b:a", "128k",
          "-movflags", "+faststart",
          temporaryPath,
        ], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });

        const converted = await fsp.stat(temporaryPath);
        if (converted.isFile() && converted.size > 0) {
          await fsp.rename(temporaryPath, outputPath);
          void cleanupPlaybackCache(cacheDirectory);
          return outputPath;
        }
      } catch (copyErr: any) {
        console.warn("[Stream] Fast stream-copy failed, falling back to transcode:", copyErr?.message || copyErr);
        await fsp.unlink(temporaryPath).catch(() => undefined);
      }

      // 2. Fallback full re-encode for incompatible video codecs (e.g. H.265/HEVC)
      await execFileAsync("ffmpeg", [
        "-y", "-hide_banner", "-loglevel", "error",
        "-i", sourcePath,
        "-map", "0:v:0", "-map", "0:a:0?",
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "24",
        "-pix_fmt", "yuv420p", "-profile:v", "main", "-level", "4.0",
        "-threads", "4",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        temporaryPath,
      ], { timeout: 10 * 60_000, maxBuffer: 4 * 1024 * 1024 });
      const converted = await fsp.stat(temporaryPath);
      if (!converted.isFile() || converted.size === 0) throw new Error("Leere Kompatibilitätsdatei erzeugt.");
      await fsp.rename(temporaryPath, outputPath);
      void cleanupPlaybackCache(cacheDirectory);
      return outputPath;
    } catch (error) {
      await fsp.unlink(temporaryPath).catch(() => undefined);
      throw error;
    } finally {
      compatibilityJobs.delete(cacheKey);
    }
  })();
  compatibilityJobs.set(cacheKey, job);
  return job;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const clipId = searchParams.get("clipId");
    const download = searchParams.get("download") === "1";
    const compatible = searchParams.get("compatible") === "1";

    if (!clipId) {
      return new Response("Clip ID missing", { status: 400 });
    }

    let decodedPath = "";
    try {
      decodedPath = Buffer.from(clipId, "base64url").toString("utf-8");
    } catch {
      return new Response("Invalid clip ID", { status: 400 });
    }

    const resolved = path.resolve(decodedPath);

    // Verify file is within an approved storage target or system recording directories
    const targets = await prisma.storageTarget.findMany();
    const allowedDirs = [
      ...targets.map((target) => path.resolve(target.path)),
      path.resolve(process.cwd(), "data", "recordings"),
      path.resolve(process.cwd(), "data", "motion-buffer"),
      path.resolve(process.cwd(), "data", "motion-staging"),
      path.resolve(process.env.PLAYBACK_CACHE_DIR || path.join(process.cwd(), "data", "playback-cache")),
    ];

    let isAllowed = allowedDirs.some((dir) => {
      const relative = path.relative(dir, resolved);
      return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
    });

    if (!isAllowed) {
      // Allow verified motion recording paths from the database
      const dbRecording = await prisma.motionRecording.findFirst({
        where: { filePath: resolved },
        select: { id: true },
      });
      if (dbRecording) {
        isAllowed = true;
      }
    }

    if (!isAllowed) {
      return new Response("Access denied", { status: 403 });
    }

    if (!fs.existsSync(resolved)) {
      return new Response("File not found", { status: 404 });
    }

    let streamPath = resolved;
    let stat = fs.statSync(streamPath);
    if (compatible && !download) {
      streamPath = await ensureCompatibleVideo(resolved, stat);
      stat = fs.statSync(streamPath);
    }
    const fileSize = stat.size;
    const filename = path.basename(resolved);

    // Range header parsing
    const rangeHeader = req.headers.get("range");

    if (rangeHeader && !download) {
      const match = rangeHeader.match(/^bytes=(\d*)-(\d*)/i);
      if (!match || (!match[1] && !match[2])) {
        return new Response("Requested range not satisfiable", {
          status: 416,
          headers: {
            "Content-Range": `bytes */${fileSize}`,
          },
        });
      }

      const suffixLength = match[1] ? 0 : Number(match[2]);
      const start = match[1]
        ? Number(match[1])
        : Math.max(0, fileSize - Math.min(fileSize, suffixLength));
      const requestedEnd = match[2] && match[1] ? Number(match[2]) : fileSize - 1;
      const end = Math.min(requestedEnd, fileSize - 1);

      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= fileSize || end < start) {
        return new Response("Requested range not satisfiable", {
          status: 416,
          headers: { "Content-Range": `bytes */${fileSize}` },
        });
      }

      const chunkSize = end - start + 1;
      const nodeStream = fs.createReadStream(streamPath, { start, end });
      const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;

      return new Response(webStream, {
        status: 206,
        headers: {
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunkSize.toString(),
          "Content-Type": "video/mp4",
          "Cache-Control": "public, max-age=3600",
        },
      });
    }

    // Full file streaming
    const nodeStream = fs.createReadStream(streamPath);
    const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;

    const headers: Record<string, string> = {
      "Content-Length": fileSize.toString(),
      "Content-Type": "video/mp4",
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=3600",
    };

    if (download) {
      headers["Content-Disposition"] = `attachment; filename="${filename}"`;
    }

    return new Response(webStream, {
      status: 200,
      headers,
    });
  } catch (error: any) {
    console.error("GET /api/nvr/recordings/stream error:", error);
    return new Response(error?.message || "Stream error", { status: 500 });
  }
}
