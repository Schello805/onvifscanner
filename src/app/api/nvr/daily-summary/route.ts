import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Detection = { group?: string };

function parseArray(value: string | null): unknown[] {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date") || "";
    const cameraId = searchParams.get("cameraId") || "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ ok: false, error: "Ungültiges Datum." }, { status: 400 });
    }

    const start = new Date(`${date}T00:00:00`);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const [events, savedCameras] = await Promise.all([
      prisma.alarmLog.findMany({
        where: {
          ...(cameraId ? { cameraId } : {}),
          timestamp: { gte: start, lt: end },
        },
        orderBy: { timestamp: "asc" },
        include: { camera: { select: { id: true, name: true } } },
      }),
      prisma.camera.findMany({
        where: cameraId ? { id: cameraId } : undefined,
        select: { id: true, name: true },
      }),
    ]);

    const counts = { person: 0, vehicle: 0, animal: 0, unclassified: 0 };
    const cameras = new Map(
      savedCameras.map((camera) => [
        camera.id,
        { cameraId: camera.id, cameraName: camera.name, events: 0, objects: 0 },
      ]),
    );
    for (const event of events) {
      const detections = parseArray(event.objectDetections) as Detection[];
      const groups = detections.length
        ? detections.map((detection) => detection.group).filter(Boolean)
        : parseArray(event.objectClasses).filter((entry): entry is string => typeof entry === "string");
      if (!groups.length) counts.unclassified += 1;
      for (const group of groups) {
        if (group === "person" || group === "vehicle" || group === "animal") counts[group] += 1;
      }
      const camera = cameras.get(event.cameraId) || {
        cameraId: event.cameraId,
        cameraName: event.camera?.name || "Kamera",
        events: 0,
        objects: 0,
      };
      camera.events += 1;
      camera.objects += groups.length;
      cameras.set(event.cameraId, camera);
    }

    return NextResponse.json({
      ok: true,
      date,
      totalEvents: events.length,
      counts,
      cameras: Array.from(cameras.values()).sort((left, right) =>
        left.cameraName.localeCompare(right.cameraName, "de", { numeric: true, sensitivity: "base" }),
      ),
      firstEventAt: events[0]?.timestamp.toISOString() || null,
      lastEventAt: events.at(-1)?.timestamp.toISOString() || null,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Tagesübersicht konnte nicht geladen werden." },
      { status: 500 },
    );
  }
}
