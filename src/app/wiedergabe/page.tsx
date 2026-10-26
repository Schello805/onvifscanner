"use client";

import { useEffect, useRef } from "react";
import { SnapshotLightboxModal } from "@/components/SnapshotLightboxModal";
import { usePlaybackPage } from "@/components/playback/usePlaybackPage";
import { SourceBar } from "@/components/playback/SourceBar";
import { DayCalendar } from "@/components/playback/DayCalendar";
import { ClipPlayer } from "@/components/playback/ClipPlayer";
import { PlaybackTimeline } from "@/components/playback/PlaybackTimeline";
import { CameraPickerSheet } from "@/components/playback/CameraPickerSheet";
import { chronologicalCameraClips, recordingDayPosition } from "@/components/playback/playbackTiming";

/**
 * Wiedergabe: Nahtloses, platzsparendes NVR-Cockpit
 * 1. Kompakte Steuerleiste (1-Klick Kamera-Pills bis 4x Multi-View, Datum, Direktsprung)
 * 2. Videoplayer (1x1 oder 2x2 Synchron-Ansicht)
 * 3. Durchgehende 24h-Zeitleiste
 */
export default function PlaybackPage() {
  const pb = usePlaybackPage();
  const {
    selectedSnapshot,
    setSelectedSnapshot,
    loadingClips,
    cameras,
    clips,
    selectedCameraId,
    setSelectedCameraId,
    setSelectedCameraIds,
    selectedDate,
    activeClip,
    openClipWithOffset,
    videoCurrentTime,
  } = pb;

  const lastCameraRef = useRef<string>("");

  // Automatisch aktuellsten (oder zeitgleichen) Clip öffnen, wenn Kamera gewechselt wird
  useEffect(() => {
    if (loadingClips || !selectedCameraId) return;
    if (lastCameraRef.current === selectedCameraId && activeClip?.cameraId === selectedCameraId) {
      return;
    }
    const camClips = chronologicalCameraClips(
      selectedDate ? clips.filter((c) => c.dateStr === selectedDate) : clips,
      selectedCameraId
    );
    if (camClips.length === 0) return;

    lastCameraRef.current = selectedCameraId;
    const cam = cameras.find((c) => c.id === selectedCameraId);
    const configuredSegSec = (cam?.recordSegmentMinutes || 15) * 60;

    if (activeClip && activeClip.cameraId !== selectedCameraId) {
      const dateStr = selectedDate || activeClip.dateStr;
      const targetSec = recordingDayPosition(activeClip, dateStr) + (videoCurrentTime || 0);
      const matched = camClips.find((c) => {
        const start = recordingDayPosition(c, dateStr);
        const isBogus =
          typeof c.durationSeconds === "number" &&
          c.durationSeconds > 0 &&
          c.durationSeconds < 10 &&
          (c.sizeBytes || 0) > 2_000_000;
        const dur =
          typeof c.durationSeconds === "number" && c.durationSeconds > 0 && !isBogus
            ? c.durationSeconds
            : configuredSegSec;
        return targetSec >= start && targetSec < start + dur;
      });
      if (matched) {
        const start = recordingDayPosition(matched, dateStr);
        openClipWithOffset(matched, Math.max(0, targetSec - start));
        return;
      }
    }

    if (!activeClip || activeClip.cameraId !== selectedCameraId) {
      openClipWithOffset(camClips[camClips.length - 1], 0);
    }
  }, [
    loadingClips,
    selectedCameraId,
    selectedDate,
    clips,
    cameras,
    activeClip,
    videoCurrentTime,
    openClipWithOffset,
  ]);

  return (
    <div className="mx-auto max-w-7xl space-y-3">
      <SourceBar pb={pb} />
      <DayCalendar pb={pb} />
      <ClipPlayer pb={pb} />
      <PlaybackTimeline pb={pb} />
      <CameraPickerSheet pb={pb} />

      {selectedSnapshot && (
        <SnapshotLightboxModal
          snapshot={selectedSnapshot}
          onClose={() => setSelectedSnapshot(null)}
        />
      )}
    </div>
  );
}
