// Zeitzone global auf Berlin festlegen (auch für Kindprozesse wie MediaMTX/ffmpeg)
process.env.TZ = "Europe/Berlin";

const { createServer } = require("http");
const next = require("next");

// Force absolute path for Prisma to avoid Next.js bundling path issues
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "file:" + require("path").join(__dirname, "data", "onvifscanner.db");
}

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const {
  SESSION_COOKIE_NAME,
  isAppAuthEnabled,
  parseCookies,
  verifySessionToken,
} = require("./scripts/security");

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOST || "0.0.0.0";
const port = parseInt(process.env.PORT || "3000", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

function isLoopbackAddress(addr) {
  if (!addr) return false;
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

app.prepare().then(async () => {
  // Zeitzone aus Einstellungen laden & Kamerasensitivität auf sichere Werte prüfen
  try {
    const { PrismaClient } = require("@prisma/client");
    const { clampCameraSensitivities } = require("./scripts/reset-sensitivity");
    const prisma = new PrismaClient();
    const settings = await prisma.settings.findUnique({ where: { id: "default" } });
    if (settings?.timezone) {
      process.env.TZ = settings.timezone;
    }
    await clampCameraSensitivities(prisma);
    await prisma.$disconnect();
  } catch {}

  let mediaMtx = null;
  let mediaRestartTimer = null;
  let monitorController = null;
  let shuttingDown = false;

  const startMediaMtx = () => {
    if (shuttingDown || mediaMtx) return;
    const mediamtxPath = path.join(__dirname, "mediamtx");
    if (!fs.existsSync(mediamtxPath)) return;

    console.log("🚀 Starting MediaMTX...");
    const configPath = path.join(__dirname, "mediamtx.yml");
    mediaMtx = spawn(mediamtxPath, fs.existsSync(configPath) ? [configPath] : [], {
      cwd: __dirname,
      stdio: "inherit"
    });
    mediaMtx.on("error", (err) => console.error("Failed to start MediaMTX:", err));
    mediaMtx.on("exit", (code, signal) => {
      console.log(`MediaMTX exited (${signal ?? code ?? 0})`);
      mediaMtx = null;
      if (!shuttingDown) {
        mediaRestartTimer = setTimeout(startMediaMtx, 2_000);
      }
    });
  };

  const server = createServer(async (req, res) => {
    try {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("X-Frame-Options", "SAMEORIGIN");
      res.setHeader("Referrer-Policy", "same-origin");

      const rawUrl = req.url || "/";
      const pathname = rawUrl.split("?")[0];
      const method = (req.method || "GET").toUpperCase();

      // 1. CSRF Origin Verification for mutating API requests from browsers
      if (
        pathname.startsWith("/api/") &&
        !pathname.startsWith("/api/events/") &&
        ["POST", "PUT", "PATCH", "DELETE"].includes(method)
      ) {
        const origin = req.headers.origin;
        const expectedHost = (req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
        if (origin && expectedHost) {
          try {
            const originHost = new URL(origin).host;
            if (originHost !== expectedHost) {
              res.statusCode = 403;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "CSRF Origin mismatch." }));
              return;
            }
          } catch {
            res.statusCode = 403;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Invalid Origin header." }));
            return;
          }
        }
      }

      // 2. API Authentication Gate when App Password/PIN is enabled
      if (
        pathname.startsWith("/api/") &&
        !pathname.startsWith("/api/auth/") &&
        !pathname.startsWith("/api/health") &&
        !pathname.startsWith("/api/events/") &&
        isAppAuthEnabled()
      ) {
        const isInternalWorkerCall =
          isLoopbackAddress(req.socket?.remoteAddress) &&
          !req.headers.origin &&
          (
            req.headers["x-internal-worker"] === "true" ||
            req.headers["user-agent"] === "node" ||
            !req.headers["sec-ch-ua"]
          );

        if (!isInternalWorkerCall) {
          const cookies = parseCookies(req.headers.cookie);
          const valid = verifySessionToken(cookies[SESSION_COOKIE_NAME]);
          if (!valid) {
            res.statusCode = 401;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Authentifizierung erforderlich." }));
            return;
          }
        }
      }

      await handle(req, res);
    } catch (err) {
      console.error("Error occurred handling", req.url, err);
      res.statusCode = 500;
      res.end("internal server error");
    }
  });

  server
    .once("error", (err) => {
      console.error(err);
      process.exit(1);
    })
    .listen(port, hostname, () => {
      console.log(`> Ready on http://${hostname}:${port}`);
      
      startMediaMtx();

      // Start Background Services
      try {
        monitorController = require("./scripts/monitor.js");
        monitorController.startMonitor();
      } catch (err) {
        console.error("Failed to start background monitor:", err);
      }
    });

  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Shutting down (${signal})...`);
    if (mediaRestartTimer) clearTimeout(mediaRestartTimer);
    if (mediaMtx && !mediaMtx.killed) mediaMtx.kill("SIGTERM");
    Promise.resolve(monitorController?.stopMonitor?.()).finally(() => {
      server.close(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
});
