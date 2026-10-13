import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const cameraId = (searchParams.get("cameraId") || "").trim();
    const type = searchParams.get("type") || "all";
    const requestedLimit = Number(searchParams.get("limit"));
    const limit = Math.min(500, Math.max(20, Number.isFinite(requestedLimit) ? requestedLimit : 200));
    const includeMotion = type === "all" || type === "motion";
    const includeStatus = type === "all" || type === "online" || type === "offline";

    const [alarms, statusLogs] = await Promise.all([
      includeMotion
        ? prisma.alarmLog.findMany({
            where: cameraId ? { cameraId } : undefined,
            orderBy: { timestamp: "desc" },
            take: limit,
            include: { camera: { select: { id: true, name: true, ip: true } } },
          })
        : [],
      includeStatus
        ? prisma.cameraStatusLog.findMany({
            where: {
              ...(cameraId ? { cameraId } : {}),
              ...(type === "online" || type === "offline" ? { status: type } : {}),
            },
            orderBy: { timestamp: "desc" },
            take: limit,
            include: { camera: { select: { id: true, name: true, ip: true } } },
          })
        : [],
    ]);

    const events = [
      ...alarms.map((alarm) => ({
        id: `motion:${alarm.id}`,
        type: "motion" as const,
        cameraId: alarm.cameraId,
        cameraName: alarm.camera.name,
        cameraIp: alarm.camera.ip,
        timestamp: alarm.timestamp.toISOString(),
        message: alarm.message || "Bewegung erkannt",
      })),
      ...statusLogs.map((entry) => ({
        id: `status:${entry.id}`,
        type: entry.status === "offline" ? "offline" as const : "online" as const,
        cameraId: entry.cameraId,
        cameraName: entry.camera.name,
        cameraIp: entry.camera.ip,
        timestamp: entry.timestamp.toISOString(),
        message: entry.status === "offline" ? "Kamera ist offline" : "Kamera ist online",
      })),
    ]
      .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
      .slice(0, limit);

    return NextResponse.json({ ok: true, events });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Aktivitätsprotokoll konnte nicht geladen werden." },
      { status: 500 },
    );
  }
}
