import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  ensureDefaultStorageTarget,
  getStorageStats,
  testStoragePath,
} from "@/lib/nvr/storage";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureDefaultStorageTarget();

    const targets = await prisma.storageTarget.findMany({
      include: {
        _count: {
          select: { cameras: true },
        },
      },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    });

    const targetsWithStats = await Promise.all(
      targets.map(async (t) => {
        const stats = await getStorageStats(t.path);
        return {
          id: t.id,
          name: t.name,
          path: t.path,
          isDefault: t.isDefault,
          enabled: t.enabled,
          maxDays: t.maxDays,
          minFreeSpaceGb: t.minFreeSpaceGb,
          assignedCamerasCount: t._count.cameras,
          createdAt: t.createdAt.toISOString(),
          stats,
        };
      })
    );

    return NextResponse.json({ targets: targetsWithStats });
  } catch (error: any) {
    console.error("GET /api/nvr/storage error:", error);
    return NextResponse.json({ error: error?.message || "Fehler beim Laden der Speicherziele." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const rawName = String(body.name || "").trim();
    const rawPath = String(body.path || "").trim();
    const autoCreate = Boolean(body.autoCreate);
    const isDefault = Boolean(body.isDefault);
    const maxDays = Math.max(0, Number(body.maxDays) || 14);
    const minFreeSpaceGb = Math.max(0, Number(body.minFreeSpaceGb) || 10);

    if (!rawPath) {
      return NextResponse.json({ error: "Speicherpfad darf nicht leer sein." }, { status: 400 });
    }

    const resolvedPath = path.resolve(rawPath);
    const name = rawName || path.basename(resolvedPath) || "Speichermedium";

    // Check if already exists in DB
    const existing = await prisma.storageTarget.findFirst({
      where: { path: resolvedPath },
    });
    if (existing) {
      return NextResponse.json({ error: `Dieser Pfad ist bereits als Speicherziel hinterlegt: "${existing.name}".` }, { status: 409 });
    }

    // Validate path & write permission
    const test = await testStoragePath(resolvedPath, autoCreate);
    if (!test.ok) {
      return NextResponse.json({
        error: test.error || "Speicherpfad konnte nicht validiert werden.",
        details: test,
      }, { status: 400 });
    }

    // If setting as default, unset others
    if (isDefault) {
      await prisma.storageTarget.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }

    const newTarget = await prisma.storageTarget.create({
      data: {
        name,
        path: resolvedPath,
        isDefault,
        enabled: true,
        maxDays,
        minFreeSpaceGb,
      },
    });

    const stats = await getStorageStats(newTarget.path);

    return NextResponse.json({
      target: {
        ...newTarget,
        assignedCamerasCount: 0,
        createdAt: newTarget.createdAt.toISOString(),
        stats,
      },
      message: "Speichermedium erfolgreich angebunden.",
    });
  } catch (error: any) {
    console.error("POST /api/nvr/storage error:", error);
    return NextResponse.json({ error: error?.message || "Fehler beim Anbinden des Speichermediums." }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const id = String(body.id || "").trim();
    if (!id) return NextResponse.json({ error: "Speicher-ID fehlt." }, { status: 400 });

    const target = await prisma.storageTarget.findUnique({ where: { id } });
    if (!target) return NextResponse.json({ error: "Speicherziel nicht gefunden." }, { status: 404 });

    const updateData: Record<string, any> = {};

    if (body.name !== undefined) updateData.name = String(body.name).trim();
    if (body.maxDays !== undefined) updateData.maxDays = Math.max(0, Number(body.maxDays));
    if (body.minFreeSpaceGb !== undefined) updateData.minFreeSpaceGb = Math.max(0, Number(body.minFreeSpaceGb));
    if (body.enabled !== undefined) updateData.enabled = Boolean(body.enabled);

    if (body.isDefault === true) {
      await prisma.storageTarget.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
      updateData.isDefault = true;
    }

    const updated = await prisma.storageTarget.update({
      where: { id },
      data: updateData,
    });

    const stats = await getStorageStats(updated.path);

    return NextResponse.json({
      target: {
        ...updated,
        stats,
      },
      message: "Speicher-Einstellungen erfolgreich aktualisiert.",
    });
  } catch (error: any) {
    console.error("PATCH /api/nvr/storage error:", error);
    return NextResponse.json({ error: error?.message || "Fehler beim Aktualisieren." }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Speicher-ID fehlt." }, { status: 400 });

    const target = await prisma.storageTarget.findUnique({
      where: { id },
      include: { _count: { select: { cameras: true } } },
    });
    if (!target) return NextResponse.json({ error: "Speicherziel nicht gefunden." }, { status: 404 });

    if (target.isDefault) {
      // Find another target to make default
      const another = await prisma.storageTarget.findFirst({
        where: { id: { not: id } },
      });
      if (!another) {
        return NextResponse.json({ error: "Das einzige vorhandene Speicherziel kann nicht gelöscht werden." }, { status: 400 });
      }
      await prisma.storageTarget.update({
        where: { id: another.id },
        data: { isDefault: true },
      });
    }

    // Reassign cameras to null (fallback to default)
    await prisma.camera.updateMany({
      where: { storageTargetId: id },
      data: { storageTargetId: null },
    });

    await prisma.storageTarget.delete({ where: { id } });

    return NextResponse.json({ ok: true, message: "Speicherziel entfernt." });
  } catch (error: any) {
    console.error("DELETE /api/nvr/storage error:", error);
    return NextResponse.json({ error: error?.message || "Fehler beim Löschen." }, { status: 500 });
  }
}
