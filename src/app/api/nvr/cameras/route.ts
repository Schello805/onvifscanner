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
      isOnline: c.status?.isOnline ?? false,
      recordEnabled: c.recordEnabled,
      recordSegmentMinutes: c.recordSegmentMinutes,
      storageTargetId: c.storageTargetId,
      storageTarget: c.storageTarget || defaultStorage || null,
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
    const id = String(body.id || "").trim();
    if (!id) return NextResponse.json({ error: "Kamera-ID fehlt." }, { status: 400 });

    const camera = await prisma.camera.findUnique({ where: { id } });
    if (!camera) return NextResponse.json({ error: "Kamera nicht gefunden." }, { status: 404 });

    const updateData: Record<string, any> = {};

    if (body.recordEnabled !== undefined) {
      updateData.recordEnabled = Boolean(body.recordEnabled);
    }
    if (body.recordSegmentMinutes !== undefined) {
      updateData.recordSegmentMinutes = Math.max(1, Number(body.recordSegmentMinutes) || 15);
    }
    if (body.storageTargetId !== undefined) {
      updateData.storageTargetId = body.storageTargetId ? String(body.storageTargetId).trim() : null;
    }

    const updated = await prisma.camera.update({
      where: { id },
      data: updateData,
      include: {
        status: true,
        storageTarget: true,
      },
    });

    // Synchronize directly with MediaMTX
    const syncResult = await syncCameraWithMediaMtx(id);

    return NextResponse.json({
      camera: updated,
      syncResult,
      message: syncResult.ok
        ? "Aufnahme-Einstellung gespeichert und Stream-Server aktualisiert."
        : `Einstellung gespeichert, aber Stream-Server meldet: ${syncResult.message}`,
    });
  } catch (error: any) {
    console.error("PATCH /api/nvr/cameras error:", error);
    return NextResponse.json({ error: error?.message || "Fehler beim Aktualisieren der Kamera-Aufnahme." }, { status: 500 });
  }
}
