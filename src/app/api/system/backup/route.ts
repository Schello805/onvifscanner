import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const cameras = await prisma.camera.findMany({
      include: {
        storageTarget: true,
      },
      orderBy: { sortOrder: "asc" },
    });

    const exportedCameras = cameras.map((cam) => {
      let snapshotUris: string[] = [];
      let streamUris: string[] = [];
      let motionIgnoreRegions: unknown[] = [];
      let objectDetectionClasses: string[] = [];
      let motionScheduleDays: number[] = [];

      try {
        snapshotUris = JSON.parse(cam.snapshotUris);
      } catch {}
      try {
        streamUris = JSON.parse(cam.streamUris);
      } catch {}
      try {
        motionIgnoreRegions = JSON.parse(cam.motionIgnoreRegions);
      } catch {}
      try {
        objectDetectionClasses = JSON.parse(cam.objectDetectionClasses);
      } catch {}
      try {
        motionScheduleDays = JSON.parse(cam.motionScheduleDays);
      } catch {}

      return {
        id: cam.id,
        ip: cam.ip,
        name: cam.name,
        hostname: cam.hostname,
        manufacturer: cam.manufacturer,
        model: cam.model,
        resolution: cam.resolution,
        snapshotUris,
        streamUris,
        username: cam.username,
        password: cam.password ? decryptSecret(cam.password) : null,
        overlayPosition: cam.overlayPosition,
        sortOrder: cam.sortOrder,
        recordEnabled: cam.recordEnabled,
        recordMode: cam.recordMode,
        recordSegmentMinutes: cam.recordSegmentMinutes,
        motionPreRollSeconds: cam.motionPreRollSeconds,
        motionPostRollSeconds: cam.motionPostRollSeconds,
        motionSensitivity: cam.motionSensitivity,
        motionIgnoreRegions,
        objectDetectionEnabled: cam.objectDetectionEnabled,
        objectDetectionClasses,
        objectMinConfidence: cam.objectMinConfidence,
        licensePlateRecognitionEnabled: cam.licensePlateRecognitionEnabled,
        motionScheduleEnabled: cam.motionScheduleEnabled,
        motionScheduleStart: cam.motionScheduleStart,
        motionScheduleEnd: cam.motionScheduleEnd,
        motionScheduleDays,
        motionScheduleSensitivity: cam.motionScheduleSensitivity,
        alarmCooldownSeconds: cam.alarmCooldownSeconds,
        notificationsEnabled: cam.notificationsEnabled,
        storageTargetPath: cam.storageTarget?.path || null,
        storageTargetName: cam.storageTarget?.name || null,
      };
    });

    const storageTargets = await prisma.storageTarget.findMany();
    const settings = await prisma.settings.findUnique({ where: { id: "default" } });

    const dateStr = new Date().toISOString().split("T")[0];
    const filename = `onvifscanner-backup-${dateStr}.json`;

    const backupData = {
      version: "1.0",
      generator: "onvifscanner",
      exportedAt: new Date().toISOString(),
      cameras: exportedCameras,
      storageTargets: storageTargets.map((t) => ({
        name: t.name,
        path: t.path,
        isDefault: t.isDefault,
        enabled: t.enabled,
        maxDays: t.maxDays,
        minFreeSpaceGb: t.minFreeSpaceGb,
      })),
      settings: settings
        ? {
            columns: settings.columns,
            refresh: settings.refresh,
            autoCleanup: settings.autoCleanup,
            ntfyTopic: settings.ntfyTopic,
            ntfyServer: settings.ntfyServer,
            ntfyCameraStatusEnabled: settings.ntfyCameraStatusEnabled,
            telegramBotToken: settings.telegramBotToken,
            telegramChatId: settings.telegramChatId,
            telegramEnabled: settings.telegramEnabled,
            telegramCameraStatusEnabled: settings.telegramCameraStatusEnabled,
          }
        : null,
    };

    return new NextResponse(JSON.stringify(backupData, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Backup-Erstellung fehlgeschlagen";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const backup = body?.backup || body;
    const mode = body?.mode === "replace" ? "replace" : "merge";

    if (!backup || typeof backup !== "object" || !Array.isArray(backup.cameras)) {
      return NextResponse.json(
        { error: "Ungültiges Backup-Format: 'cameras' Liste fehlt oder ist fehlerhaft." },
        { status: 400 }
      );
    }

    // 1. Process Storage Targets if present
    const storagePathToId = new Map<string, string>();
    if (Array.isArray(backup.storageTargets)) {
      for (const st of backup.storageTargets) {
        if (!st.path) continue;
        const target = await prisma.storageTarget.upsert({
          where: { path: st.path },
          create: {
            name: st.name || "Speicher",
            path: st.path,
            isDefault: Boolean(st.isDefault),
            enabled: st.enabled !== false,
            maxDays: Number(st.maxDays) || 14,
            minFreeSpaceGb: Number(st.minFreeSpaceGb) || 10,
          },
          update: {
            name: st.name || undefined,
            isDefault: Boolean(st.isDefault),
            enabled: st.enabled !== false,
            maxDays: Number(st.maxDays) || 14,
            minFreeSpaceGb: Number(st.minFreeSpaceGb) || 10,
          },
        });
        storagePathToId.set(st.path, target.id);
      }
    }

    // If replace mode, delete cameras not present in the backup
    if (mode === "replace") {
      const backupCameraIds: string[] = (backup.cameras as Array<{ id?: string }>)
        .map((c) => (typeof c.id === "string" ? c.id : ""))
        .filter((id): id is string => Boolean(id));

      await prisma.camera.deleteMany({
        where: {
          id: { notIn: backupCameraIds },
        },
      });
    }

    // 2. Process Cameras
    let importedCameras = 0;
    for (const cam of backup.cameras) {
      if (!cam.id || !cam.ip || !cam.name) continue;

      let storageTargetId: string | null = null;
      if (cam.storageTargetPath && storagePathToId.has(cam.storageTargetPath)) {
        storageTargetId = storagePathToId.get(cam.storageTargetPath) || null;
      }

      // Re-encrypt password using local encryption key
      const encryptedPassword = cam.password ? encryptSecret(cam.password) : null;

      const data = {
        name: String(cam.name),
        ip: String(cam.ip),
        hostname: cam.hostname || null,
        manufacturer: cam.manufacturer || null,
        model: cam.model || null,
        resolution: cam.resolution || null,
        snapshotUris: JSON.stringify(Array.isArray(cam.snapshotUris) ? cam.snapshotUris : []),
        streamUris: JSON.stringify(Array.isArray(cam.streamUris) ? cam.streamUris : []),
        username: cam.username || null,
        password: encryptedPassword,
        overlayPosition: cam.overlayPosition || "top-left",
        sortOrder: Number(cam.sortOrder) || 0,
        recordEnabled: Boolean(cam.recordEnabled),
        recordMode: String(cam.recordMode || "off"),
        recordSegmentMinutes: Number(cam.recordSegmentMinutes) || 15,
        motionPreRollSeconds: Number(cam.motionPreRollSeconds) || 10,
        motionPostRollSeconds: Number(cam.motionPostRollSeconds) || 30,
        motionSensitivity: Number(cam.motionSensitivity) || 80,
        motionIgnoreRegions: JSON.stringify(Array.isArray(cam.motionIgnoreRegions) ? cam.motionIgnoreRegions : []),
        objectDetectionEnabled: Boolean(cam.objectDetectionEnabled),
        objectDetectionClasses: JSON.stringify(Array.isArray(cam.objectDetectionClasses) ? cam.objectDetectionClasses : ["person", "vehicle", "animal"]),
        objectMinConfidence: Number(cam.objectMinConfidence) || 55,
        licensePlateRecognitionEnabled: Boolean(cam.licensePlateRecognitionEnabled),
        motionScheduleEnabled: Boolean(cam.motionScheduleEnabled),
        motionScheduleStart: String(cam.motionScheduleStart || "22:00"),
        motionScheduleEnd: String(cam.motionScheduleEnd || "06:00"),
        motionScheduleDays: JSON.stringify(Array.isArray(cam.motionScheduleDays) ? cam.motionScheduleDays : [0, 1, 2, 3, 4, 5, 6]),
        motionScheduleSensitivity: Number(cam.motionScheduleSensitivity) || 90,
        alarmCooldownSeconds: Number(cam.alarmCooldownSeconds) || 30,
        notificationsEnabled: Boolean(cam.notificationsEnabled),
        storageTargetId,
      };

      await prisma.camera.upsert({
        where: { id: cam.id },
        create: {
          id: cam.id,
          ...data,
        },
        update: data,
      });

      importedCameras++;
    }

    // 3. Process Settings if present
    if (backup.settings && typeof backup.settings === "object") {
      const s = backup.settings;
      await prisma.settings.upsert({
        where: { id: "default" },
        create: {
          id: "default",
          columns: s.columns ?? undefined,
          refresh: s.refresh ?? undefined,
          autoCleanup: s.autoCleanup ?? true,
          ntfyTopic: s.ntfyTopic || null,
          ntfyServer: s.ntfyServer || null,
          ntfyCameraStatusEnabled: Boolean(s.ntfyCameraStatusEnabled),
          telegramBotToken: s.telegramBotToken || null,
          telegramChatId: s.telegramChatId || null,
          telegramEnabled: s.telegramEnabled !== false,
          telegramCameraStatusEnabled: Boolean(s.telegramCameraStatusEnabled),
        },
        update: {
          columns: s.columns ?? undefined,
          refresh: s.refresh ?? undefined,
          autoCleanup: s.autoCleanup ?? true,
          ntfyTopic: s.ntfyTopic || null,
          ntfyServer: s.ntfyServer || null,
          ntfyCameraStatusEnabled: Boolean(s.ntfyCameraStatusEnabled),
          telegramBotToken: s.telegramBotToken || null,
          telegramChatId: s.telegramChatId || null,
          telegramEnabled: s.telegramEnabled !== false,
          telegramCameraStatusEnabled: Boolean(s.telegramCameraStatusEnabled),
        },
      });
    }

    return NextResponse.json({
      ok: true,
      mode,
      importedCameras,
      importedStorageTargets: storagePathToId.size,
      message: `Erfolgreich ${importedCameras} Kamera(s) und ${storagePathToId.size} Speicherziel(e) wiederhergestellt.`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Wiederherstellung fehlgeschlagen";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
