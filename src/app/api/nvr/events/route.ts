import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const cameraId = searchParams.get("cameraId");
    const dateStr = searchParams.get("date"); // YYYY-MM-DD

    const whereClause: {
      cameraId?: string;
      timestamp?: { gte?: Date; lte?: Date };
    } = {};

    if (cameraId) {
      whereClause.cameraId = cameraId;
    }

    if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const startDate = new Date(`${dateStr}T00:00:00.000Z`);
      const endDate = new Date(`${dateStr}T23:59:59.999Z`);
      whereClause.timestamp = {
        gte: startDate,
        lte: endDate,
      };
    }

    const events = await prisma.alarmLog.findMany({
      where: whereClause,
      orderBy: { timestamp: "asc" },
      take: 2000,
      include: {
        camera: {
          select: { id: true, name: true },
        },
      },
    });

    const formatted = events.map((ev) => {
      const d = new Date(ev.timestamp);
      const hours = String(d.getHours()).padStart(2, "0");
      const mins = String(d.getMinutes()).padStart(2, "0");
      const secs = String(d.getSeconds()).padStart(2, "0");
      const timeStr = `${hours}:${mins}:${secs}`;
      const totalMinutes = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;

      return {
        id: ev.id,
        cameraId: ev.cameraId,
        cameraName: ev.camera?.name || "Kamera",
        timestamp: ev.timestamp.toISOString(),
        timeStr,
        totalMinutes,
        message: ev.message || "Bewegung erkannt",
      };
    });

    return NextResponse.json({ ok: true, events: formatted });
  } catch (err) {
    console.error("Error fetching alarm events:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
