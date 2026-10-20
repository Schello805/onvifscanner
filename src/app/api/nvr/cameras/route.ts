import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { syncCameraWithMediaMtx } from "@/lib/nvr/manager";
import { RECORDING_MODES, normalizeRecordingMode, recordingModeUsesSchedule } from "@/lib/recordingPolicy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const cameras = await prisma.camera.findMany({
      include: {
        status: true,
        storageTarget: {
          select: { id: true, name: true, path: true, isDefault: true, enabled: true },
        },
      },
      orderBy: { sortOrder: "asc" },
    });

    const defaultStorage = await prisma.storageTarget.findFirst({
      where: { isDefault: true },
      select: { id: true, name: true, path: true },
    });

    const formatted = cameras.map((c) => ({
      id: c.id,
      name: c.name,
      ip: c.ip,
      resolution: c.resolution,
      isOnline: c.status?.isOnline ?? false,
      recordEnabled: c.recordEnabled,
      recordMode: normalizeRecordingMode(c),
      recordSegmentMinutes: c.recordSegmentMinutes,
      motionPreRollSeconds: c.motionPreRollSeconds,
      motionPostRollSeconds: c.motionPostRollSeconds,
      alarmCooldownSeconds: c.alarmCooldownSeconds,
      motionSensitivity: c.motionSensitivity,
      motionIgnoreRegions: (() => {
        try { return JSON.parse(c.motionIgnoreRegions || "[]"); } catch { return []; }
      })(),
      objectDetectionEnabled: c.objectDetectionEnabled,
      objectDetectionClasses: (() => {
        try { return JSON.parse(c.objectDetectionClasses || "[]"); } catch { return []; }
      })(),
      objectMinConfidence: c.objectMinConfidence,
      licensePlateRecognitionEnabled: c.licensePlateRecognitionEnabled,
      motionScheduleEnabled: c.motionScheduleEnabled,
      motionScheduleStart: c.motionScheduleStart,
      motionScheduleEnd: c.motionScheduleEnd,
      motionScheduleDays: (() => {
        try { return JSON.parse(c.motionScheduleDays || "[]"); } catch { return []; }
      })(),
      motionScheduleSensitivity: c.motionScheduleSensitivity,
      notificationsEnabled: c.notificationsEnabled,
      motionEventState: c.motionEventState,
      motionEventSource: c.motionEventSource,
      motionEventLastSeen: c.motionEventLastSeen?.toISOString() ?? null,
      motionEventCheckedAt: c.motionEventCheckedAt?.toISOString() ?? null,
      motionEventLastError: c.motionEventLastError,
      storageTargetId: c.storageTargetId,
      storageTarget: c.storageTarget || defaultStorage || null,
      streamUris: (() => {
        try { return JSON.parse(c.streamUris); } catch { return []; }
      })(),
    }));

    return NextResponse.json({ cameras: formatted });
  } catch (error: any) {
    console.error("GET /api/nvr/cameras error:", error);
    return NextResponse.json({ error: error?.message || "Fehler beim Laden der Kamera-Aufnahmeeinstellungen." }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();

    let ids: string[] = [];
    if (Array.isArray(body?.ids) && body.ids.length > 0) {
      ids = body.ids.map(String);
    } else if (body?.id) {
      ids = [String(body.id).trim()];
    } else if (body?.all) {
      const allCams = await prisma.camera.findMany({ select: { id: true } });
      ids = allCams.map((c) => c.id);
    }

    if (ids.length === 0) {
      return NextResponse.json({ error: "Keine Kamera-ID(s) übergeben." }, { status: 400 });
    }

    const updateData: Record<string, any> = {};

    if (body.recordMode !== undefined) {
      const recordMode = String(body.recordMode);
      if (!RECORDING_MODES.includes(recordMode as (typeof RECORDING_MODES)[number])) {
        return NextResponse.json({ error: "Ungültiger Aufnahmemodus." }, { status: 400 });
      }
      updateData.recordMode = recordMode;
      updateData.recordEnabled = recordMode !== 'off';
      updateData.motionScheduleEnabled = recordingModeUsesSchedule(recordMode);
    } else if (body.recordEnabled !== undefined) {
      updateData.recordEnabled = Boolean(body.recordEnabled);
      updateData.recordMode = body.recordEnabled ? 'motion' : 'off';
    }
    if (body.recordSegmentMinutes !== undefined) {
      updateData.recordSegmentMinutes = Math.max(1, Number(body.recordSegmentMinutes) || 15);
    }
    if (body.motionPreRollSeconds !== undefined) {
      updateData.motionPreRollSeconds = Math.min(60, Math.max(0, Number(body.motionPreRollSeconds) || 0));
    }
    if (body.motionPostRollSeconds !== undefined) {
      updateData.motionPostRollSeconds = Math.min(300, Math.max(5, Number(body.motionPostRollSeconds) || 30));
    }
    if (body.motionSensitivity !== undefined) {
      updateData.motionSensitivity = Math.min(100, Math.max(1, Math.round(Number(body.motionSensitivity) || 80)));
    }
    if (body.motionIgnoreRegions !== undefined) {
      const regions = Array.isArray(body.motionIgnoreRegions) ? body.motionIgnoreRegions : [];
      updateData.motionIgnoreRegions = JSON.stringify(regions.slice(0, 256).flatMap((region: unknown) => {
        if (!region || typeof region !== "object") return [];
        const source = region as Record<string, unknown>;
        const x = Math.min(1, Math.max(0, Number(source.x)));
        const y = Math.min(1, Math.max(0, Number(source.y)));
        const width = Math.min(1 - x, Math.max(0, Number(source.width)));
        const height = Math.min(1 - y, Math.max(0, Number(source.height)));
        return Number.isFinite(x) && Number.isFinite(y) && width >= 0.01 && height >= 0.01
          ? [{ x, y, width, height }]
          : [];
      }));
    }
    if (body.objectDetectionEnabled !== undefined) updateData.objectDetectionEnabled = Boolean(body.objectDetectionEnabled);
    if (body.objectDetectionClasses !== undefined) {
      const classes = Array.isArray(body.objectDetectionClasses) ? body.objectDetectionClasses : [];
      updateData.objectDetectionClasses = JSON.stringify(Array.from(new Set(classes.filter((entry: unknown): entry is string => typeof entry === "string"))).slice(0, 16));
    }
    if (body.objectMinConfidence !== undefined) {
      updateData.objectMinConfidence = Math.min(95, Math.max(20, Math.round(Number(body.objectMinConfidence) || 55)));
    }
    if (body.licensePlateRecognitionEnabled !== undefined) {
      updateData.licensePlateRecognitionEnabled = Boolean(body.licensePlateRecognitionEnabled);
    }
    if (body.recordMode === undefined && body.motionScheduleEnabled !== undefined) {
      updateData.motionScheduleEnabled = Boolean(body.motionScheduleEnabled);
    }
    if (body.motionScheduleStart !== undefined && /^([01]\d|2[0-3]):[0-5]\d$/.test(String(body.motionScheduleStart))) updateData.motionScheduleStart = String(body.motionScheduleStart);
    if (body.motionScheduleEnd !== undefined && /^([01]\d|2[0-3]):[0-5]\d$/.test(String(body.motionScheduleEnd))) updateData.motionScheduleEnd = String(body.motionScheduleEnd);
    if (body.motionScheduleDays !== undefined) {
      const days = Array.isArray(body.motionScheduleDays) ? body.motionScheduleDays : [];
      updateData.motionScheduleDays = JSON.stringify(Array.from(new Set(days.map(Number).filter((day: number) => Number.isInteger(day) && day >= 0 && day <= 6))).sort());
    }
    if (body.motionScheduleSensitivity !== undefined) {
      updateData.motionScheduleSensitivity = Math.min(100, Math.max(1, Math.round(Number(body.motionScheduleSensitivity) || 90)));
    }
    if (body.notificationsEnabled !== undefined) {
      updateData.notificationsEnabled = Boolean(body.notificationsEnabled);
    }
    if (body.alarmCooldownSeconds !== undefined) {
      updateData.alarmCooldownSeconds = Math.min(3600, Math.max(10, Math.round(Number(body.alarmCooldownSeconds) || 30)));
    }
    if (body.storageTargetId !== undefined) {
      updateData.storageTargetId = body.storageTargetId ? String(body.storageTargetId).trim() : null;
    }

    await prisma.camera.updateMany({
      where: { id: { in: ids } },
      data: updateData,
    });

    // Synchronize modified cameras with MediaMTX
    for (const id of ids) {
      await syncCameraWithMediaMtx(id).catch(() => null);
    }

    return NextResponse.json({
      ok: true,
      updatedCount: ids.length,
      message: `${ids.length} Kamera(s) erfolgreich aktualisiert.`,
    });
  } catch (error: any) {
    console.error("PATCH /api/nvr/cameras error:", error);
    return NextResponse.json({ error: error?.message || "Fehler beim Aktualisieren der Kamera-Aufnahme." }, { status: 500 });
  }
}
