import { prisma } from "@/lib/db";
import { isPrivateIpv4 } from "@/lib/net/ip";
import path from "path";
import fs from "fs";
import { ensureDefaultStorageTarget } from "./storage";

const MEDIA_MTX_API = process.env.MEDIAMTX_API_URL ?? "http://127.0.0.1:9997";

export type CameraNvrConfig = {
  recordEnabled: boolean;
  recordSegmentMinutes: number;
  storageTargetId?: string | null;
};

/**
 * Builds the MediaMTX RTSP source URL with credentials for a camera.
 */
export function getCameraSourceUrl(camera: {
  streamUris: string;
  username?: string | null;
  password?: string | null;
}): string | null {
  try {
    let parsedUris: unknown = [];
    try {
      parsedUris = JSON.parse(camera.streamUris);
    } catch {
      parsedUris = [];
    }

    const streamUri = Array.isArray(parsedUris)
      ? parsedUris.find((v): v is string => typeof v === "string" && /^rtsps?:\/\//i.test(v.trim()))
      : undefined;

    if (!streamUri) return null;

    const source = new URL(streamUri);
    if (source.protocol !== "rtsp:" && source.protocol !== "rtsps:") return null;

    if ((process.env.ALLOW_PUBLIC_SCAN ?? "false") !== "true" && !isPrivateIpv4(source.hostname)) {
      return null;
    }

    if (camera.username) {
      source.username = camera.username;
      source.password = camera.password ?? "";
    }

    return source.toString();
  } catch {
    return null;
  }
}

/**
 * Synchronizes a single camera's recording setup with MediaMTX.
 */
export async function syncCameraWithMediaMtx(cameraId: string): Promise<{ ok: boolean; message?: string }> {
  try {
    const camera = await prisma.camera.findUnique({
      where: { id: cameraId },
      include: { storageTarget: true },
    });

    if (!camera) {
      return { ok: false, message: "Kamera nicht gefunden." };
    }

    const sourceUrl = getCameraSourceUrl(camera);
    if (!sourceUrl) {
      return { ok: false, message: "Keine gültige RTSP-Stream-URL vorhanden." };
    }

    const pathName = camera.id;
    const encodedPath = encodeURIComponent(pathName);

    // Determine storage directory
    let targetPath: string;
    if (camera.storageTarget && camera.storageTarget.enabled) {
      targetPath = camera.storageTarget.path;
    } else {
      const defaultTarget = await ensureDefaultStorageTarget();
      targetPath = defaultTarget ? defaultTarget.path : path.join(process.cwd(), "data", "recordings");
    }

    const cameraRecordDir = path.join(targetPath, camera.id);
    if (!fs.existsSync(cameraRecordDir)) {
      try {
        fs.mkdirSync(cameraRecordDir, { recursive: true });
      } catch (err) {
        console.warn("Failed creating camera record dir", cameraRecordDir, err);
      }
    }

    const segmentDuration = `${Math.max(1, camera.recordSegmentMinutes || 15)}m`;
    const recordPattern = path.join(targetPath, camera.id, "%Y-%m-%d_%H-%M-%S");

    const mtxConfig: Record<string, any> = {
      source: sourceUrl,
      sourceOnDemand: !camera.recordEnabled, // 24/7 if recordEnabled, otherwise on-demand
      record: camera.recordEnabled,
      recordPath: recordPattern,
      recordFormat: "fmp4",
      recordPartDuration: "1s",
      recordSegmentDuration: segmentDuration,
      recordDeleteAfter: "0s",
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const existing = await fetch(`${MEDIA_MTX_API}/v3/config/paths/get/${encodedPath}`, {
        cache: "no-store",
        signal: controller.signal,
      });

      const endpoint = existing.ok
        ? `${MEDIA_MTX_API}/v3/config/paths/patch/${encodedPath}`
        : `${MEDIA_MTX_API}/v3/config/paths/add/${encodedPath}`;

      const res = await fetch(endpoint, {
        method: existing.ok ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(mtxConfig),
        signal: controller.signal,
      });

      if (!res.ok) {
        const detail = (await res.text()).slice(0, 200);
        return { ok: false, message: `MediaMTX HTTP ${res.status}: ${detail}` };
      }

      return { ok: true };
    } finally {
      clearTimeout(timeout);
    }
  } catch (err: any) {
    return { ok: false, message: err?.message || String(err) };
  }
}

/**
 * Synchronizes all cameras marked with recordEnabled = true with MediaMTX.
 */
export async function syncAllRecordingCameras(): Promise<{ synced: number; errors: string[] }> {
  const recordingCameras = await prisma.camera.findMany({
    where: { recordEnabled: true },
  });

  let synced = 0;
  const errors: string[] = [];

  for (const cam of recordingCameras) {
    const res = await syncCameraWithMediaMtx(cam.id);
    if (res.ok) {
      synced++;
    } else {
      errors.push(`Kamera ${cam.name} (${cam.id}): ${res.message}`);
    }
  }

  return { synced, errors };
}
