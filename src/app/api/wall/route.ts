import { NextResponse } from "next/server";
import { RECORDING_MODES, normalizeRecordingMode, recordingModeUsesSchedule } from "@/lib/recordingPolicy";
import fs from "fs/promises";
import path from "path";
import { prisma } from "@/lib/db";
import { decryptSecret, encryptSecret, MASKED_PASSWORD } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATA_DIR = path.join(process.cwd(), "data");
const FILE_PATH = path.join(DATA_DIR, "wall.json");

function normalizeMotionRegions(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 256).flatMap((region) => {
    if (!region || typeof region !== "object") return [];
    const source = region as Record<string, unknown>;
    const x = Math.min(1, Math.max(0, Number(source.x)));
    const y = Math.min(1, Math.max(0, Number(source.y)));
    const width = Math.min(1 - x, Math.max(0, Number(source.width)));
    const height = Math.min(1 - y, Math.max(0, Number(source.height)));
    return Number.isFinite(x) && Number.isFinite(y) && width >= 0.01 && height >= 0.01
      ? [{ x, y, width, height }]
      : [];
  });
}

function normalizeStringArray(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback;
  return Array.from(new Set(value.filter((entry): entry is string => typeof entry === "string"))).slice(0, 16);
}

function normalizeScheduleDays(value: unknown) {
  if (!Array.isArray(value)) return [0, 1, 2, 3, 4, 5, 6];
  return Array.from(new Set(value.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))).sort();
}

function normalizeTime(value: unknown, fallback: string) {
  const text = String(value || "");
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : fallback;
}

export async function GET() {
  try {
    const dbCameras = await prisma.camera.findMany({
      include: { status: true },
      orderBy: { sortOrder: "asc" }
    });

    const settings = await prisma.settings.findUnique({
      where: { id: "default" }
    });

    if (dbCameras.length === 0) {
      try {
        const content = await fs.readFile(FILE_PATH, "utf-8");
        const parsed = JSON.parse(content);
        if (parsed.cameras && Array.isArray(parsed.cameras) && parsed.cameras.length > 0) {
          for (const cam of parsed.cameras) {
            await prisma.camera.create({
              data: {
                id: cam.id,
                ip: cam.ip,
                name: cam.name,
                hostname: cam.hostname,
                manufacturer: cam.manufacturer,
                model: cam.model,
                snapshotUris: JSON.stringify(cam.snapshotUris || []),
                streamUris: JSON.stringify(cam.streamUris || []),
                username: cam.credentials?.username,
                password: encryptSecret(cam.credentials?.password),
                overlayPosition: cam.overlayPosition,
                group: cam.group || null,
                savedAt: cam.savedAt ? new Date(cam.savedAt) : new Date(),
                status: {
                  create: {
                    isOnline: true
                  }
                }
              }
            });
          }
          await prisma.settings.upsert({
            where: { id: "default" },
            update: { columns: parsed.columns ?? null, refresh: parsed.refresh ?? null },
            create: { id: "default", columns: parsed.columns ?? null, refresh: parsed.refresh ?? null }
          });

          const sanitizedMigrated = parsed.cameras.map((cam: any) => ({
            ...cam,
            credentials: cam.credentials?.username
              ? { username: cam.credentials.username, password: cam.credentials.password ? MASKED_PASSWORD : "" }
              : undefined,
          }));
          return NextResponse.json({
            cameras: sanitizedMigrated,
            columns: parsed.columns ?? null,
            refresh: parsed.refresh ?? null
          });
        }
      } catch (e) {
        // wall.json migration failed or not found, proceed normally
      }
    }

    const cameras = dbCameras.map(cam => {
      const hasRealPassword = Boolean(decryptSecret(cam.password));
      return {
        id: cam.id,
        ip: cam.ip,
        name: cam.name,
        hostname: cam.hostname ?? undefined,
        manufacturer: cam.manufacturer ?? undefined,
        model: cam.model ?? undefined,
        resolution: cam.resolution ?? undefined,
        recordEnabled: cam.recordEnabled,
        recordMode: normalizeRecordingMode(cam),
        recordSegmentMinutes: cam.recordSegmentMinutes,
        motionPreRollSeconds: cam.motionPreRollSeconds,
        motionPostRollSeconds: cam.motionPostRollSeconds,
        alarmCooldownSeconds: cam.alarmCooldownSeconds,
        motionSensitivity: cam.motionSensitivity,
        motionIgnoreRegions: normalizeMotionRegions(JSON.parse(cam.motionIgnoreRegions || "[]")),
        objectDetectionEnabled: cam.objectDetectionEnabled,
        objectDetectionClasses: normalizeStringArray(JSON.parse(cam.objectDetectionClasses || "[]"), ["person", "vehicle", "animal"]),
        objectMinConfidence: cam.objectMinConfidence,
        licensePlateRecognitionEnabled: cam.licensePlateRecognitionEnabled,
        motionScheduleEnabled: cam.motionScheduleEnabled,
        motionScheduleStart: cam.motionScheduleStart,
        motionScheduleEnd: cam.motionScheduleEnd,
        motionScheduleDays: normalizeScheduleDays(JSON.parse(cam.motionScheduleDays || "[]")),
        motionScheduleSensitivity: cam.motionScheduleSensitivity,
        notificationsEnabled: cam.notificationsEnabled,
        storageTargetId: cam.storageTargetId ?? undefined,
        snapshotUris: JSON.parse(cam.snapshotUris),
        streamUris: JSON.parse(cam.streamUris),
        credentials: cam.username
          ? { username: cam.username, password: hasRealPassword ? MASKED_PASSWORD : "" }
          : undefined,
        overlayPosition: cam.overlayPosition ?? undefined,
        group: cam.group ?? undefined,
        savedAt: cam.savedAt.toISOString(),
        status: cam.status ? { isOnline: cam.status.isOnline, lastSeen: cam.status.lastSeen.toISOString() } : undefined
      };
    });

    return NextResponse.json({ 
      cameras, 
      columns: settings?.columns ?? null, 
      refresh: settings?.refresh ?? null 
    });
  } catch (error: any) {
    console.error("API Error GET /api/wall", error);
    return NextResponse.json({ error: "Failed to read wall data" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    
    // First save settings
    await prisma.settings.upsert({
      where: { id: "default" },
      update: { columns: body.columns ?? null, refresh: body.refresh ?? null },
      create: { id: "default", columns: body.columns ?? null, refresh: body.refresh ?? null }
    });

    // Then save cameras
    if (body.cameras && Array.isArray(body.cameras)) {
      // 1. Get existing cameras to avoid losing status and preserved encrypted passwords
      const existing = await prisma.camera.findMany({ select: { id: true, password: true } });
      const existingMap = new Map(existing.map(e => [e.id, e]));
      const existingIds = new Set(existing.map(e => e.id));
      const incomingIds = new Set(body.cameras.map((c: any) => c.id));

      // 2. Delete ones that are no longer in the wall
      const toDelete = Array.from(existingIds).filter(id => !incomingIds.has(id));
      if (toDelete.length > 0) {
        await prisma.camera.deleteMany({
          where: { id: { in: toDelete } }
        });
      }

      // 3. Upsert incoming cameras
      for (let i = 0; i < body.cameras.length; i++) {
        const cam = body.cameras[i];
        const prevCam = existingMap.get(cam.id);
        const incomingPass = cam.credentials?.password;
        const resolvedEncryptedPassword = !cam.credentials?.username
          ? null
          : incomingPass === MASKED_PASSWORD && prevCam
          ? encryptSecret(decryptSecret(prevCam.password))
          : encryptSecret(incomingPass ?? "");

        await prisma.camera.upsert({
          where: { id: cam.id },
          update: {
            ip: cam.ip,
            name: cam.name,
            hostname: cam.hostname,
            manufacturer: cam.manufacturer,
            model: cam.model,
            resolution: cam.resolution,
            recordEnabled: typeof cam.recordEnabled === "boolean" ? cam.recordEnabled : undefined,
            recordMode: RECORDING_MODES.includes(cam.recordMode) ? cam.recordMode : undefined,
            recordSegmentMinutes: typeof cam.recordSegmentMinutes === "number" ? cam.recordSegmentMinutes : undefined,
            motionPreRollSeconds: typeof cam.motionPreRollSeconds === "number" ? cam.motionPreRollSeconds : undefined,
            motionPostRollSeconds: typeof cam.motionPostRollSeconds === "number" ? cam.motionPostRollSeconds : undefined,
            alarmCooldownSeconds: typeof cam.alarmCooldownSeconds === "number" ? Math.min(3600, Math.max(10, Math.round(cam.alarmCooldownSeconds))) : undefined,
            motionSensitivity: typeof cam.motionSensitivity === "number" ? Math.min(100, Math.max(1, Math.round(cam.motionSensitivity))) : undefined,
            motionIgnoreRegions: cam.motionIgnoreRegions !== undefined ? JSON.stringify(normalizeMotionRegions(cam.motionIgnoreRegions)) : undefined,
            objectDetectionEnabled: typeof cam.objectDetectionEnabled === "boolean" ? cam.objectDetectionEnabled : undefined,
            objectDetectionClasses: cam.objectDetectionClasses !== undefined ? JSON.stringify(normalizeStringArray(cam.objectDetectionClasses, ["person", "vehicle", "animal"])) : undefined,
            objectMinConfidence: typeof cam.objectMinConfidence === "number" ? Math.min(95, Math.max(20, Math.round(cam.objectMinConfidence))) : undefined,
            licensePlateRecognitionEnabled: typeof cam.licensePlateRecognitionEnabled === "boolean" ? cam.licensePlateRecognitionEnabled : undefined,
            motionScheduleEnabled: RECORDING_MODES.includes(cam.recordMode)
              ? recordingModeUsesSchedule(cam.recordMode)
              : (typeof cam.motionScheduleEnabled === "boolean" ? cam.motionScheduleEnabled : undefined),
            motionScheduleStart: cam.motionScheduleStart !== undefined ? normalizeTime(cam.motionScheduleStart, "22:00") : undefined,
            motionScheduleEnd: cam.motionScheduleEnd !== undefined ? normalizeTime(cam.motionScheduleEnd, "06:00") : undefined,
            motionScheduleDays: cam.motionScheduleDays !== undefined ? JSON.stringify(normalizeScheduleDays(cam.motionScheduleDays)) : undefined,
            motionScheduleSensitivity: typeof cam.motionScheduleSensitivity === "number" ? Math.min(100, Math.max(1, Math.round(cam.motionScheduleSensitivity))) : undefined,
            notificationsEnabled: typeof cam.notificationsEnabled === "boolean" ? cam.notificationsEnabled : undefined,
            storageTargetId: typeof cam.storageTargetId === "string" ? cam.storageTargetId : (cam.storageTargetId === null ? null : undefined),
            snapshotUris: JSON.stringify(cam.snapshotUris || []),
            streamUris: JSON.stringify(cam.streamUris || []),
            username: cam.credentials?.username,
            password: resolvedEncryptedPassword,
            overlayPosition: cam.overlayPosition,
            group: typeof cam.group === "string" ? cam.group.trim() || null : (cam.group === null ? null : undefined),
            sortOrder: i,
          },
          create: {
            id: cam.id,
            ip: cam.ip,
            name: cam.name,
            hostname: cam.hostname,
            manufacturer: cam.manufacturer,
            model: cam.model,
            resolution: cam.resolution,
            group: typeof cam.group === "string" ? cam.group.trim() || null : null,
            recordEnabled: Boolean(cam.recordEnabled),
            recordMode: RECORDING_MODES.includes(cam.recordMode) && cam.recordMode !== "off" ? cam.recordMode : (cam.recordEnabled ? 'motion' : 'off'),
            recordSegmentMinutes: typeof cam.recordSegmentMinutes === "number" ? cam.recordSegmentMinutes : 15,
            motionPreRollSeconds: typeof cam.motionPreRollSeconds === "number" ? cam.motionPreRollSeconds : 10,
            motionPostRollSeconds: typeof cam.motionPostRollSeconds === "number" ? cam.motionPostRollSeconds : 30,
            alarmCooldownSeconds: typeof cam.alarmCooldownSeconds === "number" ? Math.min(3600, Math.max(10, Math.round(cam.alarmCooldownSeconds))) : 30,
            motionSensitivity: typeof cam.motionSensitivity === "number" ? Math.min(100, Math.max(1, Math.round(cam.motionSensitivity))) : 80,
            motionIgnoreRegions: JSON.stringify(normalizeMotionRegions(cam.motionIgnoreRegions)),
            objectDetectionEnabled: Boolean(cam.objectDetectionEnabled),
            objectDetectionClasses: JSON.stringify(normalizeStringArray(cam.objectDetectionClasses, ["person", "vehicle", "animal"])),
            objectMinConfidence: typeof cam.objectMinConfidence === "number" ? Math.min(95, Math.max(20, Math.round(cam.objectMinConfidence))) : 55,
            licensePlateRecognitionEnabled: Boolean(cam.licensePlateRecognitionEnabled),
            motionScheduleEnabled: recordingModeUsesSchedule(cam.recordMode),
            motionScheduleStart: normalizeTime(cam.motionScheduleStart, "22:00"),
            motionScheduleEnd: normalizeTime(cam.motionScheduleEnd, "06:00"),
            motionScheduleDays: JSON.stringify(normalizeScheduleDays(cam.motionScheduleDays)),
            motionScheduleSensitivity: typeof cam.motionScheduleSensitivity === "number" ? Math.min(100, Math.max(1, Math.round(cam.motionScheduleSensitivity))) : 90,
            notificationsEnabled: Boolean(cam.notificationsEnabled),
            storageTargetId: typeof cam.storageTargetId === "string" ? cam.storageTargetId : null,
            snapshotUris: JSON.stringify(cam.snapshotUris || []),
            streamUris: JSON.stringify(cam.streamUris || []),
            username: cam.credentials?.username,
            password: resolvedEncryptedPassword,
            overlayPosition: cam.overlayPosition,
            sortOrder: i,
            status: {
              create: {
                isOnline: true
              }
            }
          }
        });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("API Error POST /api/wall", error);
    return NextResponse.json({ error: "Failed to write wall data" }, { status: 500 });
  }
}
