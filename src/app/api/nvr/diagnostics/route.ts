import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { effectiveRecordingMode } from "@/lib/recordingPolicy";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const diagnostics: Record<string, any> = {
    timestamp: new Date().toISOString(),
    mediaMtx: {
      running: false,
      apiReachable: false,
      configuredPaths: 0,
      activeStreams: 0,
      recordingPaths: [] as string[],
      error: null as string | null,
    },
    cameras: [] as any[],
    storage: [] as any[],
    diskFiles: [] as string[],
  };

  // 1. Check MediaMTX API
  try {
    const resConfig = await fetch("http://127.0.0.1:9997/v3/config/paths/list", {
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    });
    if (resConfig.ok) {
      diagnostics.mediaMtx.apiReachable = true;
      diagnostics.mediaMtx.running = true;
      const json = await resConfig.json();
      const items = json.items || [];
      diagnostics.mediaMtx.configuredPaths = items.length;
      diagnostics.mediaMtx.recordingPaths = items
        .filter((item: any) => item.record === true)
        .map((item: any) => ({
          name: item.name,
          source: item.source ? item.source.replace(/:[^:@]+@/, ":***@") : "none",
          recordPath: item.recordPath,
          recordSegmentDuration: item.recordSegmentDuration,
        }));
    } else {
      diagnostics.mediaMtx.error = `MediaMTX API returned HTTP ${resConfig.status}`;
    }
  } catch (err: any) {
    diagnostics.mediaMtx.error = `MediaMTX API nicht erreichbar (Port 9997): ${err?.message || err}`;
  }

  // Check active running streams in MediaMTX
  try {
    const resPaths = await fetch("http://127.0.0.1:9997/v3/paths/list", {
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    });
    if (resPaths.ok) {
      const json = await resPaths.json();
      diagnostics.mediaMtx.activeStreams = (json.items || []).length;
    }
  } catch {}

  // 2. Check Cameras in Database
  try {
    const cameras = await prisma.camera.findMany({
      include: { status: true, storageTarget: true },
      orderBy: { sortOrder: "asc" },
    });
    const now = new Date();
    diagnostics.cameras = cameras.map((cam) => {
      let uris: string[] = [];
      try { uris = JSON.parse(cam.streamUris); } catch {}
      return {
        id: cam.id,
        name: cam.name,
        ip: cam.ip,
        isOnline: cam.status?.isOnline ?? false,
        recordEnabled: cam.recordEnabled,
        recordMode: cam.recordMode,
        effectiveMode: effectiveRecordingMode(cam, now),
        streamCount: uris.length,
        hasMainStream: uris.some((u) => typeof u === "string" && /^rtsps?:\/\//i.test(u)),
        storageTarget: cam.storageTarget?.name || "Standard (data/recordings)",
      };
    });
  } catch (err: any) {
    diagnostics.cameraError = err?.message || String(err);
  }

  // 3. Check Storage Targets & Disks
  try {
    const defaultPath = path.resolve(process.cwd(), "data", "recordings");
    const targets = await prisma.storageTarget.findMany({ where: { enabled: true } });
    const checkTargets = [...targets];
    if (!checkTargets.some((t) => path.resolve(t.path) === defaultPath)) {
      checkTargets.unshift({
        id: "default",
        name: "Lokaler Standard-Speicher",
        path: defaultPath,
        isDefault: true,
        enabled: true,
        maxDays: 14,
        minFreeSpaceGb: 10,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    for (const target of checkTargets) {
      const resolved = path.resolve(target.path);
      const exists = fs.existsSync(resolved);
      let writable = false;
      let freeGb = 0;
      let filesCount = 0;

      if (exists) {
        try {
          await fsp.access(resolved, fs.constants.W_OK);
          writable = true;
        } catch {}

        try {
          const statfs = fs.statfsSync(resolved);
          freeGb = Math.round((Number(statfs.bavail) * (statfs.bsize || 4096)) / (1024 ** 3) * 10) / 10;
        } catch {}

        // Scan files up to depth 2
        try {
          const walk = async (dir: string, depth = 0) => {
            const entries = await fsp.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
              const full = path.join(dir, entry.name);
              if (entry.isDirectory() && depth < 2) {
                await walk(full, depth + 1);
              } else if (entry.isFile() && /\.(?:mp4|m4s|ts)$/i.test(entry.name)) {
                filesCount += 1;
                if (diagnostics.diskFiles.length < 25) {
                  const stat = await fsp.stat(full).catch(() => null);
                  diagnostics.diskFiles.push(
                    `${path.relative(resolved, full)} (${stat ? `${Math.round(stat.size / 1024 / 1024 * 10) / 10} MB` : "?"})`
                  );
                }
              }
            }
          };
          await walk(resolved, 0);
        } catch {}
      }

      diagnostics.storage.push({
        name: target.name,
        path: resolved,
        exists,
        writable,
        freeGb,
        filesCount,
      });
    }
  } catch (err: any) {
    diagnostics.storageError = err?.message || String(err);
  }

  // 4. Check Motion Buffer Directory
  try {
    const motionBufferDir = path.resolve(process.cwd(), "data", "motion-buffer");
    if (fs.existsSync(motionBufferDir)) {
      const motionEntries = await fsp.readdir(motionBufferDir, { withFileTypes: true });
      diagnostics.motionBuffer = {
        exists: true,
        path: motionBufferDir,
        cameraDirs: motionEntries.filter((e) => e.isDirectory()).map((e) => e.name),
      };
    } else {
      diagnostics.motionBuffer = { exists: false, path: motionBufferDir, cameraDirs: [] };
    }
  } catch {}

  // 5. Check Recent Motion Recordings & Errors
  try {
    const recentMotionRecordings = await prisma.motionRecording.findMany({
      take: 10,
      orderBy: { createdAt: "desc" },
      include: { camera: { select: { name: true } } },
    });
    diagnostics.recentMotionRecordings = recentMotionRecordings.map((r) => ({
      id: r.id,
      cameraName: r.camera?.name || r.cameraId,
      status: r.status,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      segmentCount: r.segmentCount,
      filePath: r.filePath,
      error: r.error,
    }));
  } catch {}

  return NextResponse.json(diagnostics, {
    headers: { "cache-control": "no-store" },
  });
}
