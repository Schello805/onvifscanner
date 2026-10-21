import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import crypto from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { createShareLink } from "@/lib/shareLinks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);
const EXPORT_DIR = path.join(process.cwd(), "data", "exports");

async function ensureExportDir() {
  if (!fs.existsSync(EXPORT_DIR)) {
    await fsp.mkdir(EXPORT_DIR, { recursive: true });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { clipId, overlay = true, shareHours = 48 } = body;

    if (!clipId || typeof clipId !== "string") {
      return NextResponse.json({ error: "clipId erforderlich" }, { status: 400 });
    }

    await ensureExportDir();

    // 1. Resolve source file from MotionRecording or disk
    let sourcePath: string | null = null;
    let cameraName = "Kamera";
    let startTimeStr = "";

    const motionRec = await prisma.motionRecording.findUnique({
      where: { id: clipId },
      include: { camera: true },
    });

    if (motionRec && motionRec.filePath && fs.existsSync(motionRec.filePath)) {
      sourcePath = motionRec.filePath;
      cameraName = motionRec.camera.name || "Kamera";
      startTimeStr = motionRec.startedAt.toISOString().replace("T", " ").slice(0, 19);
    } else {
      // Check default recordings directory
      const defaultStorage = await prisma.storageTarget.findFirst({
        where: { isDefault: true, enabled: true },
      });
      const basePath = defaultStorage?.path || path.join(process.cwd(), "data", "recordings");
      const candidate = path.join(basePath, clipId);
      if (fs.existsSync(candidate)) {
        sourcePath = candidate;
      }
    }

    if (!sourcePath || !fs.existsSync(sourcePath)) {
      return NextResponse.json({ error: "Videodatei nicht gefunden" }, { status: 404 });
    }

    let finalExportPath = sourcePath;

    // 2. Burn timestamp overlay if requested
    if (overlay) {
      const sourceStat = await fsp.stat(sourcePath);
      const hash = crypto
        .createHash("sha256")
        .update(`${sourcePath}:${sourceStat.size}:${sourceStat.mtimeMs}:overlay`)
        .digest("hex")
        .slice(0, 16);

      const overlayFile = path.join(EXPORT_DIR, `export_${hash}.mp4`);

      if (!fs.existsSync(overlayFile)) {
        const textLabel = startTimeStr ? `${cameraName} · ${startTimeStr}` : cameraName;
        const sanitizedText = textLabel.replace(/[:\\']/g, " ");

        try {
          await execFileAsync("ffmpeg", [
            "-y", "-hide_banner", "-loglevel", "error",
            "-i", sourcePath,
            "-vf", `drawtext=text='${sanitizedText}':fontcolor=white:fontsize=20:box=1:boxcolor=black@0.65:boxborderw=6:x=20:y=20`,
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
            "-c:a", "aac", "-b:a", "128k",
            "-movflags", "+faststart",
            overlayFile,
          ], { timeout: 60_000 });
          finalExportPath = overlayFile;
        } catch (ffmpegErr: any) {
          console.warn("Overlay render failed, using original file:", ffmpegErr?.message || ffmpegErr);
          finalExportPath = sourcePath;
        }
      } else {
        finalExportPath = overlayFile;
      }
    }

    // 3. Create public share link if shareHours > 0
    let shareResult = null;
    if (shareHours > 0) {
      shareResult = await createShareLink({
        clipId,
        filePath: finalExportPath,
        cameraName,
        expiresHours: Number(shareHours),
        hasOverlay: overlay,
      });
    }

    return NextResponse.json({
      ok: true,
      hasOverlay: finalExportPath !== sourcePath,
      shareToken: shareResult?.token || null,
      shareUrl: shareResult ? `/share/${shareResult.token}` : null,
      expiresAt: shareResult?.expiresAt || null,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Export fehlgeschlagen" }, { status: 500 });
  }
}
