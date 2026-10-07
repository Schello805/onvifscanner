const { createServer } = require("http");
const { parse } = require("url");
const next = require("next");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOST || "0.0.0.0";
const port = parseInt(process.env.PORT || "3000", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error("Error occurred handling", req.url, err);
      res.statusCode = 500;
      res.end("internal server error");
    }
  })
    .once("error", (err) => {
      console.error(err);
      process.exit(1);
    })
    .listen(port, () => {
      console.log(`> Ready on http://${hostname}:${port}`);
      
      // Start MediaMTX if it exists
      const mediamtxPath = path.join(__dirname, "mediamtx");
      if (fs.existsSync(mediamtxPath)) {
        console.log("🚀 Starting MediaMTX...");
        const mtx = spawn(mediamtxPath, [], { stdio: "ignore" });
        mtx.on("error", (err) => console.error("Failed to start MediaMTX:", err));
        mtx.on("exit", (code) => console.log("MediaMTX exited with code", code));
      }

      // Start Background Services
      try {
        const monitor = require("./scripts/monitor.js");
        monitor.startMonitor();
      } catch (err) {
        console.error("Failed to start background monitor:", err);
      }
    });
});
