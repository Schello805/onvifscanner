import type { RecordingClip } from "./playbackTypes";

export function recordingStart(clip: RecordingClip): number {
  return new Date(`${clip.dateStr}T${clip.timeStr}`).getTime() / 1000;
}

export function chronologicalCameraClips(clips: RecordingClip[], cameraId: string): RecordingClip[] {
  return clips.filter((clip) => clip.cameraId === cameraId)
    .sort((first, second) => recordingStart(first) - recordingStart(second));
}

export function recordingAt(clips: RecordingClip[], timestamp: number, fallbackDuration: number) {
  return clips.find((clip) => {
    const start = recordingStart(clip);
    return timestamp >= start && timestamp < start + (clip.durationSeconds || fallbackDuration);
  });
}
