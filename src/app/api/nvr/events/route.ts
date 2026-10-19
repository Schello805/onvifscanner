import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { effectiveRecordingMode } from "@/lib/recordingPolicy";

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

    const events = await prisma.alarmLog.findMany({
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
    });

    let formatted = events.map((ev) => {
      const d = new Date(ev.timestamp);
      const hours = String(d.getHours()).padStart(2, "0");
      const mins = String(d.getMinutes()).padStart(2, "0");
      const secs = String(d.getSeconds()).padStart(2, "0");
      const timeStr = `${hours}:${mins}:${secs}`;
      const totalMinutes = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const evDateStr = `${year}-${month}-${day}`;
      const recordingPath = ev.motionRecording?.status === "ready" ? ev.motionRecording.filePath : null;
      const clipId = recordingPath ? Buffer.from(recordingPath).toString("base64url") : null;

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
        streamUrl: clipId ? `/api/nvr/recordings/stream?clipId=${clipId}` : null,
      };
    });

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
