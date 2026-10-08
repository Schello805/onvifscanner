const { createServer } = require("http");
const next = require("next");

// Force absolute path for Prisma to avoid Next.js bundling path issues
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "file:" + require("path").join(__dirname, "data", "onvifscanner.db");
}

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOST || "0.0.0.0";
const port = parseInt(process.env.PORT || "3000", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
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
