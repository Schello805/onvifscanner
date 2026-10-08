import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import process from "node:process";

const APP_DIR = process.env.APP_DIR ?? "/opt/onvifscanner";
const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? "3000");

function notify(...args) {
  if (!process.env.NOTIFY_SOCKET) return false;
  const result = spawnSync("/usr/bin/systemd-notify", args, {
    env: process.env,
    stdio: "ignore"
  });
  return result.status === 0;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForHealth(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  const url = `http://127.0.0.1:${PORT}/api/health`;
  for (;;) {
    if (Date.now() > deadline) throw new Error("Health check timeout");
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(
          url,
          { timeout: 2000, headers: { accept: "application/json" } },
          (res) => {
            res.resume();
            if ((res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300) resolve();
            else reject(new Error(`HTTP ${res.statusCode ?? 0}`));
          }
        );
        req.on("timeout", () => req.destroy(new Error("timeout")));
        req.on("error", reject);
      });
      return;
    } catch {
      await sleep(400);
    }
  }
}

async function healthIsAvailable() {
  try {
    await waitForHealth(2_500);
    return true;
  } catch {
    return false;
  }
}

const child = spawn(
  "/usr/bin/node",
  ["server.js"],
  {
    cwd: APP_DIR,
    env: process.env,
    stdio: "inherit"
  }
);

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  notify(`--status=Stopping (${signal})`, "STOPPING=1");
  try {
    child.kill("SIGTERM");
  } catch {
    // ignore
  }
  setTimeout(() => {
    try {
      child.kill("SIGKILL");
    } catch {
      // ignore
    }
  }, 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// systemd watchdog interval in microseconds.
const watchdogUsec = Number(process.env.WATCHDOG_USEC ?? "0");
const watchdogMs = Number.isFinite(watchdogUsec) && watchdogUsec > 0 ? Math.floor(watchdogUsec / 1000) : 0;

try {
  await waitForHealth(60_000);
  notify("--ready", "--status=Running");
} catch (error) {
  notify(`--status=Startup health check failed: ${error instanceof Error ? error.message : "unknown error"}`);
  child.kill("SIGTERM");
  process.exitCode = 1;
}

if (watchdogMs > 0) {
  const interval = Math.max(5_000, Math.floor(watchdogMs / 2));
  let healthCheckRunning = false;
  setInterval(async () => {
    if (healthCheckRunning || shuttingDown) return;
    healthCheckRunning = true;
    const healthy = await healthIsAvailable();
    if (healthy) notify("--status=Running", "WATCHDOG=1");
    else notify("--status=Health check failed; waiting for systemd restart");
    healthCheckRunning = false;
  }, interval).unref();
}

child.on("exit", (code, signal) => {
  if (!shuttingDown) notify(`--status=Exited (${signal ?? code ?? 0})`);
  process.exitCode = shuttingDown ? 0 : (code || 1);
});
