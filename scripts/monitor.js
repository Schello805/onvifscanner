const { PrismaClient } = require('@prisma/client');
const net = require('net');
const { OnvifEventManager } = require('./onvif-events');

const prisma = new PrismaClient();
const onvifEvents = new OnvifEventManager(prisma);
const appPort = process.env.PORT || '3000';
const appBaseUrl = `http://127.0.0.1:${appPort}`;
const motionDetectionEnabled = process.env.ENABLE_MOTION_DETECTION === 'true';
const autoDiscoveryEnabled = process.env.ENABLE_AUTO_DISCOVERY === 'true';
const monitorIntervalMs = Math.max(30_000, Number(process.env.MONITOR_INTERVAL_MS) || 60_000);
let isMonitoring = false;
let cycleRunning = false;
let lastFrames = {};
const monitorTimers = [];

async function mapWithConcurrency(items, concurrency, task) {
  let nextIndex = 0;
  const results = new Array(items.length);
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await task(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function pingCamera(ip, port = 554) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(2500);
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => {
      resolve(false);
    });
    socket.connect(port, ip);
  });
}

async function runMonitorCycle() {
  if (cycleRunning) {
    console.warn('Monitor cycle skipped because the previous cycle is still running.');
    return;
  }
  cycleRunning = true;
  try {
    const cameras = await prisma.camera.findMany();
    const cameraChecks = await mapWithConcurrency(cameras, 8, async (cam) => {
      // First try RTSP port, fallback to HTTP port 80 if needed
      let isOnline = await pingCamera(cam.ip, 554);
      if (!isOnline) {
        isOnline = await pingCamera(cam.ip, 80);
      }
      return { cam, isOnline };
    });

    for (const { cam, isOnline } of cameraChecks) {
      const status = await prisma.deviceStatus.findUnique({ where: { cameraId: cam.id } });
      
      let failures = status ? status.pingFailures : 0;
      if (isOnline) {
        failures = 0;
      } else {
        failures += 1;
      }
      
      const newStatus = isOnline || failures < 3; // Consider offline after 3 consecutive failures

      await prisma.deviceStatus.upsert({
        where: { cameraId: cam.id },
        update: {
          isOnline: newStatus,
          lastSeen: isOnline ? new Date() : undefined,
          pingFailures: failures,
        },
        create: {
          cameraId: cam.id,
          isOnline: newStatus,
          lastSeen: isOnline ? new Date() : new Date(0),
          pingFailures: failures,
        }
      });
    }

    // Phase 3: Sync to MediaMTX
    await syncMediaMtxPaths(cameras);

    // Phase 4: Sync ONVIF Event Pull workers (low resource, event-driven)
    try {
      void onvifEvents.syncCameras(cameras.filter((c) => Boolean(c.ip)));
    } catch (e) {
      // quiet
    }

    if (motionDetectionEnabled) await runMotionDetection(cameras);
  } catch (e) {
    console.error("Monitor Cycle Error:", e);
  } finally {
    cycleRunning = false;
  }
}

async function runMotionDetection(cameras) {
  const { Jimp } = require('jimp');
  for (const cam of cameras) {
     const status = await prisma.deviceStatus.findUnique({ where: { cameraId: cam.id } });
     if (!status || !status.isOnline) continue;
     
     let uris = [];
     try { uris = JSON.parse(cam.snapshotUris).concat(JSON.parse(cam.streamUris)); } catch(e) {}
     if (!uris.length) continue;
     
     try {
       const controller = new AbortController();
       const timer = setTimeout(() => controller.abort(), 8_000);
       // Wir nutzen unsere interne Thumbnail-API für einen zuverlässigen Snapshot
       const res = await fetch(`${appBaseUrl}/api/thumbnail`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            urls: uris,
            size: 256,
            timeoutMs: 3000,
            fastAuth: true,
            credentials: cam.username ? { username: cam.username, password: cam.password } : undefined
          }),
          signal: controller.signal
       }).finally(() => clearTimeout(timer));
       
       if (!res.ok) continue;
       const buffer = await res.arrayBuffer();
       
       const img = await Jimp.read(Buffer.from(buffer));
       img.resize(32, 32).greyscale();
       
       if (lastFrames[cam.id]) {
         const distance = img.distance(lastFrames[cam.id]);
         if (distance > 0.12) { // 12% pixel difference
            // Motion detected!
            await prisma.alarmLog.create({
               data: {
                  cameraId: cam.id,
                  message: "Bewegung erkannt"
               }
            });
            const oldEvents = await prisma.alarmLog.findMany({
              where: { cameraId: cam.id },
              orderBy: { timestamp: 'desc' },
              skip: 500,
              select: { id: true }
            });
            if (oldEvents.length) {
              await prisma.alarmLog.deleteMany({ where: { id: { in: oldEvents.map((event) => event.id) } } });
            }
         }
       }
       lastFrames[cam.id] = img;
     } catch(e) {
        // ignore errors (timeout etc)
     }
  }
}

async function runAutoDiscovery() {
  console.log("🔍 Running silent background auto-discovery...");
  try {
     const res = await fetch(`${appBaseUrl}/api/scan`, {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ preset: 'ws-discovery', acknowledgeAuthorizedNetwork: true, timeoutMs: 3000, fast: true })
     });
     const data = await res.json();
     if (!data.results) return;
     
     const existingCameras = await prisma.camera.findMany({ select: { id: true, ip: true } });
     const existingIds = new Set(existingCameras.map(c => c.id));
     const existingIps = new Set(existingCameras.map(c => c.ip));
     
     for (const dev of data.results) {
        const deviceId = dev.id || dev.ip;
        if (!deviceId || !dev.ip) continue;
        // ignore if already in our wall
        if (existingIds.has(deviceId) || existingIps.has(dev.ip)) continue;

        const deviceName = dev.hostname || [dev.manufacturer, dev.model].filter(Boolean).join(' ') || "Unbekannte Kamera";
        const snapshotUris = Array.isArray(dev.snapshotUris) ? dev.snapshotUris.filter(Boolean) : [];
        const streamUris = Array.isArray(dev.streamUris) ? dev.streamUris.filter(Boolean) : [];
        
        await prisma.discoveredDevice.upsert({
           where: { id: deviceId },
           update: {
              ip: dev.ip,
              name: deviceName,
              hostname: dev.hostname,
              manufacturer: dev.manufacturer,
              model: dev.model,
              snapshotUris: JSON.stringify(snapshotUris),
              streamUris: JSON.stringify(streamUris)
           },
           create: {
              id: deviceId,
              ip: dev.ip,
              name: deviceName,
              hostname: dev.hostname,
              manufacturer: dev.manufacturer,
              model: dev.model,
              snapshotUris: JSON.stringify(snapshotUris),
              streamUris: JSON.stringify(streamUris)
           }
        });
     }
  } catch(e) {
    console.error("Auto-Discovery error:", e);
  }
}

async function syncMediaMtxPaths(cameras) {
  try {
    const listRes = await fetch('http://127.0.0.1:9997/v3/config/paths/list');
    if (!listRes.ok) return;
    const currentPaths = (await listRes.json()).items || [];
    
    // Fetch default storage target if any
    const defaultStorage = await prisma.storageTarget.findFirst({
      where: { isDefault: true, enabled: true }
    });
    const defaultStoragePath = defaultStorage?.path || require('path').join(process.cwd(), 'data', 'recordings');

    const desiredPaths = {};
    for (const cam of cameras) {
      let uris = Array.isArray(cam.streamUris) ? cam.streamUris : [];
      if (!Array.isArray(cam.streamUris) && typeof cam.streamUris === 'string') {
        try { uris = JSON.parse(cam.streamUris); } catch(e) {}
      }
      
      if (uris && uris.length > 0) {
        let uri = uris.find((value) => typeof value === 'string' && /^rtsps?:\/\//i.test(value));
        if (!uri) continue;
        if (cam.username) {
           try {
              let parsed = new URL(uri);
              parsed.username = cam.username;
              parsed.password = cam.password || "";
              uri = parsed.toString();
           } catch(e) {}
        }

        let recordPath = null;
        let segmentDuration = "15m";
        if (cam.recordEnabled) {
          const fs = require('fs');
          const path = require('path');
          let targetDir = defaultStoragePath;
          if (cam.storageTargetId) {
            const target = await prisma.storageTarget.findUnique({ where: { id: cam.storageTargetId } });
            if (target && target.enabled) targetDir = target.path;
          }
          const camRecordDir = path.join(targetDir, cam.id);
          if (!fs.existsSync(camRecordDir)) {
            try { fs.mkdirSync(camRecordDir, { recursive: true }); } catch {}
          }
          recordPath = path.join(targetDir, cam.id, '%Y-%m-%d_%H-%M-%S');
          segmentDuration = `${Math.max(1, cam.recordSegmentMinutes || 15)}m`;
        }

        desiredPaths[cam.id] = {
          source: uri,
          sourceOnDemand: !cam.recordEnabled,
          rtspTransport: "tcp",
          record: Boolean(cam.recordEnabled),
          ...(cam.recordEnabled ? {
            recordPath,
            recordFormat: "fmp4",
            recordPartDuration: "1s",
            recordSegmentDuration: segmentDuration,
            recordDeleteAfter: "0s"
          } : {})
        };
      }
    }

    for (const [id, config] of Object.entries(desiredPaths)) {
      const existing = currentPaths.find(p => p.name === id);
      if (!existing) {
        await fetch(`http://127.0.0.1:9997/v3/config/paths/add/${encodeURIComponent(id)}`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(config)
        }).catch(()=>null);
      } else if (
        existing.source !== config.source ||
        existing.record !== config.record ||
        existing.sourceOnDemand !== config.sourceOnDemand ||
        existing.rtspTransport !== config.rtspTransport ||
        (config.record && existing.recordPath !== config.recordPath) ||
        (config.record && existing.recordSegmentDuration !== config.recordSegmentDuration && existing.recordSegmentDuration !== `${config.recordSegmentDuration}0s`)
      ) {
        await fetch(`http://127.0.0.1:9997/v3/config/paths/patch/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(config)
        }).catch(()=>null);
      }
    }
    
    for (const p of currentPaths) {
       if (p.name !== 'all_others' && p.name !== '~^.*$' && !desiredPaths[p.name]) {
          await fetch(`http://127.0.0.1:9997/v3/config/paths/delete/${encodeURIComponent(p.name)}`, { method: 'DELETE' }).catch(()=>null);
       }
    }
  } catch (e) {
    // Ignore if MediaMTX is not running
  }
}

async function runRetentionJob() {
  try {
    const fs = require('fs');
    const fsp = require('fs/promises');
    const path = require('path');
    const targets = await prisma.storageTarget.findMany({ where: { enabled: true } });

    let totalDeleted = 0;
    let totalFreed = 0;
    const results = [];

    for (const target of targets) {
      if (!fs.existsSync(target.path)) continue;

      let targetDeleted = 0;
      let targetFreed = 0;

      const clips = [];
      const walk = async (dir) => {
        const entries = await fsp.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue;
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await walk(fullPath);
          } else if (entry.isFile() && (entry.name.endsWith('.mp4') || entry.name.endsWith('.m4s') || entry.name.endsWith('.ts'))) {
            try {
              const stat = await fsp.stat(fullPath);
              clips.push({ fullPath, mtimeMs: stat.mtimeMs, size: stat.size });
            } catch {}
          }
        }
      };

      await walk(target.path);
      clips.sort((a, b) => a.mtimeMs - b.mtimeMs);

      const now = Date.now();
      const maxAgeMs = target.maxDays > 0 ? target.maxDays * 86_400_000 : Infinity;

      // 1. Delete files older than maxDays
      const remainingClips = [];
      for (const clip of clips) {
        if (now - clip.mtimeMs > maxAgeMs) {
          try {
            await fsp.unlink(clip.fullPath);
            targetDeleted++;
            targetFreed += clip.size;
          } catch {}
        } else {
          remainingClips.push(clip);
        }
      }

      // 2. Check emergency buffer (minFreeSpaceGb)
      if (target.minFreeSpaceGb > 0) {
        try {
          const statfs = fs.statfsSync(target.path);
          let currentFreeBytes = Number(statfs.bavail) * (statfs.bsize || 4096);
          const minFreeBytes = target.minFreeSpaceGb * 1024 * 1024 * 1024;
          for (const clip of remainingClips) {
            if (currentFreeBytes >= minFreeBytes) break;
            try {
              await fsp.unlink(clip.fullPath);
              targetDeleted++;
              targetFreed += clip.size;
              currentFreeBytes += clip.size;
            } catch {}
          }
        } catch {}
      }

      // 3. Clean empty subdirectories recursively
      const cleanEmptyDirs = async (dir) => {
        try {
          const entries = await fsp.readdir(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory()) {
              await cleanEmptyDirs(path.join(dir, entry.name));
            }
          }
          if (dir !== target.path) {
            const rem = await fsp.readdir(dir);
            if (rem.length === 0) await fsp.rmdir(dir);
          }
        } catch {}
      };
      await cleanEmptyDirs(target.path);

      totalDeleted += targetDeleted;
      totalFreed += targetFreed;
      results.push({
        targetId: target.id,
        name: target.name,
        deletedFiles: targetDeleted,
        freedBytes: targetFreed,
      });
    }

    // Persist status to data/retention_status.json
    try {
      const statusFilePath = path.join(process.cwd(), 'data', 'retention_status.json');
      const statusData = {
        lastRun: new Date().toISOString(),
        totalDeletedFiles: totalDeleted,
        totalFreedBytes: totalFreed,
        results,
      };
      await fsp.writeFile(statusFilePath, JSON.stringify(statusData, null, 2), 'utf8');
    } catch {}

    if (totalDeleted > 0) {
      console.log(`[Retention Watchdog] 🧹 Bereinigung: ${totalDeleted} Dateien gelöscht, ${Math.round(totalFreed / 1024 / 1024)} MB freigegeben.`);
    }
  } catch (err) {
    console.error('Retention Job Error:', err);
  }
}

function startMonitor() {
  if (isMonitoring) return;
  isMonitoring = true;
  
  console.log(`🚀 Starting background liveness monitor (${monitorIntervalMs}ms interval)...`);
  if (!motionDetectionEnabled) console.log('Legacy Jimp snapshot motion detection is disabled.');
  
  // Start ONVIF event listener
  onvifEvents.start();

  // Run immediately, then every 60 seconds
  void runMonitorCycle();
  monitorTimers.push(setInterval(() => void runMonitorCycle(), monitorIntervalMs));

  // Run storage retention cleanup every 15 minutes
  monitorTimers.push(setInterval(() => void runRetentionJob(), 15 * 60 * 1000));
  monitorTimers.push(setTimeout(() => void runRetentionJob(), 30_000));
  
  if (autoDiscoveryEnabled) {
    monitorTimers.push(setInterval(() => void runAutoDiscovery(), 4 * 60 * 60 * 1000));
    monitorTimers.push(setTimeout(() => void runAutoDiscovery(), 15_000));
  }
}

async function stopMonitor() {
  onvifEvents.stop();
  for (const timer of monitorTimers) clearTimeout(timer);
  monitorTimers.length = 0;
  isMonitoring = false;
  await prisma.$disconnect().catch(() => undefined);
}

module.exports = {
  startMonitor,
  stopMonitor
};
