import type { Credentials, ScanResult } from "@/lib/types";

export const CAMERA_WALL_STORAGE_KEY = "onvifscanner.camera-wall.v1";

export type WallCamera = {
  id: string;
  ip: string;
  name: string;
  hostname?: string;
  manufacturer?: string;
  model?: string;
  resolution?: string;
  recordEnabled?: boolean;
  recordSegmentMinutes?: number;
  storageTargetId?: string | null;
  snapshotUris: string[];
  streamUris: string[];
  credentials?: Credentials;
  overlayPosition?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  savedAt: string;
  group?: string;
  status?: {
    isOnline: boolean;
    lastSeen: string;
  };
};

function getLegacyLocalCameras(): WallCamera[] {
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

export async function loadWallData(): Promise<{ cameras: WallCamera[], columns: number | null, refresh: number | null }> {
  try {
    const res = await fetch("/api/wall", { cache: "no-store" });
    const data = await res.json();
    if (data && data.cameras && data.cameras.length > 0) {
      return data;
    }
  } catch {
    // Ignore fetch error, fallback to local
  }

  // Migrate from local storage if server is empty
  const localCameras = getLegacyLocalCameras();
  let columns = null;
  let refresh = null;
  
  if (typeof window !== "undefined") {
    const rawCol = window.localStorage.getItem("onvifscanner.wall.columns");
    const rawRef = window.localStorage.getItem("onvifscanner.wall.refresh");
    if (rawCol !== null) columns = Number(rawCol);
    if (rawRef !== null) refresh = Number(rawRef);
  }

  if (localCameras.length > 0 || columns !== null || refresh !== null) {
    try {
      await fetch("/api/wall", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cameras: localCameras, columns, refresh })
      });
    } catch {
      // Ignore
    }
  }
  
  return { cameras: localCameras, columns, refresh };
}

export async function saveWallData(data: { cameras: WallCamera[], columns: number | null, refresh: number | null }): Promise<void> {
  await fetch("/api/wall", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
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
    resolution: result.primaryResolution,
    snapshotUris,
    streamUris: Array.from(new Set(result.streamUris ?? [])),
    credentials:
      result.credentials?.username || result.credentials?.password
        ? result.credentials
        : credentials?.username || credentials?.password
        ? credentials
        : undefined,
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
        resolution: camera.resolution || existing.resolution,
        recordEnabled: existing.recordEnabled,
        recordSegmentMinutes: existing.recordSegmentMinutes,
        storageTargetId: existing.storageTargetId,
        snapshotUris: Array.from(new Set([...existing.snapshotUris, ...camera.snapshotUris])),
        streamUris: Array.from(new Set([...existing.streamUris, ...camera.streamUris])),
        credentials: camera.credentials ?? existing.credentials,
        overlayPosition: camera.overlayPosition ?? existing.overlayPosition
      };
    } else {
      merged.push(camera);
    }
  }
  return merged;
}
