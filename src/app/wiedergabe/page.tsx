"use client";

import { SnapshotLightboxModal } from "@/components/SnapshotLightboxModal";
import { usePlaybackPage } from "@/components/playback/usePlaybackPage";
import { SourceBar } from "@/components/playback/SourceBar";
import { DayCalendar } from "@/components/playback/DayCalendar";
import { ClipPlayer } from "@/components/playback/ClipPlayer";
import { CameraPickerSheet } from "@/components/playback/CameraPickerSheet";

/**
 * Wiedergabe: Nahtloses, platzsparendes NVR-Cockpit
 * 1. Kompakte Steuerleiste (1-Klick Kamera-Pills, Datum, Direktsprung)
 * 2. Vereinheitlichter Videoplayer mit integrierter 24h-Zeitleiste & Transportsteuerung
 */
export default function PlaybackPage() {
  const pb = usePlaybackPage();
  const { selectedSnapshot, setSelectedSnapshot } = pb;

  return (
    <div className="mx-auto max-w-7xl space-y-3">
      <SourceBar pb={pb} />
      <DayCalendar pb={pb} />
      <ClipPlayer pb={pb} />
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
