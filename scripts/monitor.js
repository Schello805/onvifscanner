const { PrismaClient } = require('@prisma/client');
const net = require('net');
const { Jimp } = require('jimp');

const prisma = new PrismaClient();
let isMonitoring = false;
let lastFrames = {};

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
  try {
    const cameras = await prisma.camera.findMany();
    for (const cam of cameras) {
      // First try RTSP port, fallback to HTTP port 80 if needed
      let isOnline = await pingCamera(cam.ip, 554);
      if (!isOnline) {
        isOnline = await pingCamera(cam.ip, 80);
      }
      
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

    // Phase 4: Motion Detection
    await runMotionDetection(cameras);
  } catch (e) {
    console.error("Monitor Cycle Error:", e);
  }
}

async function runMotionDetection(cameras) {
  for (const cam of cameras) {
     const status = await prisma.deviceStatus.findUnique({ where: { cameraId: cam.id } });
     if (!status || !status.isOnline) continue;
     
     let uris = [];
     try { uris = JSON.parse(cam.snapshotUris).concat(JSON.parse(cam.streamUris)); } catch(e) {}
     if (!uris.length) continue;
     
     try {
       // Wir nutzen unsere interne Thumbnail-API für einen zuverlässigen Snapshot
       const res = await fetch('http://127.0.0.1:3000/api/thumbnail', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({
           urls: uris,
           size: 256, // small image is enough for motion
           timeoutMs: 3000,
           fastAuth: true,
           credentials: cam.username ? { username: cam.username, password: cam.password } : undefined
         })
       });
       
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
                  message: "Bewegung erkannt",
                  // Wir könnten das Bild als base64 speichern, aber um die DB klein zu halten, 
                  // speichern wir nur das event (oder ein mini base64)
                  imageUrl: `data:image/jpeg;base64,${Buffer.from(buffer).toString('base64')}`
               }
            });
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
     const res = await fetch('http://127.0.0.1:3000/api/scan', {
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
        // ignore if already in our wall
        if (existingIds.has(dev.id) || existingIps.has(dev.ip)) continue;
        
        await prisma.discoveredDevice.upsert({
           where: { id: dev.id },
           update: {
              ip: dev.ip,
              name: dev.deviceInformation?.model || "Unbekannte Kamera",
              snapshotUris: JSON.stringify(dev.snapshotUris?.map(u => u.uri) || []),
              streamUris: JSON.stringify(dev.rtspUris?.map(u => u.uri) || [])
           },
           create: {
              id: dev.id,
              ip: dev.ip,
              name: dev.deviceInformation?.model || "Unbekannte Kamera",
              snapshotUris: JSON.stringify(dev.snapshotUris?.map(u => u.uri) || []),
              streamUris: JSON.stringify(dev.rtspUris?.map(u => u.uri) || [])
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
    
    const desiredPaths = {};
    for (const cam of cameras) {
      let uris = Array.isArray(cam.streamUris) ? cam.streamUris : [];
      if (!Array.isArray(cam.streamUris) && typeof cam.streamUris === 'string') {
        try { uris = JSON.parse(cam.streamUris); } catch(e) {}
      }
      
      if (uris && uris.length > 0) {
        let uri = uris[0];
        if (cam.username) {
           try {
              let parsed = new URL(uri);
              parsed.username = encodeURIComponent(cam.username);
              parsed.password = encodeURIComponent(cam.password || "");
              uri = parsed.toString();
           } catch(e) {}
        }
        desiredPaths[cam.id] = uri;
      }
    }

    for (const [id, source] of Object.entries(desiredPaths)) {
      const existing = currentPaths.find(p => p.name === id);
      if (!existing) {
        await fetch(`http://127.0.0.1:9997/v3/config/paths/add/${id}`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ source, sourceOnDemand: true })
        }).catch(()=>null);
      } else if (existing.source !== source) {
        await fetch(`http://127.0.0.1:9997/v3/config/paths/patch/${id}`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ source, sourceOnDemand: true })
        }).catch(()=>null);
      }
    }
    
    for (const p of currentPaths) {
       if (p.name !== 'all_others' && p.name !== '~^.*$' && !desiredPaths[p.name]) {
          await fetch(`http://127.0.0.1:9997/v3/config/paths/remove/${p.name}`, { method: 'POST' }).catch(()=>null);
       }
    }
  } catch (e) {
    // Ignore if MediaMTX is not running
  }
}

function startMonitor() {
  if (isMonitoring) return;
  isMonitoring = true;
  
  console.log("🚀 Starting background liveness monitor...");
  
  // Run immediately, then every 60 seconds
  runMonitorCycle();
  setInterval(runMonitorCycle, 30000); // 30s instead of 60s for faster motion detection (can be tweaked)
  
  // Run Auto-Discovery every 4 hours
  setInterval(runAutoDiscovery, 4 * 60 * 60 * 1000);
  // and run it once 15 seconds after start
  setTimeout(runAutoDiscovery, 15000);
}

module.exports = {
  startMonitor
};
