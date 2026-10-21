import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { effectiveRecordingMode } from "@/lib/recordingPolicy";
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

    const defaultStoragePath = defaultStorage?.path || path.join(process.cwd(), "data", "recordings");
    const cameraClipsCache = new Map<string, Array<{ fullPath: string; startMs: number; filename: string }>>();
    const getCameraClips = async (cameraId: string, camStoragePath?: string | null) => {
      if (cameraClipsCache.has(cameraId)) return cameraClipsCache.get(cameraId)!;
      const camDir = path.join(camStoragePath || defaultStoragePath, cameraId);
      const list: Array<{ fullPath: string; startMs: number; filename: string }> = [];
      try {
        if (fs.existsSync(camDir)) {
          const files = await fsp.readdir(camDir);
          for (const f of files) {
            if (!/\.(?:mp4|m4s|ts)$/i.test(f)) continue;
            const m = f.match(/^(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})/);
            if (m) {
              const startMs = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`);
              if (!isNaN(startMs)) {
                list.push({ fullPath: path.join(camDir, f), startMs, filename: f });
              }
            }
          }
          list.sort((a, b) => a.startMs - b.startMs);
        }
      } catch {}
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
        const segMs = ((ev.camera.recordSegmentMinutes || 15) + 1) * 60 * 1000;
        const matched = camClips.find((c) => evMs >= c.startMs && evMs - c.startMs <= segMs)
          || camClips.find((c) => Math.abs(evMs - c.startMs) <= 5 * 60 * 1000);
        if (matched) {
          clipId = Buffer.from(matched.fullPath).toString("base64url");
          clipOffsetSec = Math.max(0, Math.floor((evMs - matched.startMs) / 1000));
        }
      }

      const effectiveMode = ev.camera ? effectiveRecordingMode(ev.camera, d) : "off";
      const recordingStatus = ev.motionRecording?.status
        ?? (effectiveMode === "motion" ? "pending" : effectiveMode === "continuous" ? "continuous" : "disabled");

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
