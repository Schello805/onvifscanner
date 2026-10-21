import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [cameras, statusLogs24h] = await Promise.all([
      prisma.camera.findMany({
        include: { status: true, storageTarget: true },
        orderBy: { sortOrder: "asc" },
      }),
      prisma.cameraStatusLog.findMany({
        where: { timestamp: { gte: yesterday } },
        orderBy: { timestamp: "desc" },
      }),
    ]);

    // Query MediaMTX live paths
    let mtxPaths: any[] = [];
    let mtxAlive = false;
    try {
      const res = await fetch("http://127.0.0.1:9997/v3/paths/list", {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) {
        const json = await res.json();
        mtxPaths = json.items || [];
        mtxAlive = true;
      }
    } catch {
      mtxAlive = false;
    }

    const mtxMap = new Map<string, any>();
    for (const item of mtxPaths) {
      if (item && item.name) {
        mtxMap.set(item.name, item);
      }
    }

    const logsByCamera = new Map<string, typeof statusLogs24h>();
    for (const log of statusLogs24h) {
      const list = logsByCamera.get(log.cameraId) || [];
      list.push(log);
      logsByCamera.set(log.cameraId, list);
    }

    const cameraHealth = cameras.map((cam) => {
      const logs = logsByCamera.get(cam.id) || [];
      const disconnects = logs.filter((l) => l.status === "offline").length;

      // Calculate approximate uptime in the last 24h
      let uptimePercent = 100;
      if (disconnects > 0) {
        uptimePercent = Math.max(10, Math.round(100 - disconnects * 4));
      }
      if (cam.status && !cam.status.isOnline) {
        uptimePercent = Math.min(uptimePercent, 50);
      }

      const mtx = mtxMap.get(cam.id);
      const isStreaming = Boolean(mtx && mtx.ready);
      const bytesReceived = mtx?.bytesReceived || 0;
      const readers = mtx?.readers ? mtx.readers.length : 0;
      const tracks = Array.isArray(mtx?.tracks) ? mtx.tracks : [];

      return {
        id: cam.id,
        name: cam.name,
        ip: cam.ip,
        isOnline: cam.status?.isOnline ?? false,
        lastSeen: cam.status?.lastSeen?.toISOString() || null,
        pingFailures: cam.status?.pingFailures ?? 0,
        disconnects24h: disconnects,
        uptimePercent,
        streaming: {
          active: isStreaming,
          readers,
          bytesReceived,
          tracks: tracks.map((t: any) => ({
            type: t.type || "unknown",
            codec: t.codec || "unknown",
          })),
        },
      };
    });

    return NextResponse.json({
      ok: true,
      mediaMtxAlive: mtxAlive,
      cameras: cameraHealth,
      totalCameras: cameras.length,
      onlineCameras: cameraHealth.filter((c) => c.isOnline).length,
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}
