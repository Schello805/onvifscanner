"use client";

import { SnapshotLightboxModal } from "@/components/SnapshotLightboxModal";
import { usePlaybackPage } from "@/components/playback/usePlaybackPage";
import { PlaybackHeader } from "@/components/playback/PlaybackHeader";
import { SourceBar } from "@/components/playback/SourceBar";
import { DayCalendar } from "@/components/playback/DayCalendar";
import { ClipPlayer } from "@/components/playback/ClipPlayer";
import { PlaybackTimeline } from "@/components/playback/PlaybackTimeline";
import { CameraPickerSheet } from "@/components/playback/CameraPickerSheet";

/**
 * Wiedergabe: Moderner NVR-Aufbau
 * 1. Kopf + Quelle (Kamera / Tag)  2. Player  3. Zeitleiste (Scrubber)
 */
export default function PlaybackPage() {
  const pb = usePlaybackPage();
  const {
    selectedSnapshot,
    setSelectedSnapshot,
  } = pb;

  return (
    <div className="mx-auto max-w-6xl space-y-4 sm:space-y-5">
      <PlaybackHeader pb={pb} />
      <SourceBar pb={pb} />
      <DayCalendar pb={pb} />

      <ClipPlayer pb={pb} />
      <PlaybackTimeline pb={pb} />

      <CameraPickerSheet pb={pb} />

      {selectedSnapshot && (
        <SnapshotLightboxModal snapshot={selectedSnapshot} onClose={() => setSelectedSnapshot(null)} />
      )}
    </div>
  );
}
