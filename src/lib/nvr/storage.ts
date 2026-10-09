import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import os from "os";
import { execFile } from "child_process";
import util from "util";
import { prisma } from "@/lib/db";

const execFileAsync = util.promisify(execFile);

export type StorageStats = {
  path: string;
  exists: boolean;
  writable: boolean;
  isOnline: boolean;
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  usagePercent: number;
  recordingsCount: number;
  recordingsSizeBytes: number;
  error?: string;
};

export type DiscoveredVolume = {
  name: string;
  path: string;
  totalBytes: number;
  freeBytes: number;
  suggestedPath: string;
  isAlreadyConfigured: boolean;
};

const DEFAULT_RECORDINGS_DIR = path.join(process.cwd(), "data", "recordings");

/**
 * Ensures the default local storage target exists in the DB and filesystem.
 */
export async function ensureDefaultStorageTarget() {
  try {
    let defaultTarget = await prisma.storageTarget.findFirst({
      where: { isDefault: true },
    });

    if (!defaultTarget) {
      // Check if any target exists
      const anyTarget = await prisma.storageTarget.findFirst();
      if (anyTarget) {
        defaultTarget = await prisma.storageTarget.update({
          where: { id: anyTarget.id },
          data: { isDefault: true },
        });
      } else {
        // Create initial default target
        defaultTarget = await prisma.storageTarget.create({
          data: {
            name: "Lokaler Speicher (Standard)",
            path: DEFAULT_RECORDINGS_DIR,
            isDefault: true,
            enabled: true,
            maxDays: 14,
            minFreeSpaceGb: 10,
          },
        });
      }
    }

    // Ensure directory exists
    if (!fs.existsSync(defaultTarget.path)) {
      await fsp.mkdir(defaultTarget.path, { recursive: true });
    }

    return defaultTarget;
  } catch (err) {
    console.error("Error ensuring default storage target:", err);
    return null;
  }
}

/**
 * Calculates disk stats and recording file counts for a directory.
 */
export async function getStorageStats(targetPath: string): Promise<StorageStats> {
  const result: StorageStats = {
    path: targetPath,
    exists: false,
    writable: false,
    isOnline: false,
    totalBytes: 0,
    freeBytes: 0,
    usedBytes: 0,
    usagePercent: 0,
    recordingsCount: 0,
    recordingsSizeBytes: 0,
  };

  try {
    if (!fs.existsSync(targetPath)) {
      result.error = "Verzeichnis existiert nicht.";
      return result;
    }
    result.exists = true;

    // Test write permission
    const testFile = path.join(targetPath, `.onvif_probe_${Date.now()}`);
    try {
      await fsp.writeFile(testFile, "probe");
      await fsp.unlink(testFile);
      result.writable = true;
      result.isOnline = true;
    } catch (writeErr: any) {
      result.writable = false;
      result.error = `Keine Schreibrechte: ${writeErr?.message || writeErr}`;
      return result;
    }

    // Get disk space via statfs
    try {
      const statfs = fs.statfsSync(targetPath);
      const bsize = statfs.bsize || 4096;
      result.totalBytes = Number(statfs.blocks) * bsize;
      result.freeBytes = Number(statfs.bavail) * bsize;
      result.usedBytes = Math.max(0, result.totalBytes - result.freeBytes);
      result.usagePercent = result.totalBytes > 0
        ? Math.round((result.usedBytes / result.totalBytes) * 100)
        : 0;
    } catch (statfsErr) {
      console.warn("statfs failed on targetPath", targetPath, statfsErr);
    }

    // Scan recordings count and total size
    try {
      const scanDir = async (dir: string): Promise<{ count: number; size: number }> => {
        let count = 0;
        let size = 0;
        const entries = await fsp.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith(".")) continue;
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            const sub = await scanDir(fullPath);
            count += sub.count;
            size += sub.size;
          } else if (entry.isFile() && (entry.name.endsWith(".mp4") || entry.name.endsWith(".m4s") || entry.name.endsWith(".ts"))) {
            count++;
            try {
              const fileStat = await fsp.stat(fullPath);
              size += fileStat.size;
            } catch {}
          }
        }
        return { count, size };
      };

      const { count, size } = await scanDir(targetPath);
      result.recordingsCount = count;
      result.recordingsSizeBytes = size;
    } catch {}

    return result;
  } catch (err: any) {
    result.error = err?.message || String(err);
    return result;
  }
}

/**
 * Discovers available disk volumes / mount points on the host system.
 */
export async function discoverSystemVolumes(): Promise<DiscoveredVolume[]> {
  const volumes: DiscoveredVolume[] = [];
  const configuredTargets = await prisma.storageTarget.findMany({ select: { path: true } });
  const configuredPaths = new Set(configuredTargets.map((t) => path.resolve(t.path)));

  const isMac = os.platform() === "darwin";
  const searchDirs: string[] = [];

  if (isMac) {
    searchDirs.push("/Volumes");
  } else {
    searchDirs.push("/media", "/mnt", "/run/media");
  }

  // 1. Always offer default internal data directory
  const localDefault = path.resolve(DEFAULT_RECORDINGS_DIR);
  try {
    let total = 0;
    let free = 0;
    try {
      const statfs = fs.statfsSync(process.cwd());
      total = Number(statfs.blocks) * (statfs.bsize || 4096);
      free = Number(statfs.bavail) * (statfs.bsize || 4096);
    } catch {}
    volumes.push({
      name: "Interner Speicher (App-Verzeichnis)",
      path: localDefault,
      suggestedPath: localDefault,
      totalBytes: total,
      freeBytes: free,
      isAlreadyConfigured: configuredPaths.has(localDefault),
    });
  } catch {}

  // 2. Discover system mounts
  for (const root of searchDirs) {
    try {
      if (!fs.existsSync(root)) continue;
      const entries = await fsp.readdir(root, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        if (entry.name === "Recovery" || entry.name.includes("TimeMachine") || entry.name.includes("localsnapshots")) continue;

        const volumePath = path.join(root, entry.name);
        try {
          const stat = await fsp.stat(volumePath);
          if (!stat.isDirectory()) continue;

          let total = 0;
          let free = 0;
          try {
            const statfs = fs.statfsSync(volumePath);
            total = Number(statfs.blocks) * (statfs.bsize || 4096);
            free = Number(statfs.bavail) * (statfs.bsize || 4096);
          } catch {}

          const suggestedPath = path.join(volumePath, "onvif-recordings");
          const isConfigured = configuredPaths.has(path.resolve(volumePath)) || configuredPaths.has(path.resolve(suggestedPath));

          volumes.push({
            name: entry.name,
            path: volumePath,
            suggestedPath,
            totalBytes: total,
            freeBytes: free,
            isAlreadyConfigured: isConfigured,
          });
        } catch {}
      }
    } catch (scanErr) {
      console.warn("Failed scanning mount dir", root, scanErr);
    }
  }

  return volumes;
}

/**
 * Tests an arbitrary path for existence and write permissions.
 */
export async function testStoragePath(
  targetPath: string,
  autoCreate = false
): Promise<{
  ok: boolean;
  exists: boolean;
  writable: boolean;
  created: boolean;
  totalBytes: number;
  freeBytes: number;
  error?: string;
}> {
  const res = {
    ok: false,
    exists: false,
    writable: false,
    created: false,
    totalBytes: 0,
    freeBytes: 0,
    error: undefined as string | undefined,
  };

  try {
    const resolved = path.resolve(targetPath);
    let exists = fs.existsSync(resolved);

    if (!exists && autoCreate) {
      try {
        await fsp.mkdir(resolved, { recursive: true });
        res.created = true;
        exists = true;
      } catch (mkdirErr: any) {
        res.error = `Ordner konnte nicht erstellt werden: ${mkdirErr?.message || mkdirErr}`;
        return res;
      }
    }

    res.exists = exists;
    if (!exists) {
      res.error = "Der angegebene Pfad existiert nicht auf dem System.";
      return res;
    }

    // Test write permission
    const testFile = path.join(resolved, `.test_write_${Date.now()}`);
    try {
      await fsp.writeFile(testFile, "test-write");
      await fsp.unlink(testFile);
      res.writable = true;
    } catch (writeErr: any) {
      res.writable = false;
      res.error = `Keine Schreibberechtigung in diesem Ordner: ${writeErr?.message || writeErr}`;
      return res;
    }

    // Disk space
    try {
      const statfs = fs.statfsSync(resolved);
      const bsize = statfs.bsize || 4096;
      res.totalBytes = Number(statfs.blocks) * bsize;
      res.freeBytes = Number(statfs.bavail) * bsize;
    } catch {}

    res.ok = true;
    return res;
  } catch (err: any) {
    res.error = err?.message || String(err);
    return res;
  }
}

/**
 * Automatically fixes write permissions on a folder via helper script or direct chmod.
 */
export async function fixPathPermissions(targetPath: string): Promise<{
  ok: boolean;
  message: string;
  error?: string;
}> {
  const resolved = path.resolve(targetPath);
  if (!fs.existsSync(resolved)) {
    try {
      await fsp.mkdir(resolved, { recursive: true });
    } catch (e: any) {
      return { ok: false, message: "Ordner existiert nicht und konnte nicht erstellt werden.", error: e?.message };
    }
  }

  // 1. Check if helper script is installed
  const helperPath = "/usr/local/bin/onvifscanner-storage-helper";
  if (fs.existsSync(helperPath)) {
    try {
      const { stdout } = await execFileAsync("sudo", [helperPath, "fix-permissions", resolved]);
      const res = JSON.parse(stdout.trim());
      if (res.ok) {
        return { ok: true, message: "Berechtigungen wurden erfolgreich über den System-Dienst freigegeben." };
      }
    } catch (helperErr: any) {
      console.warn("Storage helper failed, trying fallback chmod:", helperErr?.message);
    }
  }

  // 2. Direct chmod fallback
  try {
    await fsp.chmod(resolved, 0o777);
    return { ok: true, message: "Berechtigungen wurden freigegeben (777)." };
  } catch (chmodErr: any) {
    return {
      ok: false,
      message: "Berechtigungen konnten nicht automatisch geändert werden.",
      error: chmodErr?.message || String(chmodErr),
    };
  }
}

/**
 * Mounts a network share (SMB/CIFS or NFS) without CLI.
 */
export async function mountNetworkShare(params: {
  type: "cifs" | "nfs";
  server: string;
  share: string;
  mountpoint: string;
  username?: string;
  password?: string;
  domain?: string;
  persist?: boolean;
}): Promise<{
  ok: boolean;
  message: string;
  error?: string;
}> {
  const resolvedMount = path.resolve(params.mountpoint);
  const helperPath = "/usr/local/bin/onvifscanner-storage-helper";

  if (!fs.existsSync(helperPath)) {
    return {
      ok: false,
      message: "Der automatische Mount-Dienst ist auf diesem System nicht aktiv.",
      error: "onvifscanner-storage-helper nicht gefunden. Bitte installer ausführen.",
    };
  }

  try {
    if (params.type === "cifs") {
      const { stdout } = await execFileAsync("sudo", [
        helperPath,
        "mount-cifs",
        params.server,
        params.share,
        resolvedMount,
        params.username || "",
        params.password || "",
        params.domain || "",
        params.persist !== false ? "true" : "false",
      ]);
      const res = JSON.parse(stdout.trim());
      return { ok: true, message: res.message || "SMB/CIFS Freigabe erfolgreich eingehängt." };
    } else {
      const { stdout } = await execFileAsync("sudo", [
        helperPath,
        "mount-nfs",
        params.server,
        params.share,
        resolvedMount,
        params.persist !== false ? "true" : "false",
      ]);
      const res = JSON.parse(stdout.trim());
      return { ok: true, message: res.message || "NFS Freigabe erfolgreich eingehängt." };
    }
  } catch (mountErr: any) {
    return {
      ok: false,
      message: "Fehler beim Einhängen der Netzwerkfreigabe.",
      error: mountErr?.stderr || mountErr?.message || String(mountErr),
    };
  }
}

/**
 * Executes retention policy (deletes clips older than maxDays, or oldest clips if free space < minFreeSpaceGb).
 */
export async function runStorageRetention(targetId?: string) {
  const results: Array<{ targetId: string; name: string; deletedFiles: number; freedBytes: number; error?: string }> = [];

  const targets = await prisma.storageTarget.findMany({
    where: targetId ? { id: targetId } : { enabled: true },
  });

  for (const target of targets) {
    const targetResult = {
      targetId: target.id,
      name: target.name,
      deletedFiles: 0,
      freedBytes: 0,
      error: undefined as string | undefined,
    };

    try {
      if (!fs.existsSync(target.path)) {
        targetResult.error = "Pfad nicht gefunden.";
        results.push(targetResult);
        continue;
      }

      // Collect all MP4 files with modification times
      type ClipFile = { fullPath: string; mtimeMs: number; size: number };
      const clips: ClipFile[] = [];

      const walk = async (dir: string) => {
        const entries = await fsp.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith(".")) continue;
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await walk(fullPath);
          } else if (entry.isFile() && (entry.name.endsWith(".mp4") || entry.name.endsWith(".m4s"))) {
            try {
              const stat = await fsp.stat(fullPath);
              clips.push({ fullPath, mtimeMs: stat.mtimeMs, size: stat.size });
            } catch {}
          }
        }
      };

      await walk(target.path);

      // Sort oldest first
      clips.sort((a, b) => a.mtimeMs - b.mtimeMs);

      const now = Date.now();
      const maxAgeMs = target.maxDays > 0 ? target.maxDays * 86_400_000 : Infinity;

      // 1. Delete files older than maxDays
      const remainingClips: ClipFile[] = [];
      for (const clip of clips) {
        if (now - clip.mtimeMs > maxAgeMs) {
          try {
            await fsp.unlink(clip.fullPath);
            targetResult.deletedFiles++;
            targetResult.freedBytes += clip.size;
          } catch {}
        } else {
          remainingClips.push(clip);
        }
      }

      // 2. Check if free space is below minFreeSpaceGb
      if (target.minFreeSpaceGb > 0) {
        try {
          const statfs = fs.statfsSync(target.path);
          const bsize = statfs.bsize || 4096;
          let currentFreeBytes = Number(statfs.bavail) * bsize;
          const minFreeBytes = target.minFreeSpaceGb * 1024 * 1024 * 1024;

          // Delete oldest files until min free space is met
          for (const clip of remainingClips) {
            if (currentFreeBytes >= minFreeBytes) break;
            try {
              await fsp.unlink(clip.fullPath);
              targetResult.deletedFiles++;
              targetResult.freedBytes += clip.size;
              currentFreeBytes += clip.size;
            } catch {}
          }
        } catch (statErr) {
          console.warn("Could not check free space for target", target.id, statErr);
        }
      }

      // Clean empty camera subdirectories
      try {
        const cameraDirs = await fsp.readdir(target.path, { withFileTypes: true });
        for (const cDir of cameraDirs) {
          if (cDir.isDirectory()) {
            const cPath = path.join(target.path, cDir.name);
            const contents = await fsp.readdir(cPath);
            if (contents.length === 0) {
              await fsp.rmdir(cPath);
            }
          }
        }
      } catch {}
    } catch (err: any) {
      targetResult.error = err?.message || String(err);
    }

    results.push(targetResult);
  }

  return results;
}
