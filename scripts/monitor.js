const { PrismaClient } = require('@prisma/client');
const net = require('net');
const { OnvifEventManager } = require('./onvif-events');
const { MotionRecorder, BUFFER_SEGMENT_SECONDS, motionBufferDirectory, motionBufferRecordPattern } = require('./motion-recorder');
const { sendCameraNotification } = require('./ntfy');
const { ObjectDetector } = require('./object-detector');
const { readLicensePlates } = require('./license-plate-reader');
const { findKnownEntity, touchKnownEntity } = require('./known-entities');
const { isMotionScheduleActive } = require('./motion-schedule');
const { effectiveRecordingMode } = require('./recording-policy');
const {
  relevantDetections,
  objectDetectionMessage,
} = require('./object-detection-policy');
const {
  motionMonitoringRequested,
  requiresServerMotionValidation,
  motionCooldownSeconds,
} = require('./motion-policy');
const { decryptSecret } = require('./security');

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
let motionDetectionCycleRunning = false;
const monitorTimers = [];
let legacyRecordingModesMigrated = false;
let motionSensitivityDefaultsMigrated = false;

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

async function fetchMotionEventImage(cam, uris) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6_000);
  try {
    const response = await fetch(`${appBaseUrl}/api/thumbnail`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-worker': 'true' },
      body: JSON.stringify({
        urls: uris,
        size: motionSourceWidth,
        quality: 82,
        timeoutMs: 3_500,
        fastAuth: true,
        fresh: true,
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

async function detectCameraMotion(cam) {
  if (cam.status && !cam.status.isOnline) {
    motionFrames.delete(cam.id);
    return;
  }
  if (!motionMonitoringRequested(cam)) {
    motionFrames.delete(cam.id);
    return;
  }

  const ignoreRegions = parseMotionIgnoreRegions(cam.motionIgnoreRegions);
  const maskKey = JSON.stringify(ignoreRegions);

  const onvifEventIsHealthy = cam.motionEventSource === 'onvif'
    && cam.motionEventState === 'active'
    && cam.motionEventCheckedAt
    && Date.now() - cam.motionEventCheckedAt.getTime() < 90_000;
  if (onvifEventIsHealthy && ignoreRegions.length === 0 && !cam.objectDetectionEnabled && !cam.licensePlateRecognitionEnabled) {
    motionFrames.delete(cam.id);
    return;
  }

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
      headers: { 'Content-Type': 'application/json', 'x-internal-worker': 'true' },
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
    for (let index = 0; index < pixels.length; index += channels) {
      const pixelIndex = Math.floor(index / channels);
      if (previous.activeMask && !previous.activeMask[pixelIndex]) continue;
      signedDifferenceSum += pixels[index] - previous.pixels[index];
    }
    const globalBrightnessShift = activePixelCount > 0 ? signedDifferenceSum / activePixelCount : 0;
    let changedPixels = 0;
    let differenceSum = 0;
    const changedPixelMap = new Uint8Array(info.width * info.height);
    const configuredSensitivity = cam.motionScheduleEnabled && isMotionScheduleActive(cam)
      ? cam.motionScheduleSensitivity
      : cam.motionSensitivity;
    const sensitivity = Math.min(100, Math.max(1, Number(configuredSensitivity) || 80));
    const sensitivityFactor = 1.5 - sensitivity / 100;
    const effectivePixelThreshold = Math.max(8, Math.round(motionPixelThreshold * sensitivityFactor));
    for (let index = 0; index < pixels.length; index += channels) {
      const pixelIndex = Math.floor(index / channels);
      if (previous.activeMask && !previous.activeMask[pixelIndex]) continue;
      const difference = Math.abs((pixels[index] - previous.pixels[index]) - globalBrightnessShift);
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
    const requiredArea = Math.max(motionAreaThreshold, previous.noiseArea * 3 + 0.004) * sensitivityFactor;
    const requiredMean = Math.max(motionMeanThreshold, previous.noiseMean * 2.5 + 0.4) * sensitivityFactor;
    const movementDetected = changedArea >= requiredArea && meanDifference >= requiredMean;

    const checkedAt = new Date();
    if (!movementDetected) {
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
    if (confirmationCount < motionConfirmationFrames) {
      motionFrames.set(cam.id, {
        ...previous,
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

    let eventMessage = 'Bewegung erkannt (Server-Bildanalyse)';
    let detectedObjects = [];
    let recognizedPlates = [];
    let eventImage = null;
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
        eventImage = await fetchMotionEventImage(cam, uris);
        if (!eventImage) throw new Error('Kein Detailbild für die Objekterkennung verfügbar');
        const result = await objectDetector.detect(eventImage, Math.min(0.95, Math.max(0.2, Number(cam.objectMinConfidence || 55) / 100)));
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
        if (vehicles.length) {
          try {
            const plates = await readLicensePlates(eventImage, result, vehicles, ignoreRegions);
            const plateDetails = [];
            for (const entry of plates) {
              const known = findKnownEntity(entry.plate, 'plate');
              if (known) {
                touchKnownEntity(known.id, cam.name);
                plateDetails.push({
                  plate: entry.plate,
                  knownName: known.name,
                  category: known.category,
                  confidence: entry.confidence,
                });
              } else {
                plateDetails.push({
                  plate: entry.plate,
                  knownName: null,
                  category: 'unknown',
                  confidence: entry.confidence,
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
          const fallback = cam.objectDetectionEnabled
            ? 'Ereignis wird wegen aktivem Objektfilter verworfen.'
            : 'Rohbewegung wird ohne Kennzeichenauswertung verwendet.';
          console.warn(`[Object Detection] ${cam.name}: ${error?.message || error}; ${fallback}`);
          motionFailureLogTimes.set(warningKey, Date.now());
        }
        if (cam.objectDetectionEnabled) return;
      }
    }

    const cooldownSeconds = motionCooldownSeconds(cam);
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
          licensePlates: recognizedPlates.length ? JSON.stringify(recognizedPlates) : null,
        },
      });
      await sendCameraNotification(
        prisma,
        cam,
        eventMessage,
        eventImage ? { imageBuffer: eventImage, contentType: 'image/jpeg' } : {},
      );
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
    motionFrames.delete(cam.id);
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
       headers: { 'Content-Type': 'application/json', 'x-internal-worker': 'true' },
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
              parsed.password = decryptSecret(cam.password);
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
