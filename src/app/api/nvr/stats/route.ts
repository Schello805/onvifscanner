import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const period = searchParams.get("period") || "today"; // "today" | "yesterday" | "7d" | "30d" | "all"

    const now = new Date();
    let startDate: Date | undefined;
    let endDate: Date | undefined;

    if (period === "today") {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    } else if (period === "yesterday") {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      startDate = new Date(y.getFullYear(), y.getMonth(), y.getDate(), 0, 0, 0, 0);
      endDate = new Date(y.getFullYear(), y.getMonth(), y.getDate(), 23, 59, 59, 999);
    } else if (period === "7d") {
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 7);
      startDate.setHours(0, 0, 0, 0);
    } else if (period === "30d") {
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 30);
      startDate.setHours(0, 0, 0, 0);
    } // "all" has no date boundary

    const whereClause: { timestamp?: { gte?: Date; lte?: Date } } = {};
    if (startDate || endDate) {
      whereClause.timestamp = {};
      if (startDate) whereClause.timestamp.gte = startDate;
      if (endDate) whereClause.timestamp.lte = endDate;
    }

    // Fetch all alarms in the given period
    const alarms = await prisma.alarmLog.findMany({
      where: whereClause,
      select: {
        id: true,
        cameraId: true,
        timestamp: true,
        message: true,
      },
      orderBy: { timestamp: "desc" },
    });

    // Fetch all configured cameras
    const cameras = await prisma.camera.findMany({
      select: {
        id: true,
        name: true,
        ip: true,
        recordEnabled: true,
      },
    });

    const cameraMap = new Map(cameras.map((c) => [c.id, c]));

    // Group alarms by camera
    const cameraStatsMap = new Map<
      string,
      {
        count: number;
        lastEventAt: string | null;
        hourly: number[];
        messages: Record<string, number>;
      }
    >();

    // Initialize all registered cameras with 0
    for (const cam of cameras) {
      cameraStatsMap.set(cam.id, {
        count: 0,
        lastEventAt: null,
        hourly: new Array(24).fill(0),
        messages: {},
      });
    }

    // Also account for alarms from cameras that might not be in DB anymore
    for (const alarm of alarms) {
      let stat = cameraStatsMap.get(alarm.cameraId);
      if (!stat) {
        stat = {
          count: 0,
          lastEventAt: null,
          hourly: new Array(24).fill(0),
          messages: {},
        };
        cameraStatsMap.set(alarm.cameraId, stat);
      }

      stat.count += 1;
      if (!stat.lastEventAt) {
        stat.lastEventAt = alarm.timestamp.toISOString();
      }

      const hour = new Date(alarm.timestamp).getHours();
      stat.hourly[hour] = (stat.hourly[hour] || 0) + 1;

      const msg = alarm.message || "Bewegung erkannt";
      stat.messages[msg] = (stat.messages[msg] || 0) + 1;
    }

    const totalEvents = alarms.length;

    // Hourly aggregation across ALL cameras
    const overallHourly = new Array(24).fill(0);
    for (const alarm of alarms) {
      const h = new Date(alarm.timestamp).getHours();
      overallHourly[h] += 1;
    }

    let peakHourIndex = 0;
    let peakHourCount = 0;
    overallHourly.forEach((cnt, h) => {
      if (cnt > peakHourCount) {
        peakHourCount = cnt;
        peakHourIndex = h;
      }
    });

    // Build ranking list sorted by count descending
    const cameraRanking = Array.from(cameraStatsMap.entries())
      .map(([camId, stat]) => {
        const cam = cameraMap.get(camId);
        const percentage = totalEvents > 0 ? Number(((stat.count / totalEvents) * 100).toFixed(1)) : 0;

        let camPeakHour = 0;
        let camPeakHourCount = 0;
        stat.hourly.forEach((cnt, h) => {
          if (cnt > camPeakHourCount) {
            camPeakHourCount = cnt;
            camPeakHour = h;
          }
        });

        return {
          cameraId: camId,
          cameraName: cam?.name || `Kamera ${camId.slice(0, 8)}`,
          cameraIp: cam?.ip || "",
          recordEnabled: cam?.recordEnabled ?? false,
          count: stat.count,
          percentage,
          lastEventAt: stat.lastEventAt,
          hourly: stat.hourly,
          peakHour:
            stat.count > 0
              ? `${String(camPeakHour).padStart(2, "0")}:00–${String((camPeakHour + 1) % 24).padStart(2, "0")}:00 Uhr (${camPeakHourCount}x)`
              : null,
          isHighActivity: stat.count >= 50 || percentage >= 40,
        };
      })
      .sort((a, b) => b.count - a.count);

    return NextResponse.json({
      ok: true,
      period,
      totalEvents,
      activeCamerasCount: cameraRanking.filter((c) => c.count > 0).length,
      totalCamerasCount: cameras.length,
      peakHour:
        totalEvents > 0
          ? `${String(peakHourIndex).padStart(2, "0")}:00–${String((peakHourIndex + 1) % 24).padStart(2, "0")}:00 Uhr`
          : null,
      peakHourCount,
      overallHourly,
      ranking: cameraRanking,
    });
  } catch (err) {
    console.error("Error generating camera stats:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
