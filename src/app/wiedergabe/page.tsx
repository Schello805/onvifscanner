"use client";

import { SnapshotLightboxModal } from "@/components/SnapshotLightboxModal";
import { usePlaybackPage } from "@/components/playback/usePlaybackPage";
import { PlaybackHeader } from "@/components/playback/PlaybackHeader";
import { SourceBar } from "@/components/playback/SourceBar";
import { DayCalendar } from "@/components/playback/DayCalendar";
import { ClipPlayer } from "@/components/playback/ClipPlayer";
import { PlaybackTimeline } from "@/components/playback/PlaybackTimeline";
import { DailySummaryPanel } from "@/components/playback/DailySummaryPanel";
import { ClipFilterBar } from "@/components/playback/ClipFilterBar";
import { ClipList } from "@/components/playback/ClipList";
import { CameraPickerSheet } from "@/components/playback/CameraPickerSheet";
import { ActivityStatsModal } from "@/components/playback/ActivityStatsModal";

/**
 * Wiedergabe: klassischer NVR-Aufbau
 * 1. Kopf + Quelle (Kamera / Tag)  2. Player  3. Zeitleiste  4. Tagesüberblick  5. Clip-Liste mit Filtern
 */
export default function PlaybackPage() {
  const pb = usePlaybackPage();
  const {
    showStatsModal,
    setShowStatsModal,
    activeClip,
    playerFullscreen,
    cameraPickerOpen,
    selectedSnapshot,
    setSelectedSnapshot,
    activityStats,
    loadingStats,
    statsPeriod,
    setStatsPeriod,
    fetchActivityStats,
    setSelectedCameraId,
    fetchClips,
    selectedDate,
  } = pb;

  return (
    <div className="mx-auto max-w-6xl space-y-4 sm:space-y-5">
      <PlaybackHeader pb={pb} />
      <SourceBar pb={pb} />
      <DayCalendar pb={pb} />

      <ClipPlayer pb={pb} />
      <PlaybackTimeline pb={pb} />
      <DailySummaryPanel pb={pb} />

      <section className="space-y-3" aria-label="Aufnahmen">
        <ClipFilterBar pb={pb} />
        <ClipList pb={pb} />
      </section>

      <ActivityStatsModal
        isOpen={showStatsModal}
        onClose={() => setShowStatsModal(false)}
        activityStats={activityStats}
        loadingStats={loadingStats}
        statsPeriod={statsPeriod}
        onPeriodChange={(p) => {
          setStatsPeriod(p);
          fetchActivityStats(p);
        }}
        onSelectCameraFilter={(cameraId) => {
          setSelectedCameraId(cameraId);
          setShowStatsModal(false);
          fetchClips(cameraId, selectedDate);
        }}
      />

      <CameraPickerSheet pb={pb} />

      {selectedSnapshot && (
        <SnapshotLightboxModal snapshot={selectedSnapshot} onClose={() => setSelectedSnapshot(null)} />
      )}
    </div>
  );
}
