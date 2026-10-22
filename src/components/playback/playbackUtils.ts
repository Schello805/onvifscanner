import type { RecordingClip, MotionEvent, ClipMotionEvent } from "./playbackTypes";
import { recordingStart } from "./playbackTiming";

export function formatGermanDate(isoOrDateStr: string): string {
  if (!isoOrDateStr) return "";
  const m = isoOrDateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    return `${m[3]}.${m[2]}.${m[1]}`;
  }
  return isoOrDateStr;
}

export function formatGermanDateLong(isoOrDateStr: string): string {
  if (!isoOrDateStr) return "";
  const m = isoOrDateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const weekday = d.toLocaleDateString("de-DE", { weekday: "short" });
    return `${weekday}, ${m[3]}.${m[2]}.${m[1]}`;
  }
  return isoOrDateStr;
}

export function formatMinutesToTime(min: number): string {
  const normalized = Math.max(0, Math.min(1440, min));
  const h = Math.floor(normalized / 60) % 24;
  const m = Math.floor(normalized % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} Uhr`;
}

export function parseTimeToSeconds(timeStr: string): number {
  if (!timeStr) return 0;
  const parts = timeStr.split(":").map(Number);
  const h = isNaN(parts[0]) ? 0 : parts[0];
  const m = isNaN(parts[1]) ? 0 : parts[1];
  const s = isNaN(parts[2]) ? 0 : parts[2];
  return h * 3600 + m * 60 + s;
}

export function formatSeconds(totalSec: number): string {
  if (isNaN(totalSec) || totalSec < 0) return "0:00";
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function getMotionEventsForClip(
  clip: RecordingClip,
  events: MotionEvent[],
  videoDuration = 0,
  fallbackDurationSec = 900
): ClipMotionEvent[] {
  if (!clip || !events || events.length === 0) return [];
  const clipStartSec = parseTimeToSeconds(clip.timeStr);

  const maxDuration = videoDuration > 0 ? videoDuration : clip.durationSeconds || fallbackDurationSec;

  const matched: ClipMotionEvent[] = [];
  const seenSeconds = new Set<number>();

  for (const ev of events) {
    if (ev.clipId && ev.clipId !== clip.id) continue;
    if (ev.cameraId && clip.cameraId && ev.cameraId !== clip.cameraId) {
      continue;
    }
    const eventTimestamp = Date.parse(ev.timestamp);
    const hasTimestamp = Number.isFinite(eventTimestamp) && Number.isFinite(Date.parse(clip.timestamp));
    if (!hasTimestamp && clip.dateStr && ev.dateStr && clip.dateStr !== ev.dateStr) {
      continue;
    }

    const evSec = parseTimeToSeconds(ev.timeStr);
    let offset = hasTimestamp ? eventTimestamp / 1000 - recordingStart(clip) : evSec - clipStartSec;

    // Tageswechsel-Kompensation (um Mitternacht)
    if (!hasTimestamp) {
      if (offset < -43200) offset += 86400;
      if (offset > 43200) offset -= 86400;
    }

    // Toleranzbereich: Bis zu 2s vor Segmentstart oder 3s nach Segmentende
    if (offset >= -2 && offset <= maxDuration + 3) {
      const clampedOffset = Math.max(0, Math.min(maxDuration, offset));
      const roundedOffset = Math.round(clampedOffset);

      // Duplikate innerhalb von 2 Sekunden zusammenfassen
      let isDuplicate = false;
      for (const s of seenSeconds) {
        if (Math.abs(s - roundedOffset) <= 2) {
          isDuplicate = true;
          break;
        }
      }
      if (isDuplicate) continue;

      seenSeconds.add(roundedOffset);
      const pct = maxDuration > 0 ? (clampedOffset / maxDuration) * 100 : 0;
      matched.push({
        id: ev.id,
        timeStr: ev.timeStr,
        offsetSec: clampedOffset,
        message: ev.message,
        pct,
      });
    }
  }

  matched.sort((a, b) => a.offsetSec - b.offsetSec);
  return matched;
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(2)} GB`;
  }
  return `${mb.toFixed(1)} MB`;
}

export function getTodayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function shiftMonth(month: string, offset: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const shifted = new Date(year, monthNumber - 1 + offset, 1);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}`;
}

export function formatMonth(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(year, monthNumber - 1, 1).toLocaleDateString("de-DE", {
    month: "long",
    year: "numeric",
  });
}
