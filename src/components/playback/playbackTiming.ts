import type { RecordingClip } from "./playbackTypes";

export function recordingStart(clip: RecordingClip): number {
  if (clip.timestamp && /(?:Z|[+-]\d{2}:\d{2})$/.test(clip.timestamp)) {
    const timestamp = Date.parse(clip.timestamp);
    if (Number.isFinite(timestamp)) return timestamp / 1000;
  }
  return new Date(`${clip.dateStr}T${clip.timeStr}`).getTime() / 1000;
}

export function chronologicalCameraClips(clips: RecordingClip[], cameraId: string): RecordingClip[] {
  return clips.filter((clip) => clip.cameraId === cameraId)
    .sort((first, second) => recordingStart(first) - recordingStart(second));
}

export function recordingDayPosition(clip: RecordingClip, date = clip.dateStr): number {
  const parts = clip.timeStr.split(":").map(Number);
  const dayOffset = (Date.parse(`${clip.dateStr}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 1000;
  const fraction = ((recordingStart(clip) % 1) + 1) % 1;
  return dayOffset + parts[0] * 3600 + parts[1] * 60 + (parts[2] || 0) + fraction;
}

export function recordingAt(clips: RecordingClip[], timestamp: number, fallbackDuration: number) {
  return clips.find((clip) => {
    const start = recordingStart(clip);
    return timestamp >= start && timestamp < start + (clip.durationSeconds || fallbackDuration);
  });
}
