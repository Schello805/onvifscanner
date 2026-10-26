import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { findKnownEntity } from "@/lib/knownEntities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const cameraId = (searchParams.get("cameraId") || "").trim();
    const type = searchParams.get("type") || "all";
    const query = (searchParams.get("query") || searchParams.get("q") || "").trim();
    const objectClass = (searchParams.get("objectClass") || searchParams.get("class") || "").trim().toLowerCase();
    const fromStr = (searchParams.get("from") || "").trim();
    const toStr = (searchParams.get("to") || "").trim();

    const requestedLimit = Number(searchParams.get("limit"));
    const limit = Math.min(500, Math.max(20, Number.isFinite(requestedLimit) ? requestedLimit : 200));
    const includeMotion = type === "all" || type === "motion";
    const includeStatus = type === "all" || type === "online" || type === "offline";

    const timestampFilter: { gte?: Date; lte?: Date } = {};
    if (fromStr) {
      const d = new Date(fromStr);
      if (!isNaN(d.getTime())) timestampFilter.gte = d;
    }
    if (toStr) {
      const d = new Date(toStr);
      if (!isNaN(d.getTime())) timestampFilter.lte = d;
    }

    const alarmWhere: any = {};
    if (cameraId) alarmWhere.cameraId = cameraId;
    if (timestampFilter.gte || timestampFilter.lte) alarmWhere.timestamp = timestampFilter;

    if (objectClass === "plate" || objectClass === "license_plate") {
      alarmWhere.licensePlates = { not: null };
    } else if (objectClass) {
      alarmWhere.objectClasses = { contains: objectClass };
    }

    if (query) {
      alarmWhere.OR = [
        { message: { contains: query } },
        { licensePlates: { contains: query } },
        { objectClasses: { contains: query } },
      ];
    }

    const statusWhere: any = {};
    if (cameraId) statusWhere.cameraId = cameraId;
    if (type === "online" || type === "offline") statusWhere.status = type;
    if (timestampFilter.gte || timestampFilter.lte) statusWhere.timestamp = timestampFilter;

    const [alarms, statusLogs] = await Promise.all([
      includeMotion
        ? prisma.alarmLog.findMany({
            where: alarmWhere,
            orderBy: { timestamp: "desc" },
            take: limit,
            include: { camera: { select: { id: true, name: true, ip: true } } },
          })
        : [],
      includeStatus && !objectClass && !query
        ? prisma.cameraStatusLog.findMany({
            where: statusWhere,
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
        imageUrl: alarm.imageUrl || null,
        objectDetections: (() => {
          try {
            return JSON.parse(alarm.objectDetections || "[]");
          } catch {
            return [];
          }
        })(),
        licensePlates: (() => {
          try {
            const raw = JSON.parse(alarm.licensePlates || "[]");
            if (!Array.isArray(raw)) return [];
            return raw
              .map((item) => {
                if (typeof item === "string") {
                  const known = findKnownEntity(item, "plate");
                  return {
                    plate: item,
                    knownName: known ? known.name : null,
                    category: known ? known.category : "unknown",
                  };
                }
                if (item && typeof item === "object") {
                  const plateStr = String(item.plate || "");
                  const known = findKnownEntity(plateStr, "plate");
                  return {
                    plate: plateStr,
                    knownName: known ? known.name : (item.knownName || null),
                    category: known ? known.category : (item.category || "unknown"),
                  };
                }
                return null;
              })
              .filter(Boolean);
          } catch {
            return [];
          }
        })(),
      })),
      ...statusLogs.map((entry) => ({
        id: `status:${entry.id}`,
        type: entry.status === "offline" ? "offline" as const : "online" as const,
        cameraId: entry.cameraId,
        cameraName: entry.camera.name,
        cameraIp: entry.camera.ip,
        timestamp: entry.timestamp.toISOString(),
        message: entry.status === "offline" ? "Kamera ist offline" : "Kamera ist online",
        licensePlates: [],
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
