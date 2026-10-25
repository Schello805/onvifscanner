"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BufferedRecordingVideo } from "./BufferedRecordingVideo";
import { PlaybackTimeline } from "./PlaybackTimeline";
import {
  Calendar,
  Film,
  Play,
  Pause,
  Download,
  Share2,
  Trash2,
  RefreshCw,
  Maximize2,
  Minimize2,
  Gauge,
  Volume2,
  VolumeX,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  RotateCw,
  Radio,
  X,
} from "lucide-react";
import { formatGermanDateLong } from "@/components/playback/playbackUtils";
import type { CameraSimple, RecordingClip } from "@/components/playback/playbackTypes";
import type { PlaybackState } from "./usePlaybackPage";
import { recordingPlaybackMoment, recordingDayPosition } from "./playbackTiming";

const recordingClockFormatter = new Intl.DateTimeFormat("de-DE", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});
const recordingDateFormatter = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

/**
 * Synchronisierte Zusatz-Kachel für Kamera 2–4 im Multi-View (0% Server-CPU durch natives HTTP 206 Byte-Range Streaming).
 */
function SecondaryCameraTile({
  camera,
  slotNumber,
  clips,
  selectedDate,
  masterDaySec,
  isPlaying,
  playbackRate,
  isScrubbing,
  onFocusSingle,
  onRemove,
  onMakePrimary,
}: {
  camera: CameraSimple;
  slotNumber: number;
  clips: RecordingClip[];
  selectedDate: string;
  masterDaySec: number;
  isPlaying: boolean;
  playbackRate: number;
  isScrubbing: boolean;
  onFocusSingle: () => void;
  onRemove: () => void;
  onMakePrimary: (clip: RecordingClip, offsetSec: number) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const segSec = (camera.recordSegmentMinutes || 15) * 60;

  // Find the clip of this camera covering masterDaySec
  const matched = useMemo(() => {
    const camClips = clips.filter(
      (c) => c.cameraId === camera.id && (!selectedDate || c.dateStr === selectedDate)
    );
    for (const clip of camClips) {
      const startSec = recordingDayPosition(clip, selectedDate || clip.dateStr);
      const isBogus =
        typeof clip.durationSeconds === "number" &&
        clip.durationSeconds > 0 &&
        clip.durationSeconds < 10 &&
        (clip.sizeBytes || 0) > 2_000_000;
      const dur =
        typeof clip.durationSeconds === "number" && clip.durationSeconds > 0 && !isBogus
          ? clip.durationSeconds
          : segSec;
      if (masterDaySec >= startSec && masterDaySec < startSec + dur) {
        return {
          clip,
          offsetSec: Math.max(0, masterDaySec - startSec),
        };
      }
    }
    return null;
  }, [clips, camera.id, selectedDate, masterDaySec, segSec]);

  const streamUrl = matched
    ? matched.clip.streamUrl ||
      `/api/nvr/recordings/stream?clipId=${encodeURIComponent(matched.clip.id)}`
    : "";

  // Sync play/pause, playbackRate, and currentTime with masterDaySec
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !matched) return;
    if (video.playbackRate !== playbackRate) {
      video.playbackRate = playbackRate;
    }
    const targetOffset = matched.offsetSec;
    const drift = Math.abs((video.currentTime || 0) - targetOffset);
    const maxAllowedDrift = isScrubbing ? 0.25 : Math.max(1.2, 0.8 * playbackRate);
    if (video.readyState >= 1 && drift > maxAllowedDrift) {
      try {
        video.currentTime =
          Number.isFinite(video.duration) && video.duration > 0
            ? Math.min(targetOffset, Math.max(0, video.duration - 0.05))
            : targetOffset;
      } catch {}
    }
    if (isPlaying && !isScrubbing) {
      if (video.paused) void video.play().catch(() => undefined);
    } else {
      if (!video.paused) video.pause();
    }
  }, [matched, isPlaying, playbackRate, isScrubbing]);

  return (
    <div
      className="group/tile relative aspect-video w-full overflow-hidden rounded-xl border border-slate-800/90 bg-black flex items-center justify-center select-none"
      onDoubleClick={onFocusSingle}
    >
      {matched ? (
        <video
          ref={videoRef}
          src={streamUrl}
          muted
          playsInline
          preload="auto"
          className="w-full h-full object-contain cursor-pointer"
          onClick={() => onMakePrimary(matched.clip, matched.offsetSec)}
          onLoadedMetadata={(e) => {
            e.currentTarget.playbackRate = playbackRate;
            try {
              e.currentTarget.currentTime = matched.offsetSec;
            } catch {}
            if (isPlaying && !isScrubbing) {
              void e.currentTarget.play().catch(() => undefined);
            }
          }}
        />
      ) : (
        <div className="flex flex-col items-center justify-center text-center p-4 text-slate-500">
          <Film className="h-5 w-5 mb-1 opacity-50" />
          <span className="text-xs font-medium text-slate-400">{camera.name}</span>
          <span className="text-[11px] text-slate-500">Keine Aufnahme zu dieser Uhrzeit</span>
        </div>
      )}

      {/* Top-Left Camera Badge */}
      <div className="pointer-events-none absolute top-2 left-2 z-10 flex items-center gap-1.5 rounded-lg bg-black/70 px-2 py-1 text-xs font-semibold text-white backdrop-blur-sm border border-white/10">
        <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-sky-500/30 text-[10px] font-mono font-bold text-sky-300">
          {slotNumber}
        </span>
        <span className="truncate max-w-[160px]">{camera.name}</span>
      </div>

      {/* Top-Right Tile Controls (Focus 1x1 / Remove) */}
      <div className="absolute top-2 right-2 z-20 flex items-center gap-1 opacity-0 group-hover/tile:opacity-100 transition-opacity">
        <button
          type="button"
          onClick={onFocusSingle}
          className="rounded-md bg-black/75 border border-white/15 px-2 py-1 text-[10px] font-semibold text-white hover:bg-amber-500 hover:text-slate-950 transition"
          title="Nur diese Kamera groß anzeigen (Doppelklick)"
        >
          1x1
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="rounded-md bg-black/75 border border-white/15 p-1 text-slate-300 hover:bg-rose-500 hover:text-white transition"
          title="Kamera aus Multi-Ansicht schließen"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

export function ClipPlayer({ pb }: { pb: PlaybackState }) {
  const startupAttemptedRef = useRef(false);
  const startupClipRef = useRef<string | undefined>(undefined);
  const [hasVideoFrame, setHasVideoFrame] = useState(false);

  if (startupClipRef.current !== pb.activeClip?.id) {
    startupClipRef.current = pb.activeClip?.id;
    startupAttemptedRef.current = false;
  }

  const {
    cameras,
    clips,
    sharingClip,
    handleShareClip,
    activeClip,
    isPlaying,
    setIsPlaying,
    isMuted,
    setIsMuted,
    playbackRate,
    playerFullscreen,
    autoPlayNext,
    videoDuration,
    setVideoDuration,
    videoCurrentTime,
    setVideoCurrentTime,
    setLiveTranscode,
    playerPreparing,
    setPlayerPreparing,
    playerError,
    setPlayerError,
    playerNeedsStart,
    setPlayerNeedsStart,
    playbackAttempt,
    setPlaybackAttempt,
    seekFeedback,
    pendingSeekRef,
    videoRef,
    playerContainerRef,
    handleDeleteClip,
    seekToOffset,
    setSpeed,
    activePlaybackUrl,
    playbackOffset,
    playNextClip,
    jumpToLatest,
    toggleFullscreen,
    selectedCamera,
    selectedCameraId,
    selectedCameraIds,
    toggleCameraSelection,
    selectSingleCamera,
    openClipWithOffset,
    selectedDate,
    loadingClips,
    setMobileCalendarOpen,
    seekRelative,
    togglePlay,
  } = pb;

  useEffect(() => {
    setHasVideoFrame(false);
  }, [pb.activeClip?.cameraId]);

  const activeIds =
    selectedCameraIds.length > 0
      ? selectedCameraIds
      : selectedCameraId
      ? [selectedCameraId]
      : [];
  const isMultiView = activeIds.length > 1;
  const secondaryCameras = useMemo(
    () =>
      activeIds
        .slice(1, 4)
        .map((id) => cameras.find((c) => c.id === id))
        .filter((c): c is CameraSimple => Boolean(c)),
    [activeIds, cameras]
  );

  const camSegmentSec = (selectedCamera?.recordSegmentMinutes || 15) * 60;
  const currentPlaybackSec = (playbackOffset || 0) + (videoCurrentTime || 0);
  const measuredVideoDuration =
    videoDuration > 0 && Number.isFinite(videoDuration) ? (playbackOffset || 0) + videoDuration : 0;
  const rawMetaDur =
    typeof activeClip?.durationSeconds === "number" && activeClip.durationSeconds > 0
      ? activeClip.durationSeconds
      : 0;
  const isBogusMetaDur =
    rawMetaDur > 0 && rawMetaDur < 10 && (activeClip?.sizeBytes || 0) > 2_000_000;
  const reliableMetaDur = isBogusMetaDur ? camSegmentSec : rawMetaDur;

  const effectiveDuration = Math.max(
    1,
    reliableMetaDur > 0 ? reliableMetaDur : camSegmentSec,
    measuredVideoDuration,
    currentPlaybackSec
  );
  const effectiveCurrentTime = Math.min(effectiveDuration, currentPlaybackSec);
  const recordingMoment = activeClip
    ? recordingPlaybackMoment(activeClip, effectiveCurrentTime)
    : null;

  const masterDaySec = activeClip
    ? recordingDayPosition(activeClip, selectedDate || activeClip.dateStr) + effectiveCurrentTime
    : pb.timelineStartMin * 60;

  return (
    <div
      className={
        playerFullscreen
          ? "fixed inset-0 z-50 flex items-center justify-center bg-black overflow-hidden p-0"
          : "w-full rounded-2xl border border-slate-800/90 bg-slate-950 shadow-2xl overflow-hidden"
      }
    >
      <div
        ref={playerContainerRef}
        className={`group relative flex flex-col overflow-hidden bg-slate-950 w-full ${
          playerFullscreen ? "h-full max-w-none rounded-none border-none" : ""
        }`}
      >
        {/* Video Viewport: Single Cinema View (1x1) or Synchronized Multi-Camera Grid (up to 2x2) */}
        <div
          className={
            isMultiView
              ? `grid grid-cols-1 sm:grid-cols-2 gap-1.5 bg-slate-950 p-1.5 ${
                  playerFullscreen ? "flex-1 items-center" : ""
                }`
              : `relative bg-black flex items-center justify-center overflow-hidden ${
                  playerFullscreen
                    ? "flex-1 h-full w-full"
                    : "aspect-video w-full max-h-[64vh] shrink-0"
                }`
          }
        >
          {/* Primary Camera Tile (Tile 1) */}
          <div
            className={
              isMultiView
                ? "group/tile relative aspect-video w-full overflow-hidden rounded-xl border border-amber-500/50 bg-black flex items-center justify-center"
                : "relative w-full h-full flex items-center justify-center"
            }
          >
            {activeClip ? (
              <>
                <BufferedRecordingVideo
                  mediaRef={videoRef}
                  source={activePlaybackUrl}
                  fallbackSource={activeClip.streamUrl}
                  nextSource={pb.nextPlaybackUrl}
                  attempt={playbackAttempt}
                  startPosition={pendingSeekRef.current ?? 0}
                  rate={playbackRate}
                  playRequested={pb.playbackIntentRef.current}
                  scrubbing={pb.isScrubbing}
                  onRecoveryStart={(position) => {
                    setPlayerError("");
                    setPlayerNeedsStart(false);
                    setPlayerPreparing(true);
                    setVideoCurrentTime(position);
                  }}
                  onStreamError={(message) => {
                    setPlayerPreparing(false);
                    setPlayerError(message);
                  }}
                  autoPlay={pb.playbackIntentRef.current}
                  playsInline
                  muted={isMuted}
                  className={`w-full h-full object-contain ${
                    playerFullscreen || isMultiView ? "" : "max-h-[64vh]"
                  }`}
                  onPlay={() => {
                    if (!pb.playbackIntentRef.current) {
                      videoRef.current?.pause();
                      return;
                    }
                    setIsPlaying(true);
                    setPlayerNeedsStart(false);
                  }}
                  onPause={() => setIsPlaying(false)}
                  onLoadStart={() => {
                    startupAttemptedRef.current = false;
                    setPlayerPreparing(true);
                  }}
                  onPlaying={() => {
                    setHasVideoFrame(true);
                    setPlayerPreparing(false);
                    setPlayerNeedsStart(false);
                    setPlayerError("");
                  }}
                  onWaiting={() => setPlayerPreparing(true)}
                  onLoadedData={() => {
                    setHasVideoFrame(true);
                    setPlayerPreparing(false);
                  }}
                  onSeeked={() => {
                    setPlayerPreparing(false);
                  }}
                  onCanPlay={(event) => {
                    if (pendingSeekRef.current !== null) return;
                    setPlayerPreparing(false);
                    setPlayerError("");
                    const dur = event.currentTarget.duration || 0;
                    if (Number.isFinite(dur) && dur > 0) {
                      setVideoDuration(dur);
                    }
                    if (
                      !pb.playbackIntentRef.current ||
                      startupAttemptedRef.current ||
                      !event.currentTarget.paused
                    )
                      return;
                    startupAttemptedRef.current = true;
                    const video = event.currentTarget;
                    void video
                      .play()
                      .then(() => setPlayerNeedsStart(false))
                      .catch((error: unknown) => {
                        if (error instanceof DOMException && error.name === "AbortError") return;
                        if (videoRef.current !== video || video.error || video.ended) return;
                        if (!isMuted) {
                          video.muted = true;
                          setIsMuted(true);
                          void video
                            .play()
                            .then(() => setPlayerNeedsStart(false))
                            .catch(() => setPlayerNeedsStart(true));
                        } else {
                          setPlayerNeedsStart(true);
                        }
                      });
                  }}
                  onLoadedMetadata={(e) => {
                    e.currentTarget.playbackRate = playbackRate;
                    if (pendingSeekRef.current !== null) {
                      const target = pendingSeekRef.current;
                      pendingSeekRef.current = null;
                      if (
                        Number.isFinite(e.currentTarget.duration) &&
                        e.currentTarget.duration > 0
                      ) {
                        e.currentTarget.currentTime = Math.min(
                          target,
                          Math.max(0, e.currentTarget.duration - 0.05)
                        );
                      } else {
                        e.currentTarget.currentTime = target;
                      }
                    }
                    setPlayerError("");
                    const dur = e.currentTarget.duration || 0;
                    if (Number.isFinite(dur) && dur > 0) {
                      setVideoDuration(dur);
                    }
                  }}
                  onDurationChange={(e) => {
                    const dur = e.currentTarget.duration || 0;
                    if (Number.isFinite(dur) && dur > 0) {
                      setVideoDuration(dur);
                    }
                  }}
                  onTimeUpdate={(e) => {
                    if (!pb.scrubbingRef.current && pendingSeekRef.current === null) {
                      setVideoCurrentTime(e.currentTarget.currentTime || 0);
                    }
                    const dur = e.currentTarget.duration || 0;
                    if (Number.isFinite(dur) && dur > 0 && dur !== videoDuration) {
                      setVideoDuration(dur);
                    }
                  }}
                  onEnded={() => {
                    if (autoPlayNext && !pb.scrubbingRef.current) playNextClip();
                  }}
                />

                {/* Top-Left Camera & Status Badge */}
                <div className="pointer-events-none absolute top-2.5 left-2.5 z-[15] flex items-center gap-2 rounded-lg bg-black/65 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-sm border border-white/10">
                  {isMultiView ? (
                    <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-[10px] font-mono font-bold text-slate-950">
                      1
                    </span>
                  ) : (
                    <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399]" />
                  )}
                  <span>{activeClip.cameraName}</span>
                  {playbackRate !== 1 && (
                    <span className="rounded bg-amber-500 px-1.5 py-0.2 font-mono text-[11px] font-bold text-slate-950">
                      {playbackRate}x
                    </span>
                  )}
                  {playerPreparing && !playerError && !playerNeedsStart && (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin text-amber-400 ml-1" />
                  )}
                </div>

                {/* Top-Right Live Recording Clock Overlay */}
                {recordingMoment && (
                  <time
                    dateTime={recordingMoment.toISOString()}
                    aria-label="Aktuelle Aufnahmezeit"
                    className="pointer-events-none absolute top-2.5 right-2.5 z-[15] rounded-lg bg-black/65 px-2.5 py-1 text-right font-mono text-white tabular-nums backdrop-blur-sm border border-white/10"
                  >
                    <span className="block text-sm font-bold sm:text-base tracking-tight">
                      {recordingClockFormatter.format(recordingMoment)} Uhr
                    </span>
                    <span className="block text-[10px] text-slate-300">
                      {recordingDateFormatter.format(recordingMoment)}
                    </span>
                  </time>
                )}

                {isMultiView && (
                  <div className="absolute bottom-2 right-2 z-20 flex items-center gap-1 opacity-0 group-hover/tile:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={() => selectSingleCamera(activeClip.cameraId)}
                      className="rounded-md bg-black/75 border border-white/15 px-2 py-1 text-[10px] font-semibold text-white hover:bg-amber-500 hover:text-slate-950 transition"
                      title="Nur diese Kamera groß anzeigen"
                    >
                      1x1
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleCameraSelection(activeClip.cameraId)}
                      className="rounded-md bg-black/75 border border-white/15 p-1 text-slate-300 hover:bg-rose-500 hover:text-white transition"
                      title="Kamera aus Multi-Ansicht schließen"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}

                {/* Click to Play/Pause & Double-Click for Fullscreen/1x1 */}
                <div
                  className="absolute inset-0 z-10 select-none cursor-pointer"
                  onClick={togglePlay}
                  onDoubleClick={() =>
                    isMultiView ? selectSingleCamera(activeClip.cameraId) : toggleFullscreen()
                  }
                  aria-label="Klick zum Abspielen oder Pausieren, Doppelklick für Fokus/Vollbild"
                />

                {/* Seek Feedback Pill */}
                {seekFeedback ? (
                  <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
                    <span className="rounded-full border border-white/15 bg-black/75 px-4 py-2 text-sm font-bold text-white shadow-2xl backdrop-blur-md">
                      {seekFeedback}
                    </span>
                  </div>
                ) : null}

                {/* Initial Loading / Needs Start / Error Overlay */}
                {((playerPreparing && !hasVideoFrame) || playerError || playerNeedsStart) && (
                  <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 p-5 text-center">
                    <div className="max-w-xs rounded-xl border border-slate-700 bg-slate-950/95 px-4 py-3 shadow-xl">
                      {playerPreparing && !playerError && !playerNeedsStart ? (
                        <div className="flex items-center gap-2.5 py-1">
                          <RefreshCw className="h-5 w-5 animate-spin text-amber-400 shrink-0" />
                          <span className="text-xs font-semibold text-white">
                            Stream wird geöffnet…
                          </span>
                        </div>
                      ) : playerNeedsStart ? (
                        <>
                          <Play className="mx-auto h-7 w-7 text-amber-400" />
                          <p className="mt-1.5 text-sm font-semibold text-white">Video bereit</p>
                          <button
                            type="button"
                            onClick={() => {
                              pb.playbackIntentRef.current = true;
                              setIsPlaying(true);
                              void videoRef.current?.play().then(() => setPlayerNeedsStart(false));
                            }}
                            className="mt-2.5 rounded-lg bg-amber-500 px-4 py-1.5 text-xs font-bold text-slate-950 hover:bg-amber-400"
                          >
                            Abspielen starten
                          </button>
                        </>
                      ) : (
                        <div className="flex flex-col items-center gap-2 p-1 text-center">
                          <p className="text-xs font-semibold text-rose-200">{playerError}</p>
                          <div className="flex flex-wrap items-center justify-center gap-2 mt-1">
                            <button
                              type="button"
                              onClick={() => {
                                seekToOffset(0);
                                setPlayerError("");
                                setLiveTranscode(false);
                                setPlayerPreparing(true);
                                setPlaybackAttempt((attempt) => attempt + 1);
                              }}
                              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
                            >
                              Erneut versuchen
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center text-center p-6">
                <div className="rounded-full bg-slate-900/90 border border-slate-800 p-3.5 mb-3 text-amber-400">
                  <Film className="h-6 w-6" />
                </div>
                <h3 className="text-sm sm:text-base font-semibold text-white">
                  {loadingClips
                    ? "Aufnahmen werden geladen…"
                    : selectedCamera
                    ? `Keine Aufnahmen für ${selectedCamera.name}`
                    : "Keine Kamera ausgewählt"}
                </h3>
                <p className="mt-1 max-w-md text-xs text-slate-400">
                  {loadingClips
                    ? "Einen Moment bitte…"
                    : `Am ${
                        selectedDate ? formatGermanDateLong(selectedDate) : "ausgewählten Tag"
                      } liegen für diese Kamera noch keine Aufnahmen vor.`}
                </p>
                {!loadingClips && (
                  <button
                    type="button"
                    onClick={() => setMobileCalendarOpen(true)}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-xs font-semibold text-sky-200 hover:bg-sky-500/20 transition-colors"
                  >
                    <Calendar className="h-3.5 w-3.5" />
                    Anderen Tag im Kalender wählen
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Synchronized Secondary Camera Tiles (Slots 2..4) */}
          {isMultiView &&
            secondaryCameras.map((cam, idx) => (
              <SecondaryCameraTile
                key={cam.id}
                camera={cam}
                slotNumber={idx + 2}
                clips={clips}
                selectedDate={selectedDate}
                masterDaySec={masterDaySec}
                isPlaying={isPlaying}
                playbackRate={playbackRate}
                isScrubbing={pb.isScrubbing}
                onFocusSingle={() => selectSingleCamera(cam.id)}
                onRemove={() => toggleCameraSelection(cam.id)}
                onMakePrimary={(clip, offsetSec) => {
                  pb.setSelectedCameraId(cam.id);
                  pb.setSelectedCameraIds((prev) => [
                    cam.id,
                    ...prev.filter((id) => id !== cam.id),
                  ]);
                  openClipWithOffset(clip, offsetSec);
                }}
              />
            ))}
        </div>

        {/* Unified Bottom Dock: Continuous Day Timeline + YouTube-Style Control Bar */}
        <div
          className={`flex flex-col shrink-0 transition-opacity duration-300 ${
            playerFullscreen
              ? "absolute bottom-0 inset-x-0 z-20 opacity-0 group-hover:opacity-100 bg-slate-950/90 backdrop-blur-md"
              : "relative"
          }`}
        >
          {/* Integrated Continuous Day Timeline */}
          <PlaybackTimeline pb={pb} embedded />

          {/* YouTube-Style Transport & Speed Toolbar */}
          {activeClip && (
            <div className="px-3 py-2 border-t border-slate-800/80 bg-slate-900/80 flex flex-wrap items-center justify-between gap-2 text-xs">
              {/* Left: Play/Pause, Mute, Live Clock & Quick Skips */}
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={togglePlay}
                  className="inline-flex h-8 w-9 items-center justify-center rounded-lg bg-amber-500 text-slate-950 hover:bg-amber-400 transition shadow-sm"
                  title={isPlaying ? "Pause (Leertaste)" : "Abspielen (Leertaste)"}
                  aria-label={isPlaying ? "Pause" : "Abspielen"}
                >
                  {isPlaying ? (
                    <Pause className="h-4 w-4 fill-slate-950" />
                  ) : (
                    <Play className="h-4 w-4 fill-slate-950 ml-0.5" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const next = !isMuted;
                    setIsMuted(next);
                    if (videoRef.current) videoRef.current.muted = next;
                  }}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-800 bg-slate-950 text-slate-300 hover:bg-slate-800 hover:text-white transition"
                  title={isMuted ? "Ton einschalten" : "Ton stummschalten"}
                  aria-label={isMuted ? "Ton einschalten" : "Ton stummschalten"}
                >
                  {isMuted ? (
                    <VolumeX className="h-4 w-4 text-slate-400" />
                  ) : (
                    <Volume2 className="h-4 w-4 text-emerald-400" />
                  )}
                </button>

                {recordingMoment && (
                  <div className="hidden sm:flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950 px-2.5 h-8 font-mono text-xs text-white tabular-nums">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                    <span className="font-bold">
                      {recordingClockFormatter.format(recordingMoment)} Uhr
                    </span>
                  </div>
                )}

                {/* Rapid Skip Buttons (-5m, -1m, -10s, +10s, +1m, +5m) */}
                <div className="flex items-center gap-0.5 rounded-lg border border-slate-800 bg-slate-950 p-0.5">
                  <button
                    type="button"
                    onClick={() => seekRelative(-300)}
                    className="hidden md:inline-flex items-center rounded px-2 py-1 text-slate-400 hover:bg-slate-800 hover:text-white transition font-mono text-[11px]"
                    title="5 Minuten zurück"
                  >
                    -5m
                  </button>
                  <button
                    type="button"
                    onClick={() => seekRelative(-60)}
                    className="inline-flex items-center gap-0.5 rounded px-2 py-1 text-slate-300 hover:bg-slate-800 hover:text-white transition font-mono text-[11px] font-semibold"
                    title="1 Minute zurück (Taste J)"
                  >
                    <RotateCcw className="h-3 w-3" />
                    <span>-1m</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => seekRelative(-10)}
                    className="inline-flex items-center rounded px-2 py-1 text-slate-300 hover:bg-slate-800 hover:text-white transition font-mono text-[11px] font-semibold"
                    title="10 Sekunden zurück (Pfeil links)"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                    <span>-10s</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => seekRelative(10)}
                    className="inline-flex items-center rounded px-2 py-1 text-slate-300 hover:bg-slate-800 hover:text-white transition font-mono text-[11px] font-semibold"
                    title="10 Sekunden vor (Pfeil rechts)"
                  >
                    <span>+10s</span>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => seekRelative(60)}
                    className="inline-flex items-center gap-0.5 rounded px-2 py-1 text-slate-300 hover:bg-slate-800 hover:text-white transition font-mono text-[11px] font-semibold"
                    title="1 Minute vor (Taste L)"
                  >
                    <span>+1m</span>
                    <RotateCw className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => seekRelative(300)}
                    className="hidden md:inline-flex items-center rounded px-2 py-1 text-slate-400 hover:bg-slate-800 hover:text-white transition font-mono text-[11px]"
                    title="5 Minuten vor"
                  >
                    +5m
                  </button>
                </div>

                <button
                  type="button"
                  onClick={jumpToLatest}
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-emerald-500/35 bg-emerald-500/15 px-2.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/25 transition"
                  title="Zur aktuellsten Aufnahme springen"
                >
                  <Radio className="h-3.5 w-3.5 text-emerald-400" />
                  <span>Aktuell</span>
                </button>
              </div>

              {/* Right: Speed Selector & Utility Actions */}
              <div className="flex items-center gap-1.5">
                {/* Speed Selector (0.5x to 8x) */}
                <div className="flex items-center rounded-lg border border-slate-800 bg-slate-950 p-0.5">
                  <Gauge className="h-3.5 w-3.5 text-slate-400 ml-1.5 mr-1 hidden sm:inline" />
                  {[0.5, 1, 2, 4, 8].map((rate) => (
                    <button
                      key={rate}
                      type="button"
                      onClick={() => setSpeed(rate)}
                      className={`rounded px-2 py-1 font-mono text-[11px] transition-all ${
                        playbackRate === rate
                          ? "bg-amber-500 text-slate-950 font-bold shadow-sm"
                          : "text-slate-400 hover:text-white"
                      }`}
                      title={`Geschwindigkeit ${rate}x`}
                    >
                      {rate}x
                    </button>
                  ))}
                </div>

                <a
                  href={activeClip.downloadUrl}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-800 bg-slate-950 text-slate-300 hover:bg-slate-800 hover:text-white transition"
                  title="Aktuellen Abschnitt als MP4 herunterladen"
                >
                  <Download className="h-3.5 w-3.5" />
                </a>

                <button
                  type="button"
                  onClick={() => handleShareClip(activeClip.id)}
                  disabled={sharingClip}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-800 bg-slate-950 text-amber-300 hover:bg-slate-800 hover:text-white transition disabled:opacity-50"
                  title="Link zu diesem Videoabschnitt teilen (48h gültig)"
                >
                  <Share2 className={`h-3.5 w-3.5 ${sharingClip ? "animate-spin" : ""}`} />
                </button>

                <button
                  type="button"
                  onClick={() => handleDeleteClip(activeClip)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-rose-900/40 bg-rose-950/20 text-rose-300 hover:bg-rose-900/40 transition"
                  title="Diesen Aufnahmeabschnitt löschen"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>

                <button
                  type="button"
                  onClick={toggleFullscreen}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-800 bg-slate-950 text-slate-300 hover:bg-slate-800 hover:text-white transition"
                  title="Vollbild (Taste F oder Doppelklick)"
                >
                  {playerFullscreen ? (
                    <Minimize2 className="h-3.5 w-3.5" />
                  ) : (
                    <Maximize2 className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
