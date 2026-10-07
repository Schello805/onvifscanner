import type { Credentials, ScanResult } from "@/lib/types";

export const CAMERA_WALL_STORAGE_KEY = "onvifscanner.camera-wall.v1";

export type WallCamera = {
  id: string;
  ip: string;
  name: string;
  hostname?: string;
  manufacturer?: string;
  model?: string;
  snapshotUris: string[];
  streamUris: string[];
  credentials?: Credentials;
  savedAt: string;
};

export function readWallCameras(): WallCamera[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CAMERA_WALL_STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (camera): camera is WallCamera =>
        typeof camera?.id === "string" &&
        typeof camera?.ip === "string" &&
        Array.isArray(camera?.snapshotUris) &&
        Array.isArray(camera?.streamUris)
    );
  } catch {
    return [];
  }
}

export function writeWallCameras(cameras: WallCamera[]): void {
  window.localStorage.setItem(CAMERA_WALL_STORAGE_KEY, JSON.stringify(cameras));
  window.dispatchEvent(new CustomEvent("onvifscanner:wall-updated"));
}

export function wallCameraFromScan(result: ScanResult, credentials?: Credentials): WallCamera {
  const deviceName = [result.manufacturer, result.model].filter(Boolean).join(" ");
  const snapshotUris = Array.from(
    new Set([
      ...(result.snapshotUris ?? []),
      ...(result.vendor?.snapshotUris ?? []),
      ...(result.onvif?.snapshotUris?.map((entry) => entry.uri) ?? [])
    ].filter(Boolean))
  );

  return {
    id: result.ip,
    ip: result.ip,
    name: result.hostname || deviceName || `Kamera ${result.ip}`,
    hostname: result.hostname,
    manufacturer: result.manufacturer,
    model: result.model,
    snapshotUris,
    streamUris: Array.from(new Set(result.streamUris ?? [])),
    credentials: credentials?.username ? credentials : undefined,
    savedAt: new Date().toISOString()
  };
}

export function upsertWallCameras(current: WallCamera[], additions: WallCamera[]): WallCamera[] {
  const merged = [...current];
  for (const camera of additions) {
    const index = merged.findIndex((item) => item.id === camera.id);
    if (index >= 0) {
      const existing = merged[index];
      merged[index] = {
        ...existing,
        ...camera,
        name: existing.name || camera.name,
        snapshotUris: camera.snapshotUris.length ? camera.snapshotUris : existing.snapshotUris,
        streamUris: camera.streamUris.length ? camera.streamUris : existing.streamUris,
        credentials: camera.credentials ?? existing.credentials
      };
    } else {
      merged.push(camera);
    }
  }
  return merged;
}
