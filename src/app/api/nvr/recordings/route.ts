import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type RecordingClip = {
  id: string; // base64 encoded relative or absolute verified path
  cameraId: string;
  cameraName: string;
  filename: string;
  dateStr: string; // YYYY-MM-DD
  timeStr: string; // HH:mm:ss
  timestamp: string; // ISO string
  sizeBytes: number;
  durationEstimateSec?: number;
  storageTargetName: string;
  streamUrl: string;
  downloadUrl: string;
};

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const filterCameraId = searchParams.get("cameraId");
    const filterDate = searchParams.get("date"); // YYYY-MM-DD

    const cameras = await prisma.camera.findMany({
      select: { id: true, name: true, storageTargetId: true },
    });
    const cameraMap = new Map(cameras.map((c) => [c.id, c.name]));

    const storageTargets = await prisma.storageTarget.findMany({
      where: { enabled: true },
    });

    const clips: RecordingClip[] = [];

    for (const target of storageTargets) {
      if (!fs.existsSync(target.path)) continue;

      let cameraDirs: string[] = [];
      try {
        const entries = await fsp.readdir(target.path, { withFileTypes: true });
        cameraDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
      } catch {
        continue;
      }

      for (const camDir of cameraDirs) {
        if (filterCameraId && camDir !== filterCameraId) continue;
        const camPath = path.join(target.path, camDir);

        let files: string[] = [];
        try {
          files = await fsp.readdir(camPath);
        } catch {
          continue;
        }

        for (const file of files) {
          if (!file.endsWith(".mp4") && !file.endsWith(".m4s")) continue;

          // Expected filename pattern: YYYY-MM-DD_HH-mm-ss...
          // e.g., 2026-10-09_12-30-00.mp4 or 2026-10-09_12-30-00-123456.mp4
          const dateMatch = file.match(/^(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})/);
          if (filterDate && dateMatch && dateMatch[1] !== filterDate) {
            continue;
          }

          const fullFilePath = path.join(camPath, file);
          try {
            const stat = await fsp.stat(fullFilePath);
            if (!stat.isFile()) continue;

            let dateStr = "";
            let timeStr = "";
            let isoDate = stat.mtime.toISOString();

            if (dateMatch) {
              dateStr = dateMatch[1];
              timeStr = `${dateMatch[2]}:${dateMatch[3]}:${dateMatch[4]}`;
              isoDate = `${dateStr}T${dateMatch[2]}:${dateMatch[3]}:${dateMatch[4]}Z`;
            } else {
              dateStr = stat.mtime.toISOString().slice(0, 10);
              timeStr = stat.mtime.toISOString().slice(11, 19);
            }

            const clipId = Buffer.from(fullFilePath).toString("base64url");
            clips.push({
              id: clipId,
              cameraId: camDir,
              cameraName: cameraMap.get(camDir) || `Kamera ${camDir}`,
              filename: file,
              dateStr,
              timeStr,
              timestamp: isoDate,
              sizeBytes: stat.size,
              storageTargetName: target.name,
              streamUrl: `/api/nvr/recordings/stream?clipId=${clipId}`,
              downloadUrl: `/api/nvr/recordings/stream?clipId=${clipId}&download=1`,
            });
          } catch {}
        }
      }
    }

    // Sort newest first
    clips.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    return NextResponse.json({
      clips,
      totalCount: clips.length,
    });
  } catch (error: any) {
    console.error("GET /api/nvr/recordings error:", error);
    return NextResponse.json({ error: error?.message || "Fehler beim Laden der Aufnahmen." }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const body = await req.json().catch(() => ({}));
    let clipId = searchParams.get("clipId");
    let clipIds: string[] = [];
    let cameraIds: string[] = [];
    const deleteAll = Boolean(body?.allRecordings || searchParams.get("allRecordings") === "true");

    if (clipId) {
      clipIds = [clipId];
    } else if (Array.isArray(body?.clipIds) && body.clipIds.length > 0) {
      clipIds = body.clipIds;
    } else if (body?.clipId) {
      clipIds = [String(body.clipId)];
    }

    if (searchParams.get("cameraId")) {
      cameraIds = [searchParams.get("cameraId")!];
    } else if (Array.isArray(body?.cameraIds) && body.cameraIds.length > 0) {
      cameraIds = body.cameraIds.map(String);
    } else if (body?.cameraId) {
      cameraIds = [String(body.cameraId)];
    }

    const targets = await prisma.storageTarget.findMany();
    const targetPaths = targets.map((t) => path.resolve(t.path));

    let deletedCount = 0;

    // Mode 1: Delete all recordings of specific camera(s) or all cameras
    if (deleteAll || cameraIds.length > 0) {
      for (const targetPath of targetPaths) {
        if (!fs.existsSync(targetPath)) continue;
        try {
          const entries = await fsp.readdir(targetPath, { withFileTypes: true });
          for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const camId = entry.name;
            if (!deleteAll && !cameraIds.includes(camId)) continue;

            const camDirPath = path.join(targetPath, camId);
            const files = await fsp.readdir(camDirPath).catch(() => []);
            for (const file of files) {
              if (file.endsWith(".mp4") || file.endsWith(".m4s")) {
                try {
                  await fsp.unlink(path.join(camDirPath, file));
                  deletedCount++;
                } catch {}
              }
            }
          }
        } catch {}
      }

      return NextResponse.json({
        ok: true,
        deletedCount,
        message: deleteAll
          ? `Alle ${deletedCount} Aufnahmen im System wurden gelöscht.`
          : `${deletedCount} Aufnahme(n) von ${cameraIds.length} Kamera(s) wurden gelöscht.`,
      });
    }

    // Mode 2: Delete specific clip IDs
    if (clipIds.length === 0) {
      return NextResponse.json({ error: "Keine Clip- oder Kamera-ID(s) übergeben." }, { status: 400 });
    }

    for (const id of clipIds) {
      try {
        const decodedPath = Buffer.from(id, "base64url").toString("utf-8");
        const resolved = path.resolve(decodedPath);

        const isAllowed = targetPaths.some((tp) => resolved.startsWith(tp));
        if (!isAllowed) continue;

        if (fs.existsSync(resolved)) {
          await fsp.unlink(resolved);
          deletedCount++;
        }
      } catch {}
    }

    return NextResponse.json({
      ok: true,
      deletedCount,
      message: `${deletedCount} Aufnahme(n) erfolgreich gelöscht.`,
    });
  } catch (error: any) {
    console.error("DELETE /api/nvr/recordings error:", error);
    return NextResponse.json({ error: error?.message || "Fehler beim Löschen der Aufnahme(n)." }, { status: 500 });
  }
}
