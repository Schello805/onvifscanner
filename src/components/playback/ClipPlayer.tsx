"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BufferedRecordingVideo } from "./BufferedRecordingVideo";
import { PlaybackScrubber } from "./PlaybackScrubber";
import { Calendar, Film, Play, Pause, Download, Share2, Trash2, RefreshCw, X, Maximize2, Minimize2, Video, SkipBack, SkipForward, Gauge, Zap, Pencil, Volume2, VolumeX, ChevronLeft, ChevronRight, RotateCcw, RotateCw, Clock } from "lucide-react";
import { formatSeconds, formatBytes, formatGermanDateLong } from "@/components/playback/playbackUtils";
import type { PlaybackState } from "./usePlaybackPage";
import { recordingPlaybackMoment } from "./playbackTiming";

const recordingClockFormatter = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const recordingDateFormatter = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });

export function ClipPlayer({ pb }: { pb: PlaybackState }) {
  const startupAttemptedRef = useRef(false);
  const startupClipRef = useRef<string | undefined>(undefined);
  const [bufferedRanges, setBufferedRanges] = useState<Array<{ start: number; end: number }>>([]);
  const [hasVideoFrame, setHasVideoFrame] = useState(false);
  useEffect(() => { setBufferedRanges([]); setHasVideoFrame(false); }, [pb.activeClip?.id]);
  const updateBufferedRanges = (video: HTMLVideoElement) => {
    setBufferedRanges(Array.from({ length: video.buffered.length }, (_, index) => ({ start: video.buffered.start(index), end: video.buffered.end(index) })));
  };
  if (startupClipRef.current !== pb.activeClip?.id) {
    startupClipRef.current = pb.activeClip?.id;
    startupAttemptedRef.current = false;
  }
  const { sharingClip, handleShareClip, activeClip, setActiveClip, isPlaying, setIsPlaying, isMuted, setIsMuted, playbackRate, playerFullscreen, autoPlayNext, setAutoPlayNext, videoDuration, setVideoDuration, videoCurrentTime, setVideoCurrentTime, liveTranscode, setLiveTranscode, playerPreparing, setPlayerPreparing, playerError, setPlayerError, playerNeedsStart, setPlayerNeedsStart, playbackAttempt, setPlaybackAttempt, seekFeedback, playerOptionsOpen, setPlayerOptionsOpen, pendingSeekRef, videoRef, playerContainerRef, playerGestureRef, filteredClips, activeClipMotionEvents, handleDeleteClip, clearPlayerGesture, handlePlayerPointerDown, handlePlayerPointerEnd, seekToOffset, jumpToNextMotion, jumpToPrevMotion, setSpeed, activeClipIndex, activePlaybackUrl, playbackOffset, playPreviousClip, playNextClip, toggleFullscreen, selectedCamera, selectedDate, loadingClips, setMobileCalendarOpen, seekRelative, togglePlay, jumpToTime, jumpTimeInput, setJumpTimeInput } = pb;

  const camSegmentSec = (selectedCamera?.recordSegmentMinutes || 15) * 60;
  const clipDur = typeof activeClip?.durationSeconds === "number" && activeClip.durationSeconds > 0
    ? activeClip.durationSeconds
    : (videoDuration > 0 ? (playbackOffset || 0) + videoDuration : camSegmentSec);
  const effectiveDuration = Math.max(1, clipDur);
  const effectiveCurrentTime = Math.min(effectiveDuration, (playbackOffset || 0) + (videoCurrentTime || 0));
  const recordingMoment = activeClip ? recordingPlaybackMoment(activeClip, effectiveCurrentTime) : null;
  return (
    <>
      {/* Video Player Modal with Advanced NVR Controls */}
      {activeClip && (
        <div className={playerFullscreen ? "fixed inset-0 z-50 flex items-center justify-center bg-black overflow-hidden p-0" : "w-full rounded-2xl border border-slate-800/90 bg-slate-950 p-2 sm:p-4 shadow-2xl overflow-hidden"}>
          <div
            ref={playerContainerRef}
            className={`group relative flex flex-col overflow-hidden bg-slate-950 transition-all ${
              playerFullscreen
                ? 'w-full h-full max-w-none rounded-none border-none'
                : 'w-full rounded-xl border border-slate-800/80 shadow-xl'
            }`}
          >
            {/* Player Header */}
            <div className={`flex items-center justify-between p-3.5 border-b border-slate-800 bg-slate-900/80 shrink-0 transition-opacity duration-300 ${playerFullscreen ? 'absolute top-0 inset-x-0 z-20 opacity-0 group-hover:opacity-100' : 'relative'}`}>
              <div className="min-w-0 pr-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-400 animate-pulse"></span>
                  <h3 className="text-sm font-bold text-white truncate">{activeClip.cameraName}</h3>
                  <span className="rounded bg-slate-800 px-2 py-0.5 text-[11px] font-mono text-slate-300">
                    Start: {activeClip.timeStr} Uhr
                  </span>
                  {activeClipMotionEvents.length > 0 ? (
                    <span className="inline-flex items-center gap-1 rounded bg-amber-500/20 border border-amber-500/40 px-2 py-0.5 text-[10px] font-bold text-amber-300 shadow-sm">
                      <Zap className="h-3 w-3 fill-amber-400 text-amber-400" />
                      {activeClipMotionEvents.length} {activeClipMotionEvents.length === 1 ? "Bewegung" : "Bewegungen"} im Clip
                    </span>
                  ) : (
                    <span className="rounded bg-sky-500/20 border border-sky-500/40 px-2 py-0.5 text-[10px] font-bold text-sky-300 shadow-sm flex items-center gap-1">
                      <Film className="h-3 w-3 text-sky-400" />
                      Daueraufnahme ({formatSeconds(effectiveDuration)})
                    </span>
                  )}
                  {activeClipIndex >= 0 && (
                    <span className="text-[10px] text-slate-500 font-mono">
                      ({activeClipIndex + 1}/{filteredClips.length})
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-0.5 truncate">
                  {formatBytes(activeClip.sizeBytes)} · {activeClip.storageTargetName} · {activeClip.filename}
                </p>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <Link
                  href={`/?editCamera=${encodeURIComponent(activeClip.cameraId)}`}
                  className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
                  title={`${activeClip.cameraName} bearbeiten`}
                  aria-label={`${activeClip.cameraName} bearbeiten`}
                >
                  <Pencil className="h-4 w-4" />
                </Link>
                <button
                  onClick={toggleFullscreen}
                  className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
                  title="Vollbild (Taste F)"
                >
                  {playerFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                </button>
                <a
                  href={activeClip.downloadUrl}
                  className="rounded-lg border border-slate-700 bg-slate-800 p-2 text-slate-300 hover:text-white transition-colors"
                  title="Download MP4"
                >
                  <Download className="h-4 w-4" />
                </a>
                <button
                  type="button"
                  onClick={() => handleShareClip(activeClip.id)}
                  disabled={sharingClip}
                  className="rounded-lg border border-amber-500/40 bg-amber-500/15 p-2 text-amber-300 hover:bg-amber-500/30 hover:text-white transition-colors disabled:opacity-50"
                  title="Clip mit Zeitstempel exportieren & Link teilen (48h gültig)"
                >
                  <Share2 className={`h-4 w-4 ${sharingClip ? "animate-spin" : ""}`} />
                </button>
                <button
                  onClick={() => {
                    setActiveClip(null);
                  }}
                  className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
                  title="Schließen (Taste Esc)"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Scrollable Player Body: Ensures Video, Timeline, and Toolbar are ALWAYS visible on any display */}
            <div className="flex-1 flex flex-col min-h-0 relative">
              {/* Video Element */}
              <div className={`relative bg-black flex items-center justify-center flex-1 overflow-hidden ${playerFullscreen ? 'h-full w-full' : 'aspect-video w-full max-h-[50vh] sm:max-h-[55vh] shrink-0'}`}>
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
                  preload="auto"
                  playsInline
                  muted={isMuted}
                  className={`w-full h-full object-contain ${playerFullscreen ? '' : 'max-h-[50vh] sm:max-h-[55vh]'}`}
                  onPlay={() => {
                    if (!pb.playbackIntentRef.current) { videoRef.current?.pause(); return; }
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
                  onLoadedData={() => setHasVideoFrame(true)}
                  onSeeked={(event) => {
                    setPlayerPreparing(false);
                    updateBufferedRanges(event.currentTarget);
                  }}
                  onProgress={(event) => updateBufferedRanges(event.currentTarget)}
                  onCanPlay={(event) => {
                    if (pendingSeekRef.current !== null) return;
                    setPlayerPreparing(false);
                    setPlayerError("");
                    const dur = event.currentTarget.duration || 0;
                    if (Number.isFinite(dur) && dur > 0) {
                      setVideoDuration(dur);
                    }
                    if (!pb.playbackIntentRef.current || startupAttemptedRef.current || !event.currentTarget.paused) return;
                    startupAttemptedRef.current = true;
                    const video = event.currentTarget;
                    void video.play()
                      .then(() => setPlayerNeedsStart(false))
                      .catch((error: unknown) => {
                        if (error instanceof DOMException && error.name === "AbortError") return;
                        // If unmuted autoplay blocked by browser, try muted autoplay
                        if (videoRef.current !== video || video.error || video.ended) return;
                        if (!isMuted) {
                          video.muted = true;
                          setIsMuted(true);
                          void video.play()
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
                      if (Number.isFinite(e.currentTarget.duration) && target >= e.currentTarget.duration) {
                        e.currentTarget.pause();
                        setPlayerPreparing(false);
                        setPlayerError("Für diesen Zeitpunkt enthält die Datei keine Videodaten.");
                        return;
                      }
                      pendingSeekRef.current = null;
                      e.currentTarget.currentTime = target;
                    }
                    setPlayerError("");
                    const dur = e.currentTarget.duration || 0;
                    if (Number.isFinite(dur) && dur > 0) {
                      setVideoDuration(dur);
                    }
                  }}
                onTimeUpdate={(e) => {
                  if (!pb.scrubbingRef.current && pendingSeekRef.current === null) setVideoCurrentTime(e.currentTarget.currentTime || 0);
                }}
                onEnded={() => {
                  if (autoPlayNext && !pb.scrubbingRef.current) playNextClip();
                }}
              />
              {recordingMoment && (
                <time
                  dateTime={recordingMoment.toISOString()}
                  aria-label="Aktuelle Aufnahmezeit"
                  className="pointer-events-none absolute top-2 right-2 z-[15] rounded-md bg-black/65 px-2 py-1 text-right font-mono text-white tabular-nums backdrop-blur-sm sm:top-3 sm:right-3"
                >
                  <span className="block text-sm font-semibold sm:text-base">{recordingClockFormatter.format(recordingMoment)} Uhr</span>
                  <span className="block text-[10px] text-slate-300 sm:text-xs">{recordingDateFormatter.format(recordingMoment)}</span>
                </time>
              )}
              <div
                className="absolute inset-0 z-10 select-none cursor-pointer"
                onClick={togglePlay}
                aria-label="Klick zum Abspielen oder Pausieren"
              />
              <div className="absolute bottom-3 left-3 z-20 flex items-center gap-2">
                <button
                  type="button"
                  onClick={togglePlay}
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-black/65 text-white shadow-xl backdrop-blur-md transition hover:bg-black/85"
                  aria-label={isPlaying ? "Pause" : "Abspielen"}
                  title={isPlaying ? "Pause" : "Abspielen"}
                >
                  {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const next = !isMuted;
                    setIsMuted(next);
                    if (videoRef.current) videoRef.current.muted = next;
                  }}
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-black/65 text-white shadow-xl backdrop-blur-md transition hover:bg-black/85"
                  aria-label={isMuted ? "Ton einschalten" : "Ton stummschalten"}
                  title={isMuted ? "Ton einschalten" : "Ton stummschalten"}
                >
                  {isMuted ? <VolumeX className="h-5 w-5 text-slate-400" /> : <Volume2 className="h-5 w-5 text-emerald-400" />}
                </button>
              </div>
              {seekFeedback ? (
                <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
                  <span className="rounded-full border border-white/15 bg-black/75 px-4 py-2 text-sm font-bold text-white shadow-2xl backdrop-blur-md">{seekFeedback}</span>
                </div>
              ) : null}
              {playerPreparing && !playerError && !playerNeedsStart && (hasVideoFrame || pb.isScrubbing || (videoRef.current?.readyState || 0) >= 2) ? (
                <div className="pointer-events-none absolute top-3 left-1/2 z-30 -translate-x-1/2 rounded-lg bg-black/65 px-3 py-2 text-xs text-white backdrop-blur-sm" role="status">
                  <RefreshCw className="mr-2 inline h-3.5 w-3.5 animate-spin" /> Stelle wird geladen…
                </div>
              ) : (playerPreparing || playerError || playerNeedsStart) && (
                <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/75 p-5 text-center">
                  <div className="max-w-xs rounded-xl border border-slate-700 bg-slate-950/95 px-4 py-3 shadow-xl">
                    {playerPreparing ? (
                      <>
                        <RefreshCw className="mx-auto h-6 w-6 animate-spin text-amber-400" />
                        <p className="mt-2 text-sm font-semibold text-white">Videodaten werden geladen…</p>
                        <p className="mt-1 text-xs text-slate-400">Kurze Videosegmente werden gepuffert. Die Wiedergabe läuft anschließend an derselben Position weiter.</p>
                      </>
                    ) : playerNeedsStart ? (
                      <>
                        <Play className="mx-auto h-7 w-7 text-amber-400" />
                        <p className="mt-2 text-sm font-semibold text-white">Video ist bereit</p>
                        <button
                          type="button"
                          onClick={() => {
                            pb.playbackIntentRef.current = true;
                            setIsPlaying(true);
                            void videoRef.current?.play().then(() => setPlayerNeedsStart(false));
                          }}
                          className="mt-3 rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-slate-950"
                        >
                          Video starten
                        </button>
                      </>
                    ) : (
                      <div className="flex flex-col items-center gap-2 p-2 max-w-sm text-center">
                        <p className="text-sm font-semibold text-rose-200">{playerError}</p>
                        <p className="text-xs text-slate-400">
                          Die automatische Wiederherstellung war nicht erfolgreich. Eine kürzere Clipdauer allein bedeutet nicht, dass die Aufnahme beschädigt ist.
                        </p>
                        <div className="flex flex-wrap items-center justify-center gap-2 mt-3">
                          <button
                            type="button"
                            onClick={() => {
                              seekToOffset(0);
                              setPlayerError("");
                              setLiveTranscode(false);
                              setPlayerPreparing(true);
                              if (videoRef.current) {
                                try { videoRef.current.currentTime = 0; } catch {}
                              }
                              setPlaybackAttempt((attempt) => attempt + 1);
                            }}
                            className="rounded-lg bg-slate-800 hover:bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white border border-slate-700 transition"
                          >
                            Von Anfang abspielen
                          </button>
                          {activeClipIndex >= 0 && activeClipIndex < filteredClips.length - 1 && (
                            <button
                              type="button"
                              onClick={() => {
                                setPlayerError("");
                                setLiveTranscode(false);
                                playNextClip();
                              }}
                              className="rounded-lg bg-amber-500 hover:bg-amber-400 px-3 py-1.5 text-xs font-bold text-slate-950 transition shadow-sm"
                            >
                              Nächsten Clip ansehen ▶
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Combined Footer for Fullscreen / Normal */}
            <div className={`flex flex-col shrink-0 transition-opacity duration-300 ${playerFullscreen ? 'absolute bottom-0 inset-x-0 z-20 opacity-0 group-hover:opacity-100 bg-slate-950/80 backdrop-blur-md' : 'relative'}`}>
              {/* In-Clip Motion Timeline & Exact Moments Bar */}
              <div className="border-t border-slate-800 px-3 py-2.5">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-amber-400">
                    <Zap className="h-4 w-4 fill-amber-400 text-amber-400 animate-pulse" />
                    {activeClipMotionEvents.length > 0 ? (
                      <span>
                        {activeClipMotionEvents.length}{" "}
                        {activeClipMotionEvents.length === 1 ? "Bewegung" : "Bewegungen"} im Clip:
                      </span>
                    ) : (
                      <span className="text-sky-300 font-normal flex items-center gap-1.5">
                        <Film className="h-3.5 w-3.5 text-sky-400" />
                        Daueraufnahme ({formatSeconds(effectiveDuration)})
                      </span>
                    )}
                  </div>
                  {activeClipMotionEvents.length > 0 && (
                    <span className="text-[10px] text-slate-400 hidden sm:inline">
                      (Klicke auf eine Marke, um genau dorthin zu springen)
                    </span>
                  )}
                </div>

                {/* Video Time Info */}
                {effectiveDuration > 0 && (
                  <div className="flex items-center gap-1 text-[11px] font-mono text-slate-300 shrink-0">
                    <span className="text-white font-bold">{formatSeconds(effectiveCurrentTime)}</span>
                    <span className="text-slate-500">/</span>
                    <span className="text-slate-400">{formatSeconds(effectiveDuration)}</span>
                  </div>
                )}
              </div>

              {/* In-Clip Interactive Scrubber Track with Motion Pins */}
              {effectiveDuration > 0 && (
                <PlaybackScrubber
                  label="Position im Clip"
                  max={effectiveDuration}
                  value={effectiveCurrentTime}
                  formatValue={(position) => {
                    const moment = recordingPlaybackMoment(activeClip, position);
                    return moment ? `${recordingClockFormatter.format(moment)} Uhr · ${formatSeconds(position)} im Clip` : formatSeconds(position);
                  }}
                  onSeek={seekToOffset}
                  onScrubStart={pb.beginScrubbing}
                  onScrubEnd={pb.endScrubbing}
                  className="relative h-7 sm:h-6 w-full rounded-md bg-slate-900 border border-slate-800/80 cursor-pointer overflow-hidden group select-none shadow-inner"
                >
                  {(position) => <>
                  {bufferedRanges.map((range, index) => (
                    <div key={index} className="absolute inset-y-0 bg-slate-600/55 pointer-events-none" style={{ left: `${100 * range.start / effectiveDuration}%`, width: `${100 * (range.end - range.start) / effectiveDuration}%` }} />
                  ))}
                  {/* Played progress */}
                  <div
                    className="absolute top-0 bottom-0 left-0 bg-sky-500/40 border-r-2 border-sky-400 pointer-events-none"
                    style={{ width: `${Math.min(100, (position / effectiveDuration) * 100)}%` }}
                  />
                  <div className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-300 pointer-events-none z-20" style={{ left: `${Math.max(0.6, Math.min(99.4, position / effectiveDuration * 100))}%` }} />

                  {/* Motion Markers */}
                  {activeClipMotionEvents.map((ev, idx) => {
                    const markerPct = Math.min(100, Math.max(0, (ev.offsetSec / effectiveDuration) * 100));
                    const isCurrent = Math.abs(effectiveCurrentTime - ev.offsetSec) < 2.5;
                    return (
                      <div
                        key={ev.id || idx}
                        data-scrub-marker
                        onClick={(e) => {
                          e.stopPropagation();
                          seekToOffset(ev.offsetSec);
                        }}
                        className="absolute top-0 bottom-0 w-3 -ml-1.5 flex items-center justify-center cursor-pointer z-10 hover:scale-125 transition-transform group/marker"
                        style={{ left: `${markerPct}%` }}
                        title={`⚡ ${ev.timeStr} Uhr (bei ${formatSeconds(ev.offsetSec)}) - Klick zum Abspielen`}
                      >
                        <div
                          className={`w-[2px] h-full shadow-sm rounded-full ${
                            isCurrent
                              ? "bg-amber-300 ring-2 ring-amber-200/50 scale-125 z-20"
                              : "bg-amber-500/80 group-hover/marker:bg-amber-400 group-hover/marker:shadow-[0_0_8px_rgba(251,191,36,0.6)]"
                          }`}
                        />
                      </div>
                    );
                  })}
                  </>}
                </PlaybackScrubber>
              )}

              {/* Clickable Motion Pills with Exact Timestamps and Video Offsets */}
              {activeClipMotionEvents.length > 0 && (
                <div className="flex items-center gap-1.5 overflow-x-auto pt-2 pb-0.5 scrollbar-thin">
                  <span className="text-[10px] text-slate-400 shrink-0 font-medium mr-1">
                    Genaue Zeitpunkte:
                  </span>
                  {activeClipMotionEvents.map((ev, idx) => {
                    const isNear = Math.abs(effectiveCurrentTime - ev.offsetSec) < 2.5;
                    return (
                      <button
                        key={ev.id || idx}
                        onClick={() => seekToOffset(ev.offsetSec)}
                        className={`shrink-0 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-mono transition-all ${
                          isNear
                            ? "bg-amber-400 text-slate-950 font-bold ring-2 ring-amber-300 shadow-md shadow-amber-500/30 scale-105"
                            : "border border-amber-500/30 bg-amber-950/20 text-amber-300 hover:bg-amber-500/20 hover:border-amber-400"
                        }`}
                        title={`Springe zu ${ev.timeStr} Uhr (bei ${formatSeconds(ev.offsetSec)})`}
                      >
                        <Zap className={`h-3 w-3 ${isNear ? "fill-slate-950 text-slate-950" : "fill-amber-400 text-amber-400"}`} />
                        <span className="font-semibold">{ev.timeStr} Uhr</span>
                        <span className={`text-[10px] ${isNear ? "text-slate-900" : "text-amber-200/80"}`}>
                          (bei {formatSeconds(ev.offsetSec)})
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              </div>

              {/* Permanent space-saving playback toolbar */}
              <div className="px-3.5 py-2 border-t border-slate-800/80 bg-slate-900/60 flex flex-wrap items-center justify-between gap-2 text-xs shrink-0">
                {/* Left: Clip & Motion Navigation */}
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={playPreviousClip}
                    disabled={activeClipIndex <= 0}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1 text-slate-300 hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none transition-colors text-xs"
                    title="Vorheriger Clip"
                  >
                    <SkipBack className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Vorheriger</span>
                  </button>

                  {/* Direct Jump to Motion Buttons */}
                  {activeClipMotionEvents.length > 0 && (
                    <div className="flex items-center gap-1 border-l border-slate-800 pl-1.5">
                      <button
                        onClick={jumpToPrevMotion}
                        className="inline-flex items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-950/30 px-2 py-1 text-amber-300 hover:bg-amber-500/20 transition-colors text-xs"
                        title="Zur vorherigen Bewegung springen (Taste P)"
                      >
                        <Zap className="h-3 w-3 fill-amber-400 text-amber-400" />
                        <span className="hidden md:inline">Vorh.</span>
                      </button>
                      <button
                        onClick={jumpToNextMotion}
                        className="inline-flex items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-950/30 px-2 py-1 text-amber-300 hover:bg-amber-500/20 transition-colors text-xs"
                        title="Zur nächsten Bewegung springen (Taste N oder M)"
                      >
                        <Zap className="h-3 w-3 fill-amber-400 text-amber-400" />
                        <span className="hidden md:inline">Nächste</span>
                      </button>
                    </div>
                  )}

                  <button
                    onClick={playNextClip}
                    disabled={activeClipIndex < 0 || activeClipIndex >= filteredClips.length - 1}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1 text-slate-300 hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none transition-colors text-xs"
                    title="Nächster Clip"
                  >
                    <span className="hidden sm:inline">Nächster</span>
                    <SkipForward className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Center-Left: Rapid Jump Controls (-1m, -10s, Play/Pause, +10s, +1m) */}
                <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-950 p-0.5 shadow-sm">
                  <button
                    type="button"
                    onClick={() => seekRelative(-60)}
                    className="inline-flex items-center gap-1 rounded px-2 py-1 text-slate-300 hover:bg-slate-800 hover:text-white transition-colors text-xs font-semibold"
                    title="1 Minute zurück (Taste J oder Umschalt+Links)"
                  >
                    <RotateCcw className="h-3 w-3" />
                    <span>-1m</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => seekRelative(-10)}
                    className="inline-flex items-center gap-1 rounded px-2 py-1 text-slate-300 hover:bg-slate-800 hover:text-white transition-colors text-xs font-semibold"
                    title="10 Sekunden zurück (Pfeiltaste links)"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                    <span>-10s</span>
                  </button>
                  <button
                    type="button"
                    onClick={togglePlay}
                    className="inline-flex items-center justify-center rounded bg-amber-500 px-2.5 py-1 text-xs font-bold text-slate-950 hover:bg-amber-400 transition-colors shadow-sm"
                    title={isPlaying ? "Pause (Leertaste)" : "Abspielen (Leertaste)"}
                  >
                    {isPlaying ? <Pause className="h-3.5 w-3.5 fill-slate-950" /> : <Play className="h-3.5 w-3.5 fill-slate-950" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => seekRelative(10)}
                    className="inline-flex items-center gap-1 rounded px-2 py-1 text-slate-300 hover:bg-slate-800 hover:text-white transition-colors text-xs font-semibold"
                    title="10 Sekunden vor (Pfeiltaste rechts)"
                  >
                    <span>+10s</span>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => seekRelative(60)}
                    className="inline-flex items-center gap-1 rounded px-2 py-1 text-slate-300 hover:bg-slate-800 hover:text-white transition-colors text-xs font-semibold"
                    title="1 Minute vor (Taste L oder Umschalt+Rechts)"
                  >
                    <span>+1m</span>
                    <RotateCw className="h-3 w-3" />
                  </button>
                </div>

                {/* Center: Tempo / Speed & Auto-Play */}
                <div className="flex items-center gap-2">
                  {/* Auto-Play */}
                  <button
                    type="button"
                    onClick={() => setAutoPlayNext(!autoPlayNext)}
                    className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                      autoPlayNext
                        ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm"
                        : "border border-slate-800 bg-slate-900 text-slate-400 hover:text-white"
                    }`}
                    title={autoPlayNext ? "Auto-Play aktiv: Nächster Clip startet automatisch" : "Auto-Play deaktiviert"}
                  >
                    <span>🔁</span>
                    <span className="hidden sm:inline">Auto-Play</span>
                  </button>

                  {/* Playback Speed */}
                  <div className="flex items-center rounded-lg border border-slate-800 bg-slate-900 p-0.5">
                    <Gauge className="h-3 w-3 text-slate-400 ml-1.5 mr-1 hidden sm:inline" />
                    {[0.5, 1, 1.5, 2].map((rate) => (
                      <button
                        key={rate}
                        onClick={() => setSpeed(rate)}
                        className={`rounded px-1.5 py-0.5 font-mono text-xs transition-all ${
                          playbackRate === rate
                            ? "bg-amber-500 text-slate-950 font-bold shadow-sm"
                            : "text-slate-400 hover:text-white"
                        }`}
                      >
                        {rate}x
                      </button>
                    ))}
                  </div>
                </div>

                {/* Right: Delete Clip */}
                <button
                  onClick={() => handleDeleteClip(activeClip)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-rose-900/40 bg-rose-950/20 px-2.5 py-1 text-rose-300 hover:bg-rose-900/40 transition-colors shrink-0 text-xs"
                  title="Diesen Clip von der Festplatte löschen"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Diesen Clip löschen</span>
                </button>
              </div>
          </div>
        </div>
      </div>
    </div>
    )}

      {!activeClip && (
        <div className="w-full rounded-2xl border border-slate-800/90 bg-slate-950 p-3 sm:p-4 shadow-2xl overflow-hidden">
          <div className="flex flex-col items-center justify-center min-h-[220px] sm:min-h-[300px] rounded-xl border border-dashed border-slate-800 bg-slate-900/30 text-center p-6">
            <div className="rounded-full bg-slate-900/90 border border-slate-800 p-3.5 mb-3 text-amber-400">
              <Film className="h-7 w-7" />
            </div>
            {selectedCamera ? (
              filteredClips.length > 0 ? (
                <>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                    <h3 className="text-sm sm:text-base font-semibold text-white">
                      {selectedCamera.name}
                    </h3>
                  </div>
                  <p className="mt-1 max-w-md text-xs text-slate-300">
                    Gib eine Uhrzeit ein oder klicke unten auf die Zeitleiste, um die Wiedergabe an der gewünschten Stelle zu starten.
                  </p>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void jumpToTime(jumpTimeInput);
                    }}
                    className="mt-3 flex flex-wrap items-center justify-center gap-2"
                  >
                    <div className="relative flex min-h-10 items-center rounded-lg border border-slate-700 bg-slate-900 px-3">
                      <Clock className="h-4 w-4 shrink-0 text-sky-400 mr-2" />
                      <input
                        type="time"
                        step="60"
                        value={jumpTimeInput}
                        onChange={(e) => setJumpTimeInput(e.target.value)}
                        className="bg-transparent text-sm font-mono text-white focus:outline-none w-20"
                        aria-label="Uhrzeit für Videosuche"
                      />
                    </div>
                    <button
                      type="submit"
                      className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-amber-500 px-4 text-xs font-bold text-slate-950 hover:bg-amber-400 transition-colors shadow-md shadow-amber-500/20"
                    >
                      <Play className="h-3.5 w-3.5 fill-slate-950" />
                      <span>Video starten</span>
                    </button>
                  </form>
                  <div className="mt-2.5 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-sky-500/15 border border-sky-500/30 text-sky-300 text-xs">
                    <span className="h-2 w-2 rounded-full bg-sky-400 animate-pulse" />
                    <span>{filteredClips.length} Aufnahmen auf der Zeitleiste bereit</span>
                  </div>
                </>
              ) : (
                <>
                  <h3 className="text-sm sm:text-base font-semibold text-white">
                    {loadingClips ? `Lade Aufnahmen für ${selectedCamera.name}…` : `Keine Aufnahmen für ${selectedCamera.name}`}
                  </h3>
                  <p className="mt-1 max-w-md text-xs text-slate-400">
                    {loadingClips
                      ? "Videoabschnitte werden vorbereitet..."
                      : `Am ${selectedDate ? formatGermanDateLong(selectedDate) : "ausgewählten Tag"} wurden keine Aufnahmen gefunden. Wähle einen anderen Tag im Kalender oder klicke auf die Zeitleiste.`}
                  </p>
                  {!loadingClips && (
                    <button
                      type="button"
                      onClick={() => setMobileCalendarOpen(true)}
                      className="mt-3.5 inline-flex items-center gap-1.5 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-xs font-semibold text-sky-200 hover:bg-sky-500/20 transition-colors"
                    >
                      <Calendar className="h-3.5 w-3.5" />
                      Aufnahme-Kalender öffnen
                    </button>
                  )}
                </>
              )
            ) : (
              <>
                <h3 className="text-sm sm:text-base font-semibold text-white">Keine Kamera ausgewählt</h3>
                <p className="mt-1 max-w-md text-xs text-slate-400">
                  Wähle oben eine Kamera aus oder klicke unten auf die Zeitleiste, um die Aufnahme an dieser Stelle nahtlos abzuspielen.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
