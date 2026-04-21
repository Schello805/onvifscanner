import { spawn } from "node:child_process";
import dgram from "node:dgram";
import http from "node:http";
import process from "node:process";

const APP_DIR = process.env.APP_DIR ?? "/opt/onvifscanner";
const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? "3000");

function getNotifySocket() {
  const raw = process.env.NOTIFY_SOCKET;
  if (!raw) return null;
  // Abstract namespace is passed as "@name" (systemd) but must be "\0name" for Node.
  if (raw.startsWith("@")) return `\0${raw.slice(1)}`;
  return raw;
}

function notify(message) {
  const sockPath = getNotifySocket();
  if (!sockPath) return;
  try {
    const client = dgram.createSocket("unix_dgram");
    client.send(Buffer.from(message), sockPath, () => {
      try {
        client.close();
      } catch {
        // ignore
      }
    });
  } catch {
    // ignore
  }
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

const child = spawn(
  "/usr/bin/node",
  ["node_modules/next/dist/bin/next", "start", "-H", HOST, "-p", String(PORT)],
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
  try {
    notify(`STOPPING=1\nSTATUS=Stopping (${signal})\n`);
  } catch {
    // ignore
  }
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
  notify("READY=1\nSTATUS=Running\n");
} catch {
  // Still signal ready to avoid systemd killing the service in a loop.
  notify("READY=1\nSTATUS=Running (health not confirmed)\n");
}

if (watchdogMs > 0) {
  const interval = Math.max(5_000, Math.floor(watchdogMs / 2));
  setInterval(() => {
    notify("WATCHDOG=1\n");
  }, interval).unref();
}

child.on("exit", (code, signal) => {
  if (!shuttingDown) notify(`STATUS=Exited (${signal ?? code ?? 0})\n`);
  process.exitCode = code ?? (signal ? 1 : 0);
});

