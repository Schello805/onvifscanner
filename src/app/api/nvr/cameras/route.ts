import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { syncCameraWithMediaMtx } from "@/lib/nvr/manager";

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
      recordMode: c.recordMode,
      recordSegmentMinutes: c.recordSegmentMinutes,
      motionPreRollSeconds: c.motionPreRollSeconds,
      motionPostRollSeconds: c.motionPostRollSeconds,
      motionSensitivity: c.motionSensitivity,
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
      if (!['off', 'motion', 'continuous'].includes(recordMode)) {
        return NextResponse.json({ error: "Ungültiger Aufnahmemodus." }, { status: 400 });
      }
      updateData.recordMode = recordMode;
      updateData.recordEnabled = recordMode !== 'off';
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
      updateData.motionSensitivity = Math.min(100, Math.max(1, Math.round(Number(body.motionSensitivity) || 50)));
    }
    if (body.notificationsEnabled !== undefined) {
      updateData.notificationsEnabled = Boolean(body.notificationsEnabled);
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
