import os from "node:os";
import fs from "node:fs/promises";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CpuSample = { idle: number; total: number };

let previousCpuSample: CpuSample | null = null;

function readCpuSample(): CpuSample {
  return os.cpus().reduce(
    (sample, cpu) => {
      const total = Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
      return { idle: sample.idle + cpu.times.idle, total: sample.total + total };
    },
    { idle: 0, total: 0 }
  );
}

async function readAvailableMemory(): Promise<number> {
  if (process.platform === "linux") {
    try {
      const meminfo = await fs.readFile("/proc/meminfo", "utf8");
      const match = /^MemAvailable:\s+(\d+)\s+kB$/m.exec(meminfo);
      if (match) return Number(match[1]) * 1024;
    } catch {
      // Fall back to the cross-platform value below.
    }
  }
  return os.freemem();
}

export async function GET() {
  let current = readCpuSample();
  if (!previousCpuSample) {
    previousCpuSample = current;
    await new Promise((resolve) => setTimeout(resolve, 120));
    current = readCpuSample();
  }

  const idleDelta = current.idle - previousCpuSample.idle;
  const totalDelta = current.total - previousCpuSample.total;
  previousCpuSample = current;
  const cpuPercent = totalDelta > 0
    ? Math.min(100, Math.max(0, Math.round((1 - idleDelta / totalDelta) * 100)))
    : 0;

  const totalMemory = os.totalmem();
  const availableMemory = await readAvailableMemory();
  const ramPercent = totalMemory > 0
    ? Math.min(100, Math.max(0, Math.round(((totalMemory - availableMemory) / totalMemory) * 100)))
    : 0;

  return Response.json(
    { cpuPercent, ramPercent },
    { headers: { "cache-control": "no-store" } }
  );
}
