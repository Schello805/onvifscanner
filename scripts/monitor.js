const { PrismaClient } = require('@prisma/client');
const net = require('net');
const sharp = require('sharp');
const { OnvifEventManager } = require('./onvif-events');
const { MotionRecorder, BUFFER_SEGMENT_SECONDS, motionBufferDirectory, motionBufferRecordPattern } = require('./motion-recorder');
const { sendCameraNotification } = require('./ntfy');
const { ObjectDetector } = require('./object-detector');
const { isMotionScheduleActive } = require('./motion-schedule');

const prisma = new PrismaClient();
const onvifEvents = new OnvifEventManager(prisma);
const motionRecorder = new MotionRecorder(prisma);
const objectDetector = new ObjectDetector();
const appPort = process.env.PORT || '3000';
const appBaseUrl = `http://127.0.0.1:${appPort}`;
const motionDetectionEnabled = process.env.ENABLE_MOTION_DETECTION !== 'false';
const objectDetectionEnabled = process.env.ENABLE_OBJECT_DETECTION !== 'false';
const motionDetectionIntervalMs = Math.max(2_000, Number(process.env.MOTION_DETECTION_INTERVAL_MS) || 3_000);
const motionDetectionConcurrency = Math.max(1, Math.min(8, Number(process.env.MOTION_DETECTION_CONCURRENCY) || 3));
const motionPixelThreshold = Math.max(8, Math.min(80, Number(process.env.MOTION_PIXEL_THRESHOLD) || 18));
const motionAreaThreshold = Math.max(0.002, Math.min(0.5, Number(process.env.MOTION_AREA_THRESHOLD) || 0.01));
const motionMeanThreshold = Math.max(0.5, Math.min(30, Number(process.env.MOTION_MEAN_THRESHOLD) || 1));
const motionSourceWidth = Math.max(256, Math.min(768, Number(process.env.MOTION_SOURCE_WIDTH) || 384));
const motionAnalysisWidth = Math.max(160, Math.min(512, Number(process.env.MOTION_ANALYSIS_WIDTH) || 256));
const motionAnalysisHeight = Math.round(motionAnalysisWidth * 9 / 16);
const autoDiscoveryEnabled = process.env.ENABLE_AUTO_DISCOVERY === 'true';
const monitorIntervalMs = Math.max(30_000, Number(process.env.MONITOR_INTERVAL_MS) || 60_000);
let isMonitoring = false;
let cycleRunning = false;
const motionFrames = new Map();
const motionFailureLogTimes = new Map();
let motionDetectionCycleRunning = false;
const monitorTimers = [];
let legacyRecordingModesMigrated = false;
let motionSensitivityDefaultsMigrated = false;

const objectClassGroups = {
  person: new Set(['person']),
  vehicle: new Set(['bicycle', 'car', 'motorcycle', 'bus', 'truck', 'train', 'boat']),
  animal: new Set(['bird', 'cat', 'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe']),
};
const objectGroupLabels = { person: 'Person', vehicle: 'Fahrzeug', animal: 'Tier' };

function parseObjectGroups(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.filter((group) => objectClassGroups[group]) : [];
  } catch {
    return [];
  }
}

function pointIsIgnored(x, y, ignoreRegions) {
  return ignoreRegions.some((region) =>
    x >= region.x && x <= region.x + region.width
    && y >= region.y && y <= region.y + region.height
  );
}

function relevantObjectDetections(result, camera, ignoreRegions) {
  const selectedGroups = new Set(parseObjectGroups(camera.objectDetectionClasses));
  if (!selectedGroups.size) return [];
  return (result.predictions || []).flatMap((prediction) => {
    const group = Object.keys(objectClassGroups).find((key) =>
      selectedGroups.has(key) && objectClassGroups[key].has(prediction.className)
    );
    if (!group) return [];
    const [x, y, width, height] = prediction.bbox || [];
    const centerX = (Number(x) + Number(width) / 2) / Math.max(1, result.width);
    const centerY = (Number(y) + Number(height) / 2) / Math.max(1, result.height);
    if (pointIsIgnored(centerX, centerY, ignoreRegions)) return [];
    return [{ ...prediction, group }];
  });
}

function objectDetectionMessage(detections) {
  const groups = Array.from(new Set(detections.map((detection) => detection.group)));
  return `${groups.map((group) => objectGroupLabels[group]).join(', ')} erkannt (lokale KI)`;
}

function parseMotionIgnoreRegions(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((region) => region
      && Number.isFinite(Number(region.x))
      && Number.isFinite(Number(region.y))
      && Number(region.width) > 0
      && Number(region.height) > 0
    ).map((region) => ({
      x: Math.min(1, Math.max(0, Number(region.x))),
      y: Math.min(1, Math.max(0, Number(region.y))),
      width: Math.min(1, Math.max(0, Number(region.width))),
      height: Math.min(1, Math.max(0, Number(region.height))),
    }));
  } catch {
    return [];
  }
}

function buildActivePixelMask(width, height, ignoreRegions) {
  const pixelCount = width * height;
  if (!ignoreRegions.length) return { activeMask: null, activePixelCount: pixelCount };
  const activeMask = new Uint8Array(pixelCount);
  activeMask.fill(1);
  let activePixelCount = pixelCount;
  for (const region of ignoreRegions) {
    const startX = Math.max(0, Math.floor(region.x * width));
    const endX = Math.min(width, Math.ceil((region.x + region.width) * width));
    const startY = Math.max(0, Math.floor(region.y * height));
    const endY = Math.min(height, Math.ceil((region.y + region.height) * height));
    for (let y = startY; y < endY; y += 1) {
      for (let x = startX; x < endX; x += 1) {
        const index = y * width + x;
        if (activeMask[index]) {
          activeMask[index] = 0;
          activePixelCount -= 1;
        }
      }
    }
  }
  return { activeMask, activePixelCount };
}

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
    if (!legacyRecordingModesMigrated) {
      await prisma.camera.updateMany({
        where: { recordEnabled: true, recordMode: 'off' },
        data: { recordMode: 'motion' },
      });
      legacyRecordingModesMigrated = true;
    }
    if (!motionSensitivityDefaultsMigrated) {
      const settings = await prisma.settings.findUnique({ where: { id: 'default' } });
      if (!settings?.motionSensitivityV3Migrated) {
        await prisma.$transaction([
          prisma.camera.updateMany({ data: { motionSensitivity: 80 } }),
          prisma.settings.upsert({
            where: { id: 'default' },
            update: { motionSensitivityV3Migrated: true },
            create: { id: 'default', motionSensitivityV3Migrated: true },
          }),
        ]);
        console.log('[Motion Detection] Bewegungsempfindlichkeit bestehender Kameras auf 80 % gesetzt.');
      }
      motionSensitivityDefaultsMigrated = true;
    }
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

      const statusChanged = Boolean(status && status.isOnline !== newStatus);
      const initialOnlineStatus = !status && isOnline;
      const statusTimestamp = new Date();
      const operations = [
        prisma.deviceStatus.upsert({
          where: { cameraId: cam.id },
          update: {
            isOnline: newStatus,
            lastSeen: isOnline ? statusTimestamp : undefined,
            pingFailures: failures,
          },
          create: {
            cameraId: cam.id,
            isOnline: newStatus,
            lastSeen: isOnline ? statusTimestamp : new Date(0),
            pingFailures: failures,
          }
        }),
      ];
      if (statusChanged || initialOnlineStatus) {
        operations.push(prisma.cameraStatusLog.create({
          data: {
            cameraId: cam.id,
            status: newStatus ? 'online' : 'offline',
            timestamp: statusTimestamp,
          },
        }));
      }
      await prisma.$transaction(operations);

      if (statusChanged) {
        console.log(`[Camera Status] ${cam.name}: ${newStatus ? 'wieder online' : 'offline'}.`);
      }
      if (statusChanged || initialOnlineStatus) {
        const oldStatusLogs = await prisma.cameraStatusLog.findMany({
          where: { cameraId: cam.id },
          orderBy: { timestamp: 'desc' },
          skip: 500,
          select: { id: true },
        });
        if (oldStatusLogs.length) {
          await prisma.cameraStatusLog.deleteMany({ where: { id: { in: oldStatusLogs.map((entry) => entry.id) } } });
        }
      }
    }

    // Phase 3: Sync to MediaMTX
    await syncMediaMtxPaths(cameras);

    // Phase 4: Sync ONVIF Event Pull workers (low resource, event-driven)
    try {
      void onvifEvents.syncCameras(cameras.filter((camera) =>
        Boolean(camera.ip)
        && parseMotionIgnoreRegions(camera.motionIgnoreRegions).length === 0
        && !camera.objectDetectionEnabled
        && isMotionScheduleActive(camera)
      ));
    } catch (e) {
      // quiet
    }

  } catch (e) {
    console.error("Monitor Cycle Error:", e);
  } finally {
    cycleRunning = false;
  }
}

async function runMotionDetection() {
  if (!motionDetectionEnabled || motionDetectionCycleRunning) return;
  motionDetectionCycleRunning = true;
  try {
    const cameras = await prisma.camera.findMany({
      where: {
        OR: [
          { recordMode: { in: ['motion', 'continuous'] } },
          { notificationsEnabled: true },
        ],
      },
      include: { status: true },
      orderBy: { sortOrder: 'asc' },
    });

    await mapWithConcurrency(cameras, motionDetectionConcurrency, detectCameraMotion);
    const activeIds = new Set(cameras.map((camera) => camera.id));
    for (const cameraId of motionFrames.keys()) {
      if (!activeIds.has(cameraId)) motionFrames.delete(cameraId);
    }
  } catch (error) {
    console.error('[Motion Detection] Zyklus fehlgeschlagen:', error);
  } finally {
    motionDetectionCycleRunning = false;
  }
}

async function detectCameraMotion(cam) {
  if (cam.status && !cam.status.isOnline) return;
  if (!isMotionScheduleActive(cam)) {
    motionFrames.delete(cam.id);
    return;
  }

  const ignoreRegions = parseMotionIgnoreRegions(cam.motionIgnoreRegions);
  const maskKey = JSON.stringify(ignoreRegions);

  const onvifEventIsRecent = cam.motionEventSource === 'onvif'
    && cam.motionEventLastSeen
    && Date.now() - cam.motionEventLastSeen.getTime() < 5 * 60_000;
  if (onvifEventIsRecent && ignoreRegions.length === 0 && !cam.objectDetectionEnabled) return;

  let snapshotUris = [];
  let streamUris = [];
  try { snapshotUris = JSON.parse(cam.snapshotUris); } catch {}
  try { streamUris = JSON.parse(cam.streamUris); } catch {}
  const uris = [...snapshotUris, ...streamUris].filter((uri) => typeof uri === 'string' && uri);
  if (!uris.length) return;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    const response = await fetch(`${appBaseUrl}/api/thumbnail`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        urls: uris,
        size: motionSourceWidth,
        quality: 75,
        timeoutMs: 2_500,
        fastAuth: true,
        fresh: true,
        credentials: cam.username ? { username: cam.username, password: cam.password } : undefined,
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
    if (!response.ok) throw new Error(`Snapshot HTTP ${response.status}`);

    const image = Buffer.from(await response.arrayBuffer());
    const { data: pixels, info } = await sharp(image, { limitInputPixels: 32_000_000 })
      .resize(motionAnalysisWidth, motionAnalysisHeight, { fit: 'fill' })
      .greyscale()
      .blur(0.5)
      .raw()
      .toBuffer({ resolveWithObject: true });

    const previous = motionFrames.get(cam.id);
    if (!previous || previous.pixels.length !== pixels.length || previous.maskKey !== maskKey) {
      const mask = buildActivePixelMask(info.width, info.height, ignoreRegions);
      motionFrames.set(cam.id, { pixels, noiseArea: 0, noiseMean: 0, maskKey, ...mask });
      return;
    }

    let changedPixels = 0;
    let differenceSum = 0;
    const channels = Math.max(1, info.channels || 1);
    const activePixelCount = previous.activePixelCount ?? Math.floor(pixels.length / channels);
    const configuredSensitivity = cam.motionScheduleEnabled
      ? cam.motionScheduleSensitivity
      : cam.motionSensitivity;
    const sensitivity = Math.min(100, Math.max(1, Number(configuredSensitivity) || 80));
    const sensitivityFactor = 1.5 - sensitivity / 100;
    const effectivePixelThreshold = Math.max(8, Math.round(motionPixelThreshold * sensitivityFactor));
    for (let index = 0; index < pixels.length; index += channels) {
      const pixelIndex = Math.floor(index / channels);
      if (previous.activeMask && !previous.activeMask[pixelIndex]) continue;
      const difference = Math.abs(pixels[index] - previous.pixels[index]);
      differenceSum += difference;
      if (difference >= effectivePixelThreshold) changedPixels += 1;
    }
    if (activePixelCount === 0) {
      motionFrames.set(cam.id, {
        pixels,
        noiseArea: 0,
        noiseMean: 0,
        maskKey,
        activeMask: previous.activeMask,
        activePixelCount,
      });
      return;
    }
    const changedArea = changedPixels / activePixelCount;
    const meanDifference = differenceSum / activePixelCount;
    const requiredArea = Math.max(motionAreaThreshold, previous.noiseArea * 3 + 0.004) * sensitivityFactor;
    const requiredMean = Math.max(motionMeanThreshold, previous.noiseMean * 2.5 + 0.4) * sensitivityFactor;
    const movementDetected = changedArea >= requiredArea && meanDifference >= requiredMean;

    motionFrames.set(cam.id, {
      pixels,
      noiseArea: movementDetected ? previous.noiseArea : previous.noiseArea * 0.85 + changedArea * 0.15,
      noiseMean: movementDetected ? previous.noiseMean : previous.noiseMean * 0.85 + meanDifference * 0.15,
      maskKey,
      activeMask: previous.activeMask,
      activePixelCount,
    });

    const checkedAt = new Date();
    if (!movementDetected) {
      const healthUpdateDue = cam.motionEventSource !== 'snapshot'
        || cam.motionEventState !== 'active'
        || !cam.motionEventCheckedAt
        || checkedAt.getTime() - cam.motionEventCheckedAt.getTime() >= 60_000;
      if (healthUpdateDue) {
        await prisma.camera.update({
          where: { id: cam.id },
          data: {
            motionEventState: 'active',
            motionEventSource: 'snapshot',
            motionEventCheckedAt: checkedAt,
            motionEventLastError: null,
          },
        });
      }
      return;
    }

    let eventMessage = 'Bewegung erkannt (Server-Bildanalyse)';
    let detectedObjects = [];
    if (cam.objectDetectionEnabled && objectDetectionEnabled) {
      try {
        const result = await objectDetector.detect(image, Math.min(0.95, Math.max(0.2, Number(cam.objectMinConfidence || 55) / 100)));
        detectedObjects = relevantObjectDetections(result, cam, ignoreRegions);
        if (!detectedObjects.length) return;
        eventMessage = objectDetectionMessage(detectedObjects);
      } catch (error) {
        const warningKey = `object:${cam.id}`;
        const lastLogged = motionFailureLogTimes.get(warningKey) || 0;
        if (Date.now() - lastLogged > 60_000) {
          console.warn(`[Object Detection] ${cam.name}: ${error?.message || error}; Rohbewegung wird verwendet.`);
          motionFailureLogTimes.set(warningKey, Date.now());
        }
      }
    }

    const cooldownSeconds = Math.max(5, cam.alarmCooldownSeconds || 30);
    const recentEvent = await prisma.alarmLog.findFirst({
      where: {
        cameraId: cam.id,
        timestamp: { gte: new Date(checkedAt.getTime() - cooldownSeconds * 1000) },
      },
      select: { id: true },
    });
    if (!recentEvent) {
      await prisma.alarmLog.create({
        data: {
          cameraId: cam.id,
          message: eventMessage,
          timestamp: checkedAt,
          objectClasses: detectedObjects.length
            ? JSON.stringify(Array.from(new Set(detectedObjects.map((detection) => detection.group))))
            : null,
          objectDetections: detectedObjects.length ? JSON.stringify(detectedObjects) : null,
        },
      });
      await sendCameraNotification(prisma, cam, eventMessage, { imageBuffer: image, contentType: 'image/jpeg' });
      console.log(`[Motion Detection] ${cam.name}: ${eventMessage} (Fläche ${(changedArea * 100).toFixed(1)}%, Differenz ${meanDifference.toFixed(1)}).`);
      const oldEvents = await prisma.alarmLog.findMany({
        where: { cameraId: cam.id },
        orderBy: { timestamp: 'desc' },
        skip: 500,
        select: { id: true },
      });
      if (oldEvents.length) {
        await prisma.alarmLog.deleteMany({ where: { id: { in: oldEvents.map((event) => event.id) } } });
      }
    }
    await prisma.camera.update({
      where: { id: cam.id },
      data: {
        motionEventState: 'active',
        motionEventSource: 'snapshot',
        motionEventLastSeen: checkedAt,
        motionEventCheckedAt: checkedAt,
        motionEventLastError: null,
      },
    });
  } catch (error) {
    const now = Date.now();
    const lastLogged = motionFailureLogTimes.get(cam.id) || 0;
    if (now - lastLogged > 60_000) {
      console.warn(`[Motion Detection] ${cam.name}: ${error?.message || error}`);
      motionFailureLogTimes.set(cam.id, now);
    }
    const errorMessage = String(error?.message || error).slice(0, 500);
    const errorUpdateDue = cam.motionEventState !== 'error'
      || cam.motionEventLastError !== errorMessage
      || !cam.motionEventCheckedAt
      || now - cam.motionEventCheckedAt.getTime() >= 60_000;
    if (errorUpdateDue) {
      await prisma.camera.update({
        where: { id: cam.id },
        data: {
          motionEventState: 'error',
          motionEventSource: 'snapshot',
          motionEventCheckedAt: new Date(),
          motionEventLastError: errorMessage,
        },
      }).catch(() => undefined);
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

        const recordMode = cam.recordMode === 'continuous' || cam.recordMode === 'motion'
          ? cam.recordMode
          : (cam.recordEnabled ? 'motion' : 'off');
        const recordingActive = recordMode !== 'off';
        let recordPath = null;
        let segmentDuration = "15m";
        if (recordingActive) {
          const fs = require('fs');
          const path = require('path');
          let targetDir = defaultStoragePath;
          if (cam.storageTargetId) {
            const target = await prisma.storageTarget.findUnique({ where: { id: cam.storageTargetId } });
            if (target && target.enabled) targetDir = target.path;
          }
          const camRecordDir = recordMode === 'motion'
            ? motionBufferDirectory(cam.id)
            : path.join(targetDir, cam.id);
          if (!fs.existsSync(camRecordDir)) {
            try { fs.mkdirSync(camRecordDir, { recursive: true }); } catch {}
          }
          recordPath = recordMode === 'motion'
            ? motionBufferRecordPattern(cam.id)
            : path.join(targetDir, cam.id, '%Y-%m-%d_%H-%M-%S-%f');
          segmentDuration = recordMode === 'motion'
            ? `${BUFFER_SEGMENT_SECONDS}s`
            : `${Math.max(1, cam.recordSegmentMinutes || 15)}m`;
        }

        desiredPaths[cam.id] = {
          source: uri,
          sourceOnDemand: !recordingActive,
          rtspTransport: "tcp",
          record: recordingActive,
          ...(recordingActive ? {
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
      const deletedPaths = [];

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
            deletedPaths.push(clip.fullPath);
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
              deletedPaths.push(clip.fullPath);
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

      if (deletedPaths.length) {
        await prisma.motionRecording.updateMany({
          where: { filePath: { in: deletedPaths } },
          data: { status: 'deleted', filePath: null },
        }).catch(() => undefined);
      }

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
  if (motionDetectionEnabled) {
    console.log(`🎯 Server motion detection enabled (${motionDetectionIntervalMs}ms, concurrency ${motionDetectionConcurrency}, analysis ${motionAnalysisWidth}x${motionAnalysisHeight}).`);
  } else {
    console.log('Server motion detection is disabled.');
  }
  
  // Start ONVIF event listener
  onvifEvents.start();
  motionRecorder.start();

  if (motionDetectionEnabled) {
    monitorTimers.push(setTimeout(() => void runMotionDetection(), 2_500));
    monitorTimers.push(setInterval(() => void runMotionDetection(), motionDetectionIntervalMs));
  }

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
  motionRecorder.stop();
  await objectDetector.stop();
  for (const timer of monitorTimers) clearTimeout(timer);
  monitorTimers.length = 0;
  isMonitoring = false;
  await prisma.$disconnect().catch(() => undefined);
}

module.exports = {
  startMonitor,
  stopMonitor
};
