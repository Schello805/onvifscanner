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
  durationSeconds?: number;
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
    const singleClipId = searchParams.get("clipId");
    const calendarMonthRaw = searchParams.get("calendarMonth");
    const calendarMonth = calendarMonthRaw && /^\d{4}-\d{2}$/.test(calendarMonthRaw) ? calendarMonthRaw : null;

    const cameras = await prisma.camera.findMany({
      select: { id: true, name: true, storageTargetId: true, recordSegmentMinutes: true },
    });
    const cameraMap = new Map(cameras.map((c) => [c.id, c.name]));

    const storageTargets = await prisma.storageTarget.findMany({
      where: { enabled: true },
    });

    // Ensure default recording directory is always checked and exists
    const defaultDataDir = path.resolve(process.cwd(), "data", "recordings");
    if (!fs.existsSync(defaultDataDir)) {
      try {
        fs.mkdirSync(defaultDataDir, { recursive: true });
      } catch {}
    }
    const allTargets = [...storageTargets];
    if (!allTargets.some((t) => path.resolve(t.path) === defaultDataDir)) {
      allTargets.push({
        id: "default-local-storage",
        name: "Lokaler Speicher",
        path: defaultDataDir,
        enabled: true,
        isDefault: true,
        maxDays: 14,
        minFreeSpaceGb: 10,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    // Direct single clip lookup
    if (singleClipId) {
      try {
        const decodedPath = Buffer.from(singleClipId, "base64url").toString("utf-8");
        const resolved = path.resolve(decodedPath);
        if (fs.existsSync(resolved)) {
          const stat = await fsp.stat(resolved);
          if (stat.isFile()) {
            const filename = path.basename(resolved);
            const parentDir = path.basename(path.dirname(resolved));
            const dateMatch = filename.match(/^(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})/);
            let dateStr = dateMatch ? dateMatch[1] : stat.mtime.toISOString().slice(0, 10);
            let timeStr = dateMatch ? `${dateMatch[2]}:${dateMatch[3]}:${dateMatch[4]}` : stat.mtime.toISOString().slice(11, 19);

            let durationSeconds = 900;
            if (dateMatch) {
              const utcMs = Date.parse(`${dateMatch[1]}T${dateMatch[2]}:${dateMatch[3]}:${dateMatch[4]}Z`);
              const baseStartMs = !isNaN(utcMs) && Math.abs(stat.mtimeMs - utcMs) < 40 * 60 * 1000
                ? utcMs
                : new Date(`${dateMatch[1]}T${dateMatch[2]}:${dateMatch[3]}:${dateMatch[4]}`).getTime();
              const diff = Math.floor((stat.mtimeMs - baseStartMs) / 1000);
              if (diff > 0 && diff < 3600) durationSeconds = diff;
            }

            return NextResponse.json({
              clips: [{
                id: singleClipId,
                cameraId: parentDir,
                cameraName: cameraMap.get(parentDir) || `Kamera ${parentDir}`,
                filename,
                dateStr,
                timeStr,
                timestamp: `${dateStr}T${timeStr}Z`,
                sizeBytes: stat.size,
                durationSeconds,
                storageTargetName: "Lokaler Speicher",
                streamUrl: `/api/nvr/recordings/stream?clipId=${singleClipId}`,
                downloadUrl: `/api/nvr/recordings/stream?clipId=${singleClipId}&download=1`,
              }],
              totalCount: 1,
            });
          }
        }
      } catch {}
    }

    const clips: RecordingClip[] = [];
    const calendarDays = new Map<string, { count: number; cameras: Map<string, number> }>();
    const unavailableStorageTargets: string[] = [];

    for (const target of allTargets) {
      const targetDir = path.resolve(target.path);
      if (!fs.existsSync(targetDir)) {
        unavailableStorageTargets.push(target.name);
        continue;
      }

      let cameraDirs: string[] = [];
      try {
        const entries = await fsp.readdir(targetDir, { withFileTypes: true });
        cameraDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
      } catch {
        unavailableStorageTargets.push(target.name);
        continue;
      }

      for (const camDir of cameraDirs) {
        if (filterCameraId && camDir !== filterCameraId) continue;
        const camPath = path.join(targetDir, camDir);

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
          if (!/\.(?:mp4|m4s|ts)$/i.test(file)) continue;

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

            let baseStartMs = stat.mtimeMs;
            if (dateMatch) {
              dateStr = dateMatch[1];
              timeStr = `${dateMatch[2]}:${dateMatch[3]}:${dateMatch[4]}`;

              // Legacy: Name in UTC geschrieben? (Dateiende-Zeit liegt kurz nach der Namens-Zeit als UTC gelesen)
              const utcMs = Date.parse(`${dateStr}T${timeStr}Z`);
              if (!isNaN(utcMs) && Math.abs(stat.mtimeMs - utcMs) < 40 * 60 * 1000) {
                baseStartMs = utcMs;
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
              } else {
                baseStartMs = new Date(`${dateStr}T${timeStr}`).getTime();
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

            let matchesDate = !filterDate || dateStr === filterDate;
            if (!matchesDate && filterDate) {
              // Also include clips starting late on the previous day (>= 22:00) that overlap into the morning
              const prevDate = new Date(`${filterDate}T00:00:00Z`);
              prevDate.setUTCDate(prevDate.getUTCDate() - 1);
              const prevDateStr = prevDate.toISOString().slice(0, 10);
              if (dateStr === prevDateStr && timeStr >= "22:00:00") {
                matchesDate = true;
              }
            }
            if (!matchesDate) continue;

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
              mtimeMs: stat.mtimeMs,
              baseStartMs,
            } as any);
          } catch {}
        }
      }
    }

    // Merge ready motion recordings from database if not already indexed
    if (!calendarMonth) {
      const existingClipIds = new Set(clips.map((c) => c.id));
      const motionWhere: any = { status: "ready", filePath: { not: null } };
      if (filterCameraId) motionWhere.cameraId = filterCameraId;
      if (filterDate && /^\d{4}-\d{2}-\d{2}$/.test(filterDate)) {
        const dStart = new Date(`${filterDate}T00:00:00.000Z`);
        dStart.setHours(dStart.getHours() - 14);
        const dEnd = new Date(`${filterDate}T23:59:59.999Z`);
        dEnd.setHours(dEnd.getHours() + 14);
        motionWhere.startedAt = { gte: dStart, lte: dEnd };
      }

      try {
        const dbMotionRecs = await prisma.motionRecording.findMany({
          where: motionWhere,
          orderBy: { startedAt: "desc" },
          take: 500,
        });

        for (const rec of dbMotionRecs) {
          if (!rec.filePath) continue;
          const clipId = Buffer.from(rec.filePath).toString("base64url");
          if (existingClipIds.has(clipId)) continue;
          if (!fs.existsSync(rec.filePath)) continue;

          try {
            const stat = await fsp.stat(rec.filePath);
            if (!stat.isFile()) continue;

            const p = new Intl.DateTimeFormat("en-CA", {
              timeZone: process.env.TZ || "Europe/Berlin",
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              hourCycle: "h23",
            }).formatToParts(rec.startedAt);
            const g = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
            const dateStr = `${g("year")}-${g("month")}-${g("day")}`;
            const timeStr = `${g("hour")}:${g("minute")}:${g("second")}`;

            if (filterDate && dateStr !== filterDate) continue;

            const motionDuration = Math.max(1, Math.round((new Date(rec.endedAt).getTime() - new Date(rec.startedAt).getTime()) / 1000));
            clips.push({
              id: clipId,
              cameraId: rec.cameraId,
              cameraName: cameraMap.get(rec.cameraId) || `Kamera ${rec.cameraId}`,
              filename: path.basename(rec.filePath),
              dateStr,
              timeStr,
              timestamp: rec.startedAt.toISOString(),
              sizeBytes: stat.size,
              durationSeconds: motionDuration,
              storageTargetName: "Ereignis-Speicher",
              streamUrl: `/api/nvr/recordings/stream?clipId=${clipId}`,
              downloadUrl: `/api/nvr/recordings/stream?clipId=${clipId}&download=1`,
            });
            existingClipIds.add(clipId);
          } catch {}
        }
      } catch {}
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

    // Calculate accurate durationSeconds for each clip
    const camConfigMap = new Map(cameras.map((c) => [c.id, c]));
    const clipsByCam = new Map<string, typeof clips>();
    for (const c of clips) {
      const list = clipsByCam.get(c.cameraId) || [];
      list.push(c);
      clipsByCam.set(c.cameraId, list);
    }

    const parseTimeToSec = (t: string): number => {
      const parts = t.split(":").map(Number);
      return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
    };

    clipsByCam.forEach((camClips, camId) => {
      // Sort chronologically ascending
      camClips.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      const camConfig = camConfigMap.get(camId);
      const configuredSegmentSec = Math.max(1, (camConfig?.recordSegmentMinutes || 15) * 60);

      for (let i = 0; i < camClips.length; i++) {
        const c = camClips[i] as any;
        if (typeof c.durationSeconds === "number" && c.durationSeconds > 0) continue;

        let dur = configuredSegmentSec;

        // 1. Distance to next clip on the same camera and day
        if (i < camClips.length - 1) {
          const next = camClips[i + 1];
          if (next.dateStr === c.dateStr) {
            const nextSec = parseTimeToSec(next.timeStr);
            const currSec = parseTimeToSec(c.timeStr);
            const gapSec = nextSec - currSec;
            if (gapSec > 0 && gapSec < configuredSegmentSec) {
              dur = Math.min(dur, gapSec);
            }
          }
        }

        // 2. Check mtime write duration
        if (c.mtimeMs && c.baseStartMs && c.mtimeMs > c.baseStartMs) {
          const mtimeDiffSec = Math.floor((c.mtimeMs - c.baseStartMs) / 1000);
          if (mtimeDiffSec > 0 && mtimeDiffSec < configuredSegmentSec) {
            dur = Math.min(dur, Math.max(1, mtimeDiffSec));
          }
        }

        c.durationSeconds = Math.max(1, dur);
        delete c.mtimeMs;
        delete c.baseStartMs;
      }
    });

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
