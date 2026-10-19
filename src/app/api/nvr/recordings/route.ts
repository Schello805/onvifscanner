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

type CalendarDay = {
  date: string;
  count: number;
  cameras: Array<{ id: string; name: string; count: number }>;
};

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const filterCameraId = searchParams.get("cameraId");
    const filterDate = searchParams.get("date"); // YYYY-MM-DD
    const calendarMonthRaw = searchParams.get("calendarMonth");
    const calendarMonth = calendarMonthRaw && /^\d{4}-\d{2}$/.test(calendarMonthRaw) ? calendarMonthRaw : null;

    const cameras = await prisma.camera.findMany({
      select: { id: true, name: true, storageTargetId: true },
    });
    const cameraMap = new Map(cameras.map((c) => [c.id, c.name]));

    const storageTargets = await prisma.storageTarget.findMany({
      where: { enabled: true },
    });

    const clips: RecordingClip[] = [];
    const calendarDays = new Map<string, { count: number; cameras: Map<string, number> }>();
    const unavailableStorageTargets: string[] = [];

    for (const target of storageTargets) {
      if (!fs.existsSync(target.path)) {
        unavailableStorageTargets.push(target.name);
        continue;
      }

      let cameraDirs: string[] = [];
      try {
        const entries = await fsp.readdir(target.path, { withFileTypes: true });
        cameraDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
      } catch {
        unavailableStorageTargets.push(target.name);
        continue;
      }

      for (const camDir of cameraDirs) {
        if (filterCameraId && camDir !== filterCameraId) continue;
        const camPath = path.join(target.path, camDir);

        let files: string[] = [];
        try {
          files = await fsp.readdir(camPath);
        } catch {
          if (!unavailableStorageTargets.includes(target.name)) {
            unavailableStorageTargets.push(target.name);
          }
          continue;
        }

        for (const file of files) {
          if (!file.endsWith(".mp4") && !file.endsWith(".m4s")) continue;

          // Expected filename pattern: YYYY-MM-DD_HH-mm-ss...
          // e.g., 2026-10-09_12-30-00.mp4 or 2026-10-09_12-30-00-123456.mp4
          const dateMatch = file.match(/^(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})/);
          // Dateiname enthält Datum evtl. in UTC (ältere Aufnahmen) – daher nur grob vorfiltern (±1 Tag)
          if (filterDate && dateMatch) {
            const diffDays = Math.abs(
              (Date.parse(`${dateMatch[1]}T00:00:00Z`) - Date.parse(`${filterDate}T00:00:00Z`)) / 86400000
            );
            if (diffDays > 1) continue;
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

              // Legacy: Name in UTC geschrieben? (Dateiende-Zeit liegt kurz nach der Namens-Zeit als UTC gelesen)
              const utcMs = Date.parse(`${dateStr}T${timeStr}Z`);
              if (!isNaN(utcMs) && Math.abs(stat.mtimeMs - utcMs) < 40 * 60 * 1000) {
                const p = new Intl.DateTimeFormat("en-CA", {
                  timeZone: "Europe/Berlin",
                  year: "numeric",
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                  hourCycle: "h23",
                }).formatToParts(new Date(utcMs));
                const g = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
                dateStr = `${g("year")}-${g("month")}-${g("day")}`;
                timeStr = `${g("hour")}:${g("minute")}:${g("second")}`;
              }
              isoDate = `${dateStr}T${timeStr}Z`;
            } else {
              const p = new Intl.DateTimeFormat("en-CA", {
                timeZone: process.env.TZ || "Europe/Berlin",
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hourCycle: "h23",
              }).formatToParts(stat.mtime);
              const g = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
              dateStr = `${g("year")}-${g("month")}-${g("day")}`;
              timeStr = `${g("hour")}:${g("minute")}:${g("second")}`;
            }

            if (filterDate && dateStr !== filterDate) continue;

            if (calendarMonth) {
              if (dateStr.startsWith(`${calendarMonth}-`)) {
                const day = calendarDays.get(dateStr) ?? { count: 0, cameras: new Map<string, number>() };
                day.count += 1;
                day.cameras.set(camDir, (day.cameras.get(camDir) ?? 0) + 1);
                calendarDays.set(dateStr, day);
              }
              continue;
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

    if (calendarMonth) {
      const days: CalendarDay[] = Array.from(calendarDays.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([date, day]) => ({
          date,
          count: day.count,
          cameras: Array.from(day.cameras.entries())
            .map(([id, count]) => ({ id, name: cameraMap.get(id) || `Kamera ${id}`, count }))
            .sort((left, right) => left.name.localeCompare(right.name, "de", { numeric: true, sensitivity: "base" })),
        }));

      return NextResponse.json({
        month: calendarMonth,
        days,
        totalCount: days.reduce((sum, day) => sum + day.count, 0),
        partial: unavailableStorageTargets.length > 0,
        unavailableStorageTargets,
      });
    }

    // Sort newest first
    clips.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    return NextResponse.json({
      clips,
      totalCount: clips.length,
      partial: unavailableStorageTargets.length > 0,
      unavailableStorageTargets,
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
    const deletedPaths: string[] = [];

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
                  const deletedPath = path.join(camDirPath, file);
                  await fsp.unlink(deletedPath);
                  deletedPaths.push(deletedPath);
                  deletedCount++;
                } catch {}
              }
            }
          }
        } catch {}
      }

      if (deletedPaths.length) {
        await prisma.motionRecording.updateMany({
          where: { filePath: { in: deletedPaths } },
          data: { status: "deleted", filePath: null },
        });
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
          deletedPaths.push(resolved);
          deletedCount++;
        }
      } catch {}
    }

    if (deletedPaths.length) {
      await prisma.motionRecording.updateMany({
        where: { filePath: { in: deletedPaths } },
        data: { status: "deleted", filePath: null },
      });
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
