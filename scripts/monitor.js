const { PrismaClient } = require('@prisma/client');
const net = require('net');
const { OnvifEventManager } = require('./onvif-events');
const { MotionRecorder, BUFFER_SEGMENT_SECONDS, motionBufferDirectory, motionBufferRecordPattern } = require('./motion-recorder');
const { sendCameraNotification } = require('./ntfy');
const { ObjectDetector } = require('./object-detector');
const { readLicensePlates } = require('./license-plate-reader');
const { findKnownEntity, touchKnownEntity } = require('./known-entities');
const { matchKnownPersons } = require('./face-recognizer');
const { isMotionScheduleActive } = require('./motion-schedule');
const { effectiveRecordingMode } = require('./recording-policy');
const {
  relevantDetections,
  objectDetectionMessage,
} = require('./object-detection-policy');
const {
  annotateDetectedObjects,
  extractMotionBoundingBox,
  saveSnapshotFile,
  deleteSnapshotFile,
} = require('./image-annotator');
const {
  motionMonitoringRequested,
  requiresServerMotionValidation,
  motionCooldownSeconds,
} = require('./motion-policy');
const { decryptSecret, getInternalWorkerToken } = require('./security');
const { clampCameraSensitivities } = require('./reset-sensitivity');

const prisma = new PrismaClient();
const onvifEvents = new OnvifEventManager(prisma);
const motionRecorder = new MotionRecorder(prisma);
const objectDetector = new ObjectDetector();
const appPort = process.env.PORT || '3000';
const appBaseUrl = `http://127.0.0.1:${appPort}`;
const motionDetectionEnabled = process.env.ENABLE_MOTION_DETECTION !== 'false';
const objectDetectionEnabled = process.env.ENABLE_OBJECT_DETECTION !== 'false';
const motionDetectionIntervalMs = Math.max(2_000, Number(process.env.MOTION_DETECTION_INTERVAL_MS) || 3_000);
const motionDetectionConcurrency = Math.max(1, Math.min(8, Number(process.env.MOTION_DETECTION_CONCURRENCY) || 2));
const motionPixelThreshold = Math.max(8, Math.min(80, Number(process.env.MOTION_PIXEL_THRESHOLD) || 18));
const motionAreaThreshold = Math.max(0.002, Math.min(0.5, Number(process.env.MOTION_AREA_THRESHOLD) || 0.01));
const motionMeanThreshold = Math.max(0.5, Math.min(30, Number(process.env.MOTION_MEAN_THRESHOLD) || 1));
const motionConfirmationFrames = Math.max(1, Math.min(4, Number(process.env.MOTION_CONFIRMATION_FRAMES) || 2));
const motionSourceWidth = Math.max(256, Math.min(1280, Number(process.env.MOTION_SOURCE_WIDTH) || 768));
const motionAnalysisWidth = Math.max(160, Math.min(512, Number(process.env.MOTION_ANALYSIS_WIDTH) || 192));
const motionAnalysisHeight = Math.round(motionAnalysisWidth * 9 / 16);
const autoDiscoveryEnabled = process.env.ENABLE_AUTO_DISCOVERY === 'true';
const monitorIntervalMs = Math.max(30_000, Number(process.env.MONITOR_INTERVAL_MS) || 60_000);
let isMonitoring = false;
let cycleRunning = false;
const motionFrames = new Map();
const motionFailureLogTimes = new Map();
const cameraMotionSessions = new Map();
const cameraMotionConsecutiveErrors = new Map();
let motionDetectionCycleRunning = false;
const monitorTimers = [];
let legacyRecordingModesMigrated = false;
let motionSensitivityDefaultsMigrated = false;
const lastEventCleanupTimes = new Map();

async function pruneOldCameraEvents(prismaClient, cameraId, maxKeep = 500) {
  const now = Date.now();
  const lastRun = lastEventCleanupTimes.get(cameraId) || 0;
  if (now - lastRun < 10 * 60_000) return;
  lastEventCleanupTimes.set(cameraId, now);
  try {
    const oldEvents = await prismaClient.alarmLog.findMany({
      where: { cameraId },
      orderBy: { timestamp: 'desc' },
      skip: maxKeep,
      select: { id: true, imageUrl: true },
    });
    if (oldEvents.length) {
      for (const oldEv of oldEvents) {
        if (oldEv.imageUrl) {
          void deleteSnapshotFile(oldEv.imageUrl);
        }
      }
      await prismaClient.alarmLog.deleteMany({ where: { id: { in: oldEvents.map((event) => event.id) } } });
    }
  } catch (err) {
    console.warn(`[Event Cleanup] Warning for camera ${cameraId}:`, err?.message || err);
  }
}

function selectMainstreamForRecording(streamUris) {
  const streams = (streamUris || []).filter((u) => typeof u === 'string' && /^rtsps?:\/\//i.test(u));
  if (!streams.length) return null;
  const main = streams.find((u) => /main(stream|_|\/)?|101|subtype=0|stream1|profile1|channel=?1|first/i.test(u));
  return main || streams[0];
}

function prioritizeUrisForAnalysis(snapshotUris, streamUris) {
  const snapshots = (snapshotUris || []).filter((u) => typeof u === 'string' && u);
  const streams = (streamUris || []).filter((u) => typeof u === 'string' && u);

  // Substream has top priority for video analysis to save CPU
  const sub = streams.find((u) => /sub(stream|_|\/)?|102|subtype=1|stream2|profile2|channel=?2|second/i.test(u))
    || (streams.length > 1 ? streams[1] : null);
  const main = streams.find((u) => /main(stream|_|\/)?|101|subtype=0|stream1|profile1|channel=?1|first/i.test(u))
    || streams[0];

  const orderedStreams = [sub, main, ...streams].filter(Boolean);
  const uniqueStreams = Array.from(new Set(orderedStreams));
  return [...snapshots, ...uniqueStreams];
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
      if (!settings?.motionSensitivityV4Clamped) {
        await clampCameraSensitivities(prisma);
        await prisma.settings.upsert({
          where: { id: 'default' },
          update: { motionSensitivityV4Clamped: true },
          create: { id: 'default', motionSensitivityV4Clamped: true },
        });
      }
      motionSensitivityDefaultsMigrated = true;
    }
    const cameras = await prisma.camera.findMany({
      include: { status: true, storageTarget: true },
    });
    const cameraChecks = await mapWithConcurrency(cameras, 8, async (cam) => {
      // First try RTSP port, fallback to HTTP port 80 if needed
      let isOnline = await pingCamera(cam.ip, 554);
      if (!isOnline) {
        isOnline = await pingCamera(cam.ip, 80);
      }
      return { cam, isOnline };
    });

    for (const { cam, isOnline } of cameraChecks) {
      const status = cam.status;
      
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
        void sendCameraNotification(
          prisma,
          cam,
          newStatus ? 'Kamera ist wieder online' : 'Kamera ist offline',
          {
            force: true,
            statusNotification: true,
            includeImage: false,
            title: newStatus ? 'ONVIFscanner: Kamera online' : 'ONVIFscanner: Kamera offline',
            priority: newStatus ? 'default' : 'high',
            tags: newStatus ? 'white_check_mark,video_camera' : 'warning,video_camera',
          },
        );
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
        && motionMonitoringRequested(camera)
        && !requiresServerMotionValidation(camera)
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
          { recordEnabled: true },
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

async function fetchMotionEventImage(cam, uris, options = {}) {
  const highRes = Boolean(options.highRes);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), highRes ? 8_000 : 6_000);
  try {
    const size = highRes ? Math.max(1600, Math.min(2560, motionSourceWidth * 2)) : motionSourceWidth;
    const quality = highRes ? 90 : 82;
    const timeoutMs = highRes ? 5_000 : 3_500;
    const response = await fetch(`${appBaseUrl}/api/thumbnail`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-worker': 'true',
        'x-internal-worker-token': getInternalWorkerToken(),
      },
      body: JSON.stringify({
        urls: uris,
        size,
        quality,
        timeoutMs,
        fastAuth: true,
        fresh: highRes,
        preferCaptured: !highRes,
        cameraId: cam.id,
        credentials: cam.username ? { username: cam.username, password: decryptSecret(cam.password) } : undefined,
      }),
      signal: controller.signal,
    });
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || !contentType.toLowerCase().startsWith('image/')) return null;
    return Buffer.from(await response.arrayBuffer());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

let cachedGlobalSettings = null;
let lastSettingsFetchAt = 0;

async function getCachedGlobalSettings() {
  const now = Date.now();
  if (!cachedGlobalSettings || now - lastSettingsFetchAt > 10_000) {
    try {
      cachedGlobalSettings = await prisma.settings.findUnique({ where: { id: 'default' } });
      lastSettingsFetchAt = now;
    } catch {
      // quiet
    }
  }
  return cachedGlobalSettings;
}

async function detectCameraMotion(cam) {
  if (cam.status && !cam.status.isOnline) {
    motionFrames.delete(cam.id);
    return;
  }
  if (!motionMonitoringRequested(cam)) {
    motionFrames.delete(cam.id);
    return;
  }

  const globalSettings = await getCachedGlobalSettings();
  const globalMinAreaPercent = globalSettings?.motionMinAreaPercent != null ? Number(globalSettings.motionMinAreaPercent) : 1.5;
  const cameraMinAreaPercent = cam.motionMinAreaPercent != null ? Number(cam.motionMinAreaPercent) : globalMinAreaPercent;
  const configuredAreaThreshold = Math.max(0.002, Math.min(0.5, cameraMinAreaPercent / 100));

  const globalPixelThreshold = globalSettings?.motionPixelThreshold != null ? Number(globalSettings.motionPixelThreshold) : motionPixelThreshold;

  const ignoreRegions = parseMotionIgnoreRegions(cam.motionIgnoreRegions);
  const maskKey = JSON.stringify(ignoreRegions);

  let snapshotUris = [];
  let streamUris = [];
  try { snapshotUris = JSON.parse(cam.snapshotUris); } catch {}
  try { streamUris = JSON.parse(cam.streamUris); } catch {}
  const uris = prioritizeUrisForAnalysis(snapshotUris, streamUris);
  if (!uris.length) return;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    const response = await fetch(`${appBaseUrl}/api/thumbnail`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-worker': 'true',
        'x-internal-worker-token': getInternalWorkerToken(),
      },
      body: JSON.stringify({
        urls: uris,
        size: motionAnalysisWidth,
        height: motionAnalysisHeight,
        output: 'gray',
        timeoutMs: 2_500,
        fastAuth: true,
        fresh: true,
        cameraId: cam.id,
        credentials: cam.username ? { username: cam.username, password: decryptSecret(cam.password) } : undefined,
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
    if (!response.ok) throw new Error(`Snapshot HTTP ${response.status}`);

    const pixels = Buffer.from(await response.arrayBuffer());
    const info = {
      width: Number(response.headers.get('x-image-width')) || motionAnalysisWidth,
      height: Number(response.headers.get('x-image-height')) || motionAnalysisHeight,
      channels: 1,
    };
    if (pixels.length !== info.width * info.height) {
      throw new Error(`Ungültiges Analysebild (${pixels.length} statt ${info.width * info.height} Bytes)`);
    }

    const previous = motionFrames.get(cam.id);
    if (!previous || previous.pixels.length !== pixels.length || previous.maskKey !== maskKey) {
      const mask = buildActivePixelMask(info.width, info.height, ignoreRegions);
      motionFrames.set(cam.id, { pixels, noiseArea: 0, noiseMean: 0, maskKey, ...mask });
      return;
    }

    let signedDifferenceSum = 0;
    const channels = Math.max(1, info.channels || 1);
    const activePixelCount = previous.activePixelCount ?? Math.floor(pixels.length / channels);
    const isSingleChannel = channels === 1;
    const prevPixels = previous.pixels;
    const activeMask = previous.activeMask;

    for (let index = 0; index < pixels.length; index += channels) {
      const pixelIndex = isSingleChannel ? index : Math.floor(index / channels);
      if (activeMask && !activeMask[pixelIndex]) continue;
      signedDifferenceSum += pixels[index] - prevPixels[index];
    }
    const globalBrightnessShift = activePixelCount > 0 ? signedDifferenceSum / activePixelCount : 0;

    // Reject sudden scene-wide lighting or camera auto-exposure changes
    if (Math.abs(globalBrightnessShift) >= 16) {
      motionFrames.set(cam.id, {
        pixels,
        noiseArea: previous.noiseArea * 0.7 + 0.05,
        noiseMean: previous.noiseMean * 0.7 + 1.0,
        maskKey,
        activeMask: previous.activeMask,
        activePixelCount,
        confirmationCount: 0,
      });
      return;
    }

    let changedPixels = 0;
    let differenceSum = 0;
    const changedPixelMap = new Uint8Array(info.width * info.height);
    const configuredSensitivity = cam.motionScheduleEnabled && isMotionScheduleActive(cam)
      ? cam.motionScheduleSensitivity
      : cam.motionSensitivity;
    const sensitivity = Math.min(90, Math.max(1, Number(configuredSensitivity) || 75));
    const sensitivityFactor = Math.max(0.6, 1.5 - sensitivity / 100);
    const effectivePixelThreshold = Math.max(10, Math.round(globalPixelThreshold * sensitivityFactor));
    for (let index = 0; index < pixels.length; index += channels) {
      const pixelIndex = isSingleChannel ? index : Math.floor(index / channels);
      if (activeMask && !activeMask[pixelIndex]) continue;
      const difference = Math.abs((pixels[index] - prevPixels[index]) - globalBrightnessShift);
      differenceSum += difference;
      if (difference >= effectivePixelThreshold) {
        changedPixels += 1;
        changedPixelMap[pixelIndex] = 1;
      }
    }
    if (activePixelCount === 0) {
      motionFrames.set(cam.id, {
        pixels,
        noiseArea: 0,
        noiseMean: 0,
        maskKey,
        activeMask: previous.activeMask,
        activePixelCount,
        confirmationCount: 0,
      });
      return;
    }
    const changedArea = changedPixels / activePixelCount;
    const meanDifference = differenceSum / activePixelCount;
    const requiredArea = Math.max(
      configuredAreaThreshold * 0.75,
      Math.max(configuredAreaThreshold, previous.noiseArea * 3 + 0.005) * sensitivityFactor
    );
    const requiredMean = Math.max(0.8, Math.max(motionMeanThreshold, previous.noiseMean * 2.5 + 0.5) * sensitivityFactor);
    const movementDetected = changedArea >= requiredArea && meanDifference >= requiredMean;

    const checkedAt = new Date();
    const now = checkedAt.getTime();
    const cooldownSeconds = motionCooldownSeconds(cam);
    const cooldownMs = cooldownSeconds * 1000;
    const existingSession = cameraMotionSessions.get(cam.id);

    if (!movementDetected) {
      if (existingSession && (now - existingSession.lastMotionSeenAt >= cooldownMs)) {
        // Quiet duration has elapsed; conclude and reset motion session
        cameraMotionSessions.delete(cam.id);
      }
      motionFrames.set(cam.id, {
        pixels,
        noiseArea: previous.noiseArea * 0.85 + changedArea * 0.15,
        noiseMean: previous.noiseMean * 0.85 + meanDifference * 0.15,
        maskKey,
        activeMask: previous.activeMask,
        activePixelCount,
        confirmationCount: 0,
      });
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

    const confirmationCount = (previous.confirmationCount || 0) + 1;
    const isDistinctMotion = (changedArea >= requiredArea * 1.3 && meanDifference >= Math.max(1.2, requiredMean * 1.2))
      || (changedArea >= configuredAreaThreshold * 2.5);
    const requiredConfirmations = isDistinctMotion ? 1 : Math.max(2, motionConfirmationFrames);
    if (confirmationCount < requiredConfirmations) {
      motionFrames.set(cam.id, {
        pixels,
        noiseArea: previous.noiseArea,
        noiseMean: previous.noiseMean,
        maskKey,
        activeMask: previous.activeMask,
        activePixelCount,
        confirmationCount,
      });
      return;
    }
    motionFrames.set(cam.id, {
      pixels,
      noiseArea: previous.noiseArea,
      noiseMean: previous.noiseMean,
      maskKey,
      activeMask: previous.activeMask,
      activePixelCount,
      confirmationCount: 0,
    });

    const maxSessionDurationMs = 10 * 60 * 1000;
    if (existingSession) {
      const isWithinCooldown = (now - existingSession.lastMotionSeenAt) < cooldownMs;
      const isWithinMaxSession = (now - existingSession.lastNotifiedAt) < maxSessionDurationMs;
      if (isWithinCooldown && isWithinMaxSession) {
        // Continuous motion within cooldown: extend lastMotionSeenAt, do not spam notifications
        existingSession.lastMotionSeenAt = now;
        motionFrames.set(cam.id, {
          pixels,
          noiseArea: previous.noiseArea * 0.9 + changedArea * 0.1,
          noiseMean: previous.noiseMean * 0.9 + meanDifference * 0.1,
          maskKey,
          activeMask: previous.activeMask,
          activePixelCount,
          confirmationCount: 0,
        });
        return;
      }
    }

    const recentEvent = await prisma.alarmLog.findFirst({
      where: {
        cameraId: cam.id,
        timestamp: { gte: new Date(now - cooldownMs) },
      },
      select: { id: true, timestamp: true },
    });
    if (recentEvent) {
      cameraMotionSessions.set(cam.id, {
        lastNotifiedAt: recentEvent.timestamp ? recentEvent.timestamp.getTime() : now,
        lastMotionSeenAt: now,
      });
      motionFrames.set(cam.id, {
        pixels,
        noiseArea: previous.noiseArea * 0.9 + changedArea * 0.1,
        noiseMean: previous.noiseMean * 0.9 + meanDifference * 0.1,
        maskKey,
        activeMask: previous.activeMask,
        activePixelCount,
        confirmationCount: 0,
      });
      return;
    }

    let eventMessage = 'Bewegung erkannt (Server-Bildanalyse)';
    let detectedObjects = [];
    let recognizedPlates = [];
    let eventImage = null;
    let detectionResult = null;
    if (cam.objectDetectionEnabled || cam.licensePlateRecognitionEnabled) {
      if (!objectDetectionEnabled) {
        const warningKey = `object-disabled:${cam.id}`;
        const lastLogged = motionFailureLogTimes.get(warningKey) || 0;
        if (Date.now() - lastLogged > 60_000) {
          console.warn(`[Object Detection] ${cam.name}: lokale Objekterkennung ist global deaktiviert.`);
          motionFailureLogTimes.set(warningKey, Date.now());
        }
        if (cam.objectDetectionEnabled) return;
      }
    }
    if ((cam.objectDetectionEnabled || cam.licensePlateRecognitionEnabled) && objectDetectionEnabled) {
      try {
        eventImage = await fetchMotionEventImage(cam, uris, { highRes: Boolean(cam.licensePlateRecognitionEnabled) });
        if (!eventImage) throw new Error('Kein Detailbild für die Objekterkennung verfügbar');
        detectionResult = await objectDetector.detect(eventImage, Math.min(0.95, Math.max(0.2, (Number(cam.objectMinConfidence || 50) - 10) / 100)));
        const result = detectionResult;
        const motionEvidence = {
          width: info.width,
          height: info.height,
          changedPixels: changedPixelMap,
        };
        const selectedObjects = cam.objectDetectionEnabled
          ? relevantDetections(result, cam, ignoreRegions, motionEvidence)
          : [];
        const vehicles = cam.licensePlateRecognitionEnabled
          ? relevantDetections(result, cam, ignoreRegions, motionEvidence, { vehicleOnly: true })
          : [];
        if (cam.objectDetectionEnabled && !selectedObjects.length) return;
        detectedObjects = [...selectedObjects];
        for (const vehicle of vehicles) {
          const duplicate = detectedObjects.some((detection) =>
            detection.className === vehicle.className
            && JSON.stringify(detection.bbox) === JSON.stringify(vehicle.bbox)
          );
          if (!duplicate) detectedObjects.push(vehicle);
        }
        if (detectedObjects.length) eventMessage = objectDetectionMessage(detectedObjects);
        const persons = detectedObjects.filter((d) => d.className === 'person');
        if (persons.length) {
          try {
            const matchedPersons = matchKnownPersons(persons, cam.name);
            if (matchedPersons.length) {
              const personLabels = matchedPersons.map((p) => p.name).join(', ');
              eventMessage = `🚶 Bekannte Person: ${personLabels}`;
            }
          } catch {}
        }
        if (vehicles.length) {
          try {
            const plates = await readLicensePlates(eventImage, result, vehicles, ignoreRegions);
            const plateDetails = [];
            for (const entry of plates) {
              const known = findKnownEntity(entry.plate, 'plate')
                || findKnownEntity(entry.plate.replace(/[^A-Z0-9ÄÖÜ]/g, ''), 'plate');
              if (known) {
                touchKnownEntity(known.id, cam.name);
                plateDetails.push({
                  plate: entry.plate,
                  knownName: known.name,
                  category: known.category,
                  confidence: entry.confidence,
                  vehicleBbox: entry.vehicleBbox || null,
                });
              } else {
                plateDetails.push({
                  plate: entry.plate,
                  knownName: null,
                  category: 'unknown',
                  confidence: entry.confidence,
                  vehicleBbox: entry.vehicleBbox || null,
                });
              }
            }
            recognizedPlates = plateDetails;
            if (recognizedPlates.length) {
              const knownFound = recognizedPlates.filter((p) => p.knownName);
              if (knownFound.length) {
                const knownLabels = knownFound.map((p) => `${p.knownName} (${p.plate})`).join(', ');
                eventMessage = `🚗 Bekanntes Fahrzeug: ${knownLabels}`;
              } else {
                eventMessage += ` · Kennzeichen ${recognizedPlates.map((p) => p.plate).join(', ')}`;
              }
            }
          } catch (error) {
            const warningKey = `plate:${cam.id}`;
            const lastLogged = motionFailureLogTimes.get(warningKey) || 0;
            if (Date.now() - lastLogged > 60_000) {
              console.warn(`[Kennzeichen-OCR] ${cam.name}: ${error?.message || error}`);
              motionFailureLogTimes.set(warningKey, Date.now());
            }
          }
        }
      } catch (error) {
        const warningKey = `object:${cam.id}`;
        const lastLogged = motionFailureLogTimes.get(warningKey) || 0;
        if (Date.now() - lastLogged > 60_000) {
          console.warn(`[Object Detection] ${cam.name}: ${error?.message || error}; Ereignis wird wegen aktivem Objektfilter verworfen.`);
          motionFailureLogTimes.set(warningKey, Date.now());
        }
        if (cam.objectDetectionEnabled) return;
        eventMessage = 'Bewegung erkannt (Server-Bildanalyse)';
      }
    }
    if (!eventImage) {
      try {
        eventImage = await fetchMotionEventImage(cam, uris, { highRes: false });
      } catch {
        // quiet
      }
    }

    let finalNotificationImage = eventImage;
    let snapshotUrl = null;
    const alarmId = `alm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    cameraMotionSessions.set(cam.id, {
      lastNotifiedAt: checkedAt.getTime(),
      lastMotionSeenAt: checkedAt.getTime(),
    });

      let motionBbox = null;
      if (eventImage) {
        if (detectedObjects.length) {
          try {
            finalNotificationImage = await annotateDetectedObjects(eventImage, detectedObjects, {
              sourceWidth: detectionResult?.width,
              sourceHeight: detectionResult?.height,
              plates: recognizedPlates,
            });
          } catch (error) {
            console.warn(`[Image Annotator] ${cam.name}: ${error?.message || error}`);
          }
        } else {
          motionBbox = extractMotionBoundingBox(changedPixelMap, info.width, info.height);
          if (motionBbox) {
            try {
              finalNotificationImage = await annotateDetectedObjects(eventImage, [{
                className: 'Bewegung',
                score: null,
                bbox: motionBbox,
              }], {
                sourceWidth: info.width,
                sourceHeight: info.height,
              });
            } catch (error) {
              console.warn(`[Image Annotator] ${cam.name}: ${error?.message || error}`);
            }
          }
        }
      }

      if (finalNotificationImage) {
        try {
          snapshotUrl = await saveSnapshotFile(finalNotificationImage, alarmId);
        } catch {
          // quiet
        }
      }

      await prisma.alarmLog.create({
        data: {
          id: alarmId,
          cameraId: cam.id,
          message: eventMessage,
          timestamp: checkedAt,
          imageUrl: snapshotUrl,
          objectClasses: detectedObjects.length
            ? JSON.stringify(Array.from(new Set(detectedObjects.map((detection) => detection.group))))
            : null,
          objectDetections: detectedObjects.length
            ? JSON.stringify(detectedObjects)
            : (motionBbox ? JSON.stringify([{ className: 'Bewegung', bbox: motionBbox }]) : null),
          licensePlates: recognizedPlates.length ? JSON.stringify(recognizedPlates) : null,
        },
      });
      await sendCameraNotification(
        prisma,
        cam,
        eventMessage,
        finalNotificationImage ? { imageBuffer: finalNotificationImage, contentType: 'image/jpeg' } : {},
      );
      console.log(`[Motion Detection] ${cam.name}: ${eventMessage} (Fläche ${(changedArea * 100).toFixed(1)}% / Min ${(requiredArea * 100).toFixed(1)}%, Differenz ${meanDifference.toFixed(1)}).`);
      void pruneOldCameraEvents(prisma, cam.id);
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
    cameraMotionConsecutiveErrors.delete(cam.id);
  } catch (error) {
    const errorCount = (cameraMotionConsecutiveErrors.get(cam.id) || 0) + 1;
    cameraMotionConsecutiveErrors.set(cam.id, errorCount);
    // Only wipe baseline frame after multiple consecutive errors to tolerate transient network drops
    if (errorCount >= 3) {
      motionFrames.delete(cam.id);
    }
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
       headers: {
         'Content-Type': 'application/json',
         'x-internal-worker': 'true',
         'x-internal-worker-token': getInternalWorkerToken(),
       },
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

function normalizeDurationToSeconds(val) {
  if (!val) return 0;
  if (typeof val === 'number') return val;
  const str = String(val).trim();
  let total = 0;
  const matches = [...str.matchAll(/(\d+(?:\.\d+)?)\s*(h|m|s|ms)/g)];
  if (matches.length > 0) {
    for (const m of matches) {
      const n = parseFloat(m[1]);
      const unit = m[2];
      if (unit === 'h') total += n * 3600;
      else if (unit === 'm') total += n * 60;
      else if (unit === 's') total += n;
      else if (unit === 'ms') total += n / 1000;
    }
    return Math.round(total);
  }
  const n = parseFloat(str);
  return isNaN(n) ? 0 : Math.round(n);
}

function normalizeRecordPath(p) {
  return p ? require('path').resolve(String(p).trim()).replace(/\/+$/, '') : '';
}

async function syncMediaMtxPaths(cameras) {
  try {
    const listRes = await fetch('http://127.0.0.1:9997/v3/config/paths/list');
    if (!listRes.ok) {
      console.warn(`[MediaMTX Sync] MediaMTX API antwortete mit HTTP ${listRes.status}`);
      return;
    }
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
        let uri = selectMainstreamForRecording(uris);
        if (!uri) continue;
        if (cam.username) {
           try {
              let parsed = new URL(uri);
              parsed.username = cam.username;
              const decrypted = decryptSecret(cam.password);
              if (decrypted) parsed.password = decrypted;
              uri = parsed.toString();
           } catch(e) {}
        }

        const recordMode = effectiveRecordingMode(cam);
        const recordingActive = recordMode !== 'off';
        let recordPath = null;
        let segmentDuration = "15m";
        if (recordingActive) {
          const fs = require('fs');
          const path = require('path');
          let targetDir = defaultStoragePath;
          if (cam.storageTarget && cam.storageTarget.enabled) {
            targetDir = cam.storageTarget.path;
          } else if (cam.storageTargetId) {
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

    const activeRecorders = Object.values(desiredPaths).filter((p) => p.record).length;
    console.log(`[MediaMTX Sync] ${Object.keys(desiredPaths).length} Kameras synchronisiert (${activeRecorders} mit aktiver Aufnahme).`);

    for (const [id, config] of Object.entries(desiredPaths)) {
      const existing = currentPaths.find(p => p.name === id);
      if (!existing) {
        const addRes = await fetch(`http://127.0.0.1:9997/v3/config/paths/add/${encodeURIComponent(id)}`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(config)
        }).catch((err) => ({ ok: false, error: err }));
        if (!addRes.ok) {
          const text = addRes.text ? await addRes.text().catch(() => "") : String(addRes.error);
          console.warn(`[MediaMTX Sync] Fehler beim Hinzufügen von Pfad "${id}" in MediaMTX: ${text}`);
        } else {
          console.log(`[MediaMTX Sync] Pfad "${id}" in MediaMTX angelegt (Aufnahme=${Boolean(config.record)}).`);
        }
      } else {
        const segDurChanged = config.record && (
          normalizeDurationToSeconds(existing.recordSegmentDuration) !== normalizeDurationToSeconds(config.recordSegmentDuration)
        );
        const recPathChanged = config.record && (
          normalizeRecordPath(existing.recordPath) !== normalizeRecordPath(config.recordPath)
        );
        const needsPatch = (
          existing.source !== config.source ||
          Boolean(existing.record) !== Boolean(config.record) ||
          Boolean(existing.sourceOnDemand) !== Boolean(config.sourceOnDemand) ||
          (config.rtspTransport && existing.rtspTransport !== config.rtspTransport) ||
          recPathChanged ||
          segDurChanged
        );

        if (needsPatch) {
          console.log(`[MediaMTX Sync] Pfad ${id} wird aktualisiert (Aufnahme=${Boolean(config.record)}, Segment=${config.recordSegmentDuration}).`);
          const patchRes = await fetch(`http://127.0.0.1:9997/v3/config/paths/patch/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(config)
          }).catch((err) => ({ ok: false, error: err }));
          if (!patchRes.ok) {
            const text = patchRes.text ? await patchRes.text().catch(() => "") : String(patchRes.error);
            console.warn(`[MediaMTX Sync] Fehler beim Aktualisieren von Pfad "${id}": ${text}`);
          }
        }
      }
    }
    
    for (const p of currentPaths) {
       // Never delete MediaMTX internal default paths
       if (p.name === 'all_others' || p.name === '~^.*$') continue;

       // Never delete active WebRTC live / sub stream paths for existing cameras
       if (p.name.endsWith('_live') || p.name.endsWith('_sub')) {
          const baseId = p.name.replace(/_(live|sub)$/, '');
          const cameraExists = cameras.some(c => c.id === baseId);
          if (cameraExists) continue;
       }

       if (!desiredPaths[p.name]) {
          await fetch(`http://127.0.0.1:9997/v3/config/paths/delete/${encodeURIComponent(p.name)}`, { method: 'DELETE' }).catch(()=>null);
       }
    }
  } catch (e) {
    console.warn(`[MediaMTX Sync] MediaMTX API (127.0.0.1:9997) nicht erreichbar:`, e?.message || e);
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
          // CRITICAL SAFEGUARD: Never delete clips younger than 48 hours under emergency free space!
          // Deleting today's/yesterday's fresh footage when the OS or partition is tight causes catastrophic loss of recent evidence.
          const emergencyProtectCutoff = now - 48 * 3600 * 1000;
          for (const clip of remainingClips) {
            if (currentFreeBytes >= minFreeBytes) break;
            if (clip.mtimeMs >= emergencyProtectCutoff) {
              console.warn(`[Retention] Target "${target.name}": Speicherplatz knapp (${(currentFreeBytes / 1e9).toFixed(2)} GB frei, Min: ${target.minFreeSpaceGb} GB). Verbleibende Aufnahmen der letzten 48 Stunden werden geschützt.`);
              break;
            }
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

      // 3. Clean empty subdirectories recursively (preserving camera root folders)
      const cleanEmptyDirs = async (dir, depth = 0) => {
        try {
          const entries = await fsp.readdir(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory()) {
              await cleanEmptyDirs(path.join(dir, entry.name), depth + 1);
            }
          }
          // Do NOT remove target.path itself, and do NOT remove direct camera subdirectories (depth === 1)
          if (dir !== target.path && depth > 1) {
            const rem = await fsp.readdir(dir);
            if (rem.length === 0) await fsp.rmdir(dir);
          }
        } catch {}
      };
      await cleanEmptyDirs(target.path, 0);

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
