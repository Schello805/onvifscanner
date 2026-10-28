import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { effectiveRecordingMode } from "@/lib/recordingPolicy";
import { recordingFileTime } from "@/lib/recordingTime";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const cameraId = searchParams.get("cameraId");
    const dateStr = searchParams.get("date"); // YYYY-MM-DD
    const objectClass = (searchParams.get("objectClass") || searchParams.get("class") || "").trim().toLowerCase();
    const query = (searchParams.get("query") || searchParams.get("q") || "").trim();

    const whereClause: any = {};

    if (cameraId) {
      whereClause.cameraId = cameraId;
    }

    if (objectClass === "plate" || objectClass === "license_plate") {
      whereClause.licensePlates = { not: null };
    } else if (objectClass) {
      whereClause.objectClasses = { contains: objectClass };
    }

    if (query) {
      whereClause.OR = [
        { message: { contains: query } },
        { licensePlates: { contains: query } },
        { objectClasses: { contains: query } },
      ];
    }

    if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      // Allow timezone window (+/- 14h) to cover any local timezone differences
      const startDate = new Date(`${dateStr}T00:00:00.000Z`);
      startDate.setHours(startDate.getHours() - 14);
      const endDate = new Date(`${dateStr}T23:59:59.999Z`);
      endDate.setHours(endDate.getHours() + 14);
      whereClause.timestamp = {
        gte: startDate,
        lte: endDate,
      };
    }

    const [events, defaultStorage] = await Promise.all([
      prisma.alarmLog.findMany({
        where: whereClause,
        orderBy: { timestamp: "asc" },
        take: 2000,
        include: {
          camera: {
            select: {
              id: true,
              name: true,
              recordEnabled: true,
              recordMode: true,
              recordSegmentMinutes: true,
              storageTargetId: true,
              storageTarget: { select: { path: true, enabled: true } },
              motionScheduleEnabled: true,
              motionScheduleStart: true,
              motionScheduleEnd: true,
              motionScheduleDays: true,
            },
          },
          motionRecording: {
            select: { id: true, status: true, filePath: true, startedAt: true, endedAt: true, error: true },
          },
        },
      }),
      prisma.storageTarget.findFirst({
        where: { isDefault: true, enabled: true },
        select: { path: true },
      }),
    ]);

    const fallbackLocalPath = path.resolve(process.cwd(), "data", "recordings");
    const defaultStoragePath = defaultStorage?.path ? path.resolve(defaultStorage.path) : fallbackLocalPath;
    const cameraClipsCache = new Map<string, Array<{ fullPath: string; startMs: number; filename: string }>>();
    const getCameraClips = async (cameraId: string, camStoragePath?: string | null) => {
      if (cameraClipsCache.has(cameraId)) return cameraClipsCache.get(cameraId)!;
      const dirsToCheck = Array.from(
        new Set(
          [
            camStoragePath ? path.resolve(camStoragePath) : null,
            defaultStoragePath,
            fallbackLocalPath,
          ].filter((p): p is string => Boolean(p))
        )
      );
      const list: Array<{ fullPath: string; startMs: number; filename: string }> = [];
      for (const baseDir of dirsToCheck) {
        const camDir = path.join(baseDir, cameraId);
        try {
          if (!fs.existsSync(camDir)) continue;
          const files = await fsp.readdir(camDir);
          for (const f of files) {
            if (f.startsWith(".") || /\.(?:partial|tmp)\./i.test(f)) continue;
            if (!/\.(?:mp4|m4s|ts)$/i.test(f)) continue;
            const m = f.match(/^(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})/);
            if (!m) continue;
            if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
              const diffDays = Math.abs(
                (Date.parse(`${m[1]}T00:00:00Z`) - Date.parse(`${dateStr}T00:00:00Z`)) / 86400000
              );
              if (diffDays > 1) continue;
            }
            const fullPath = path.join(camDir, f);
            try {
              const stat = await fsp.stat(fullPath);
              if (!stat.isFile()) continue;
              const { startMs } = recordingFileTime(f, stat.mtimeMs);
              if (Number.isFinite(startMs)) {
                list.push({ fullPath, startMs, filename: f });
              }
            } catch {}
          }
        } catch {}
      }
      list.sort((a, b) => a.startMs - b.startMs);
      cameraClipsCache.set(cameraId, list);
      return list;
    };

    const tz = process.env.TZ || "Europe/Berlin";
    let formatted = await Promise.all(events.map(async (ev) => {
      const d = new Date(ev.timestamp);
      const p = new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      }).formatToParts(d);
      const g = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
      const hours = g("hour");
      const mins = g("minute");
      const secs = g("second");
      const timeStr = `${hours}:${mins}:${secs}`;
      const totalMinutes = Number(hours) * 60 + Number(mins) + Number(secs) / 60;
      const evDateStr = `${g("year")}-${g("month")}-${g("day")}`;
      const recordingPath = ev.motionRecording?.status === "ready" ? ev.motionRecording.filePath : null;
      let clipId = recordingPath ? Buffer.from(recordingPath).toString("base64url") : null;
      let clipOffsetSec = 0;

      // Fallback for continuous recordings where motionRecordingId is null:
      // Resolve the continuous recording clip on disk that captured this event
      if (!clipId && ev.camera) {
        const camStorage = ev.camera.storageTarget?.enabled ? ev.camera.storageTarget.path : null;
        const camClips = await getCameraClips(ev.cameraId, camStorage);
        const evMs = d.getTime();
        const segMs = (ev.camera.recordSegmentMinutes || 15) * 60 * 1000;
        let matched: { fullPath: string; startMs: number; filename: string } | undefined;
        for (let i = 0; i < camClips.length; i++) {
          const curr = camClips[i];
          const nextStartMs = i + 1 < camClips.length ? camClips[i + 1].startMs : Infinity;
          const endMs = Math.min(curr.startMs + segMs + 15_000, nextStartMs);
          if (evMs >= curr.startMs && evMs < endMs) {
            matched = curr;
            break;
          }
        }
        if (!matched) {
          matched = camClips.find((c, i) => {
            const nextStartMs = i + 1 < camClips.length ? camClips[i + 1].startMs : Infinity;
            return evMs >= c.startMs - 5_000 && evMs < Math.min(c.startMs + segMs + 15_000, nextStartMs);
          });
        }
        if (matched) {
          clipId = Buffer.from(matched.fullPath).toString("base64url");
          clipOffsetSec = Math.max(0, Math.floor((evMs - matched.startMs) / 1000));
        }
      }

      const effectiveMode = ev.camera ? effectiveRecordingMode(ev.camera, d) : "off";
      const recordingStatus = ev.motionRecording?.status
        ?? (effectiveMode === "continuous" ? "continuous" : "disabled");

      return {
        id: ev.id,
        cameraId: ev.cameraId,
        cameraName: ev.camera?.name || "Kamera",
        timestamp: ev.timestamp.toISOString(),
        dateStr: evDateStr,
        timeStr,
        totalMinutes,
        message: ev.message || "Bewegung erkannt",
        objectClasses: (() => {
          try { return JSON.parse(ev.objectClasses || "[]"); } catch { return []; }
        })(),
        objectDetections: (() => {
          try { return JSON.parse(ev.objectDetections || "[]"); } catch { return []; }
        })(),
        licensePlates: (() => {
          try { return JSON.parse(ev.licensePlates || "[]"); } catch { return []; }
        })(),
        imageUrl: ev.imageUrl ?? null,
        motionRecordingId: ev.motionRecording?.id ?? null,
        motionRecordingStatus: recordingStatus,
        motionRecordingError: ev.motionRecording?.error ?? null,
        clipId,
        clipOffsetSec,
        streamUrl: clipId ? `/api/nvr/recordings/stream?clipId=${clipId}` : null,
      };
    }));

    if (dateStr) {
      formatted = formatted.filter((ev) => ev.dateStr === dateStr);
    }

    return NextResponse.json({ ok: true, events: formatted });
  } catch (err) {
    console.error("Error fetching alarm events:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
