const { PrismaClient } = require('@prisma/client');
const net = require('net');

const prisma = new PrismaClient();
let isMonitoring = false;

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
  } catch (e) {
    console.error("Monitor Cycle Error:", e);
  }
}

async function syncMediaMtxPaths(cameras) {
  try {
    const listRes = await fetch('http://127.0.0.1:9997/v3/config/paths/list');
    if (!listRes.ok) return;
    const currentPaths = (await listRes.json()).items || [];
    
    const desiredPaths = {};
    for (const cam of cameras) {
      let uris = [];
      try { uris = JSON.parse(cam.streamUris); } catch(e) {}
      
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
  setInterval(runMonitorCycle, 60000);
}

module.exports = {
  startMonitor
};
