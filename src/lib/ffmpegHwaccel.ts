import fs from "fs";
import os from "os";

export function getFfmpegHwaccelArgs(): string[] {
  const configured = (process.env.FFMPEG_HWACCEL || "").trim().toLowerCase();

  if (configured === "off" || configured === "cpu" || configured === "none") {
    return [];
  }
  if (configured === "vaapi") {
    const dev = fs.existsSync("/dev/dri/renderD128") ? ["-hwaccel_device", "/dev/dri/renderD128"] : [];
    return ["-hwaccel", "vaapi", ...dev];
  }
  if (configured === "qsv") {
    return ["-hwaccel", "qsv"];
  }
  if (configured === "cuda" || configured === "nvdec") {
    return ["-hwaccel", "cuda"];
  }
  if (configured === "videotoolbox") {
    return ["-hwaccel", "videotoolbox"];
  }

  // Auto-detection
  if (process.platform === "darwin") {
    return ["-hwaccel", "videotoolbox"];
  }

  if (process.platform === "linux" && fs.existsSync("/dev/dri/renderD128")) {
    return ["-hwaccel", "vaapi", "-hwaccel_device", "/dev/dri/renderD128"];
  }

  return [];
}
