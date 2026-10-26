"use client";

import { useMemo, useRef, type WheelEvent } from "react";
import { Play, Search, Zap, Image as ImageIcon } from "lucide-react";
import { TIMELINE_WINDOWS, type RecordingClip } from "@/components/playback/playbackTypes";
import { formatGermanDate, formatMinutesToTime, getTodayStr } from "@/components/playback/playbackUtils";
import type { PlaybackState } from "./usePlaybackPage";
import { recordingDayPosition } from "./playbackTiming";
import { PlaybackScrubber } from "./PlaybackScrubber";

function formatTimelineTime(seconds: number) {
  const time = Math.max(0, Math.min(86400, Math.floor(seconds)));
  return [Math.floor(time / 3600), Math.floor(time / 60) % 60, time % 60]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

export function PlaybackTimeline({ pb, embedded = false }: { pb: PlaybackState; embedded?: boolean }) {
  const {
    toast,
    cameras,
    selectedDate,
    timelineWindowMinutes,
    timelineStartMin,
    hoverScrubber,
    setHoverScrubber,
    activeClip,
    videoCurrentTime,
    selectRecordingDate,
    timelineClips,
    motionEvents,
    filteredMotionEvents,
    showEventLog,
    setShowEventLog,
    eventLogSearch,
    setEventLogSearch,
    eventLogTimeOfDay,
    setEventLogTimeOfDay,
    setSelectedSnapshot,
    focusEventOnTimeline,
    openClipWithOffset,
    zoomToWindow,
    goToNow,
    panTimeline,
    playEvent,
    timelineTicks,
    timelinePanStepMinutes,
    timelinePanLabel,
  } = pb;

  // Motion events matching the currently selected camera(s)
  const timelineMotionEvents = useMemo(() => {
    let list = motionEvents;
    if (pb.selectedCameraIds.length > 0) {
      const activeSet = new Set(pb.selectedCameraIds);
      list = list.filter((ev) => activeSet.has(ev.cameraId));
    } else if (pb.selectedCameraId) {
      list = list.filter((ev) => ev.cameraId === pb.selectedCameraId);
    }
    return [...list].sort((a, b) => a.totalMinutes - b.totalMinutes);
  }, [motionEvents, pb.selectedCameraId, pb.selectedCameraIds]);

  // Merge contiguous / adjacent recording segments into unbroken continuous stream spans
  const streamSpans = useMemo(() => {
    if (!timelineClips || timelineClips.length === 0) return [];

    const clipsByCamera = new Map<
      string,
      Array<{
        clip: RecordingClip;
        startSec: number;
        endSec: number;
      }>
    >();

    for (const clip of timelineClips) {
      const startSec = recordingDayPosition(clip, selectedDate || clip.dateStr);
      const cam = cameras.find((c) => c.id === clip.cameraId);
      const segSec = (cam?.recordSegmentMinutes || 15) * 60;
      const isBogusDur =
        typeof clip.durationSeconds === "number" &&
        clip.durationSeconds > 0 &&
        clip.durationSeconds < 10 &&
        (clip.sizeBytes || 0) > 2_000_000;
      const clipDuration =
        typeof clip.durationSeconds === "number" && clip.durationSeconds > 0 && !isBogusDur
          ? clip.durationSeconds
          : segSec;
      const endSec = startSec + clipDuration;

      const list = clipsByCamera.get(clip.cameraId) || [];
      list.push({ clip, startSec, endSec });
      clipsByCamera.set(clip.cameraId, list);
    }

    const spans: Array<{
      id: string;
      cameraId: string;
      cameraName: string;
      startSec: number;
      endSec: number;
      clips: Array<{
        clip: RecordingClip;
        startSec: number;
        endSec: number;
      }>;
    }> = [];

    clipsByCamera.forEach((items, camId) => {
      if (items.length === 0) return;
      items.sort((a, b) => a.startSec - b.startSec);

      let currentSpan = {
        id: `span-${camId}-0`,
        cameraId: camId,
        cameraName: items[0].clip.cameraName,
        startSec: items[0].startSec,
        endSec: items[0].endSec,
        clips: [items[0]],
      };

      for (let i = 1; i < items.length; i++) {
        const item = items[i];
        if (item.startSec <= currentSpan.endSec + 5) {
          currentSpan.endSec = Math.max(currentSpan.endSec, item.endSec);
          currentSpan.clips.push(item);
        } else {
          spans.push(currentSpan);
          currentSpan = {
            id: `span-${camId}-${spans.length}`,
            cameraId: camId,
            cameraName: item.clip.cameraName,
            startSec: item.startSec,
            endSec: item.endSec,
            clips: [item],
          };
        }
      }
      spans.push(currentSpan);
    });

    return spans;
  }, [timelineClips, cameras, selectedDate]);

  const missingRecording = useRef<number | null>(null);
  const recordingAtPosition = (seconds: number) => {
    const matches = streamSpans
      .flatMap((span) => span.clips)
      .filter((item) => seconds >= item.startSec && seconds < item.endSec);
    return (
      matches.find((item) => item.clip.cameraId === (pb.selectedCameraId || activeClip?.cameraId)) ||
      matches[0]
    );
  };

  // Mouse-wheel zoom on timeline track
  const handleWheelZoom = (e: WheelEvent<HTMLDivElement>) => {
    if (Math.abs(e.deltaY) < 4) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
    const focusMin = timelineStartMin + ratio * timelineWindowMinutes;
    const currentIndex = TIMELINE_WINDOWS.findIndex((w) => w.minutes === timelineWindowMinutes);
    if (currentIndex === -1) return;
    const nextIndex =
      e.deltaY < 0
        ? Math.min(TIMELINE_WINDOWS.length - 1, currentIndex + 1)
        : Math.max(0, currentIndex - 1);
    if (nextIndex !== currentIndex) {
      zoomToWindow(TIMELINE_WINDOWS[nextIndex].minutes, Math.round(focusMin), "center");
    }
  };

  const currentDaySec = activeClip
    ? recordingDayPosition(activeClip, selectedDate || activeClip.dateStr) + (videoCurrentTime || 0)
    : timelineStartMin * 60;

  const latestRecordedMin = useMemo(() => {
    if (streamSpans.length === 0) return undefined;
    const maxEndSec = Math.max(...streamSpans.map((s) => s.endSec));
    return maxEndSec / 60;
  }, [streamSpans]);

  const jumpToAdjacentDayMotion = (direction: -1 | 1) => {
    if (timelineMotionEvents.length === 0) {
      toast.info("Keine Bewegungsereignisse für diese Kamera an diesem Tag.");
      return;
    }
    const currentMin = currentDaySec / 60;
    const target =
      direction > 0
        ? timelineMotionEvents.find((ev) => ev.totalMinutes > currentMin + 0.1) || timelineMotionEvents[0]
        : [...timelineMotionEvents].reverse().find((ev) => ev.totalMinutes < currentMin - 0.1) ||
          timelineMotionEvents[timelineMotionEvents.length - 1];
    if (target) {
      if (timelineWindowMinutes > 120) {
        zoomToWindow(120, Math.round(target.totalMinutes), "center");
      } else if (
        target.totalMinutes < timelineStartMin ||
        target.totalMinutes > timelineStartMin + timelineWindowMinutes
      ) {
        zoomToWindow(timelineWindowMinutes, Math.round(target.totalMinutes), "center");
      }
      void playEvent(target);
    }
  };

  const isNightWindowActive = timelineWindowMinutes === 360 && timelineStartMin === 0;

  return (
    <div
      className={
        embedded
          ? "border-t border-slate-800/90 bg-slate-950/95 px-3 pt-2.5 pb-2 select-none"
          : "rounded-2xl border border-slate-800/90 bg-gradient-to-b from-slate-900/95 to-slate-950 p-3.5 sm:p-4 shadow-2xl backdrop-blur-md select-none"
      }
    >
      {/* Compact Zoom & Pan Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 font-semibold text-slate-300">
            <span className="h-2 w-2 rounded-full bg-sky-400 shadow-[0_0_6px_#38bdf8]" />
            <span>Zeitleiste ({formatMinutesToTime(timelineStartMin)} – {formatMinutesToTime(timelineStartMin + timelineWindowMinutes)})</span>
          </span>
          {timelineMotionEvents.length > 0 && (
            <div className="inline-flex items-center gap-0.5 rounded-lg border border-amber-500/35 bg-amber-500/15 px-1.5 py-0.5 text-[11px] text-amber-300">
              <button
                type="button"
                onClick={() => jumpToAdjacentDayMotion(-1)}
                className="px-1 hover:text-white transition"
                title="Vorherige Bewegung anspringen"
              >
                ⏮
              </button>
              <button
                type="button"
                onClick={() => jumpToAdjacentDayMotion(1)}
                className="inline-flex items-center gap-1 px-1 font-semibold hover:text-white transition"
                title="Nächste Bewegung in der Aufnahme abspielen"
              >
                <Zap className="h-3 w-3 fill-amber-400 text-amber-400" />
                <span>
                  {timelineMotionEvents.length} {timelineMotionEvents.length === 1 ? "Bewegung" : "Bewegungen"}
                </span>
              </button>
              <button
                type="button"
                onClick={() => jumpToAdjacentDayMotion(1)}
                className="px-1 hover:text-white transition"
                title="Nächste Bewegung anspringen"
              >
                ⏭
              </button>
            </div>
          )}
          <span className="hidden lg:inline text-[11px] text-slate-500">
            · Mausrad zum Zoomen · Ziehen zum Spulen
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {timelineWindowMinutes < 1440 && (
            <div className="flex items-center gap-0.5 rounded-lg border border-slate-800 bg-slate-900/90 p-0.5">
              <button
                type="button"
                onClick={() => panTimeline(-timelinePanStepMinutes)}
                disabled={timelineStartMin <= 0}
                className="px-2 py-0.5 text-[11px] text-slate-300 hover:text-white disabled:opacity-30 disabled:pointer-events-none rounded hover:bg-slate-800 transition"
                title={`${timelinePanLabel} zurück`}
              >
                ◄ -{timelinePanLabel}
              </button>
              <button
                type="button"
                onClick={() => panTimeline(timelinePanStepMinutes)}
                disabled={timelineStartMin + timelineWindowMinutes >= 1440}
                className="px-2 py-0.5 text-[11px] text-slate-300 hover:text-white disabled:opacity-30 disabled:pointer-events-none rounded hover:bg-slate-800 transition"
                title={`${timelinePanLabel} vor`}
              >
                +{timelinePanLabel} ►
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              zoomToWindow(360, 180, "center");
            }}
            className={`px-2 py-0.5 text-[11px] font-semibold rounded-lg border transition ${
              isNightWindowActive
                ? "border-indigo-400 bg-indigo-500/30 text-indigo-200 shadow-sm"
                : "border-indigo-500/35 bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/25"
            }`}
            title="Nacht-Zeitfenster (00:00 – 06:00 Uhr) anzeigen"
          >
            🌙 Nacht
          </button>

          <button
            type="button"
            onClick={() => {
              if (selectedDate !== getTodayStr()) {
                selectRecordingDate(getTodayStr());
              }
              goToNow();
            }}
            className="px-2 py-0.5 text-[11px] font-semibold rounded-lg border border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 transition"
            title="Zeitleiste auf aktuellen Zeitpunkt zentrieren"
          >
            Jetzt
          </button>

          <div className="flex items-center rounded-lg border border-slate-800 bg-slate-900/90 p-0.5 text-[11px] font-medium">
            {TIMELINE_WINDOWS.map((option) => (
              <button
                key={option.minutes}
                type="button"
                onClick={() => {
                  const playheadMin = activeClip ? currentDaySec / 60 : undefined;
                  const anchorEndMin =
                    playheadMin !== undefined && latestRecordedMin !== undefined && latestRecordedMin - playheadMin <= 20
                      ? Math.max(playheadMin, latestRecordedMin)
                      : playheadMin ?? latestRecordedMin;
                  zoomToWindow(option.minutes, anchorEndMin, "end");
                }}
                className={`px-1.5 sm:px-2 py-0.5 rounded font-mono transition-all ${
                  timelineWindowMinutes === option.minutes
                    ? "bg-amber-500 text-slate-950 font-bold shadow-sm"
                    : "text-slate-400 hover:text-white"
                }`}
                title={`Letzte ${option.label} anzeigen`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Continuous Scrubber Track */}
      <div onWheel={handleWheelZoom}>
        <PlaybackScrubber
          label="Aufnahmezeit"
          min={timelineStartMin * 60}
          max={(timelineStartMin + timelineWindowMinutes) * 60}
          value={currentDaySec}
          formatValue={formatTimelineTime}
          onPreview={(seconds, pct) => {
            if (seconds === null) {
              setHoverScrubber(null);
              return;
            }
            const recording = recordingAtPosition(seconds);
            const proximityMin = timelineWindowMinutes <= 15 ? 0.25 : timelineWindowMinutes <= 120 ? 1 : 4;
            const hasMotion = timelineMotionEvents.some(
              (ev) => Math.abs(ev.totalMinutes - seconds / 60) <= proximityMin
            );
            setHoverScrubber({
              pct,
              timeStr: formatTimelineTime(seconds),
              hasRecording: Boolean(recording),
              hasMotion,
              clipName: recording?.clip.cameraName,
            });
          }}
          onScrubStart={() => {
            missingRecording.current = null;
            pb.beginScrubbing();
          }}
          onSeek={(seconds) => {
            const recording = recordingAtPosition(seconds);
            missingRecording.current = recording ? null : seconds;
            if (recording) {
              openClipWithOffset(recording.clip, Math.max(0, seconds - recording.startSec));
            }
          }}
          onScrubEnd={() => {
            pb.endScrubbing(missingRecording.current === null);
            if (missingRecording.current !== null) {
              toast.info(`Keine Aufnahme für ${formatTimelineTime(missingRecording.current)} Uhr vorhanden.`);
            }
          }}
          className="relative h-11 sm:h-12 w-full rounded-xl bg-slate-900/95 border border-slate-800 shadow-inner overflow-hidden cursor-pointer select-none group"
        >
          {(position) => (
            <>
              {/* Subtle vertical grid lines */}
              <div className="absolute inset-0 flex pointer-events-none opacity-20">
                {timelineTicks.map((_, i) => (
                  <div
                    key={i}
                    className={`flex-1 h-full border-r border-slate-700/60 ${
                      i % 2 === 0 ? "bg-slate-800/30" : ""
                    }`}
                  />
                ))}
              </div>

              {/* Recorded Stream Spans (Single lane or Multi-Camera lanes) */}
              {streamSpans.map((span) => {
                const spanMin = timelineWindowMinutes;
                const vStart = timelineStartMin;
                const vEnd = timelineStartMin + spanMin;

                const spanStartMin = span.startSec / 60;
                const spanEndMin = span.endSec / 60;

                if (spanEndMin < vStart || spanStartMin > vEnd) return null;

                const rStartMin = Math.max(vStart, spanStartMin);
                const rEndMin = Math.min(vEnd, spanEndMin);
                const leftPct = ((rStartMin - vStart) / spanMin) * 100;
                const widthPct = Math.max(0.25, ((rEndMin - rStartMin) / spanMin) * 100);

                // Progress fill up to current playhead within this span
                const playheadMin = position / 60;
                const playedEndMin = Math.max(rStartMin, Math.min(rEndMin, playheadMin));
                const playedWidthPct =
                  rEndMin > rStartMin ? ((playedEndMin - rStartMin) / (rEndMin - rStartMin)) * 100 : 0;

                const activeCamIds =
                  pb.selectedCameraIds.length > 0
                    ? pb.selectedCameraIds
                    : pb.selectedCameraId
                    ? [pb.selectedCameraId]
                    : [];
                const laneCount = Math.max(1, activeCamIds.length);
                const laneIdx = Math.max(0, activeCamIds.indexOf(span.cameraId));
                const topPct = laneCount > 1 ? 8 + laneIdx * (84 / laneCount) : 12;
                const heightPct = laneCount > 1 ? Math.max(14, 84 / laneCount - 4) : 76;

                return (
                  <div
                    key={span.id}
                    className="absolute bg-sky-500/30 hover:bg-sky-500/40 border-y border-sky-400/60 rounded-sm overflow-hidden z-10 transition-colors"
                    style={{
                      left: `${leftPct}%`,
                      width: `${widthPct}%`,
                      top: `${topPct}%`,
                      height: `${heightPct}%`,
                    }}
                  >
                    <div
                      className="absolute inset-y-0 left-0 bg-sky-400/45 pointer-events-none"
                      style={{ width: `${Math.min(100, Math.max(0, playedWidthPct))}%` }}
                    />
                  </div>
                );
              })}

              {/* Motion Event Markers Layer */}
              {timelineMotionEvents.map((ev) => {
                const spanMin = timelineWindowMinutes;
                const vStart = timelineStartMin;
                const vEnd = timelineStartMin + spanMin;
                const evMin = ev.totalMinutes;

                if (evMin < vStart || evMin > vEnd) return null;
                const leftPct = ((evMin - vStart) / spanMin) * 100;
                const isHighZoom = timelineWindowMinutes <= 120;

                return (
                  <div
                    key={ev.id}
                    data-scrub-marker
                    onClick={(e) => {
                      e.stopPropagation();
                      void playEvent(ev);
                    }}
                    className={`group/ev absolute top-0.5 bottom-0.5 z-25 cursor-pointer flex flex-col items-center justify-between pointer-events-auto transition-transform ${
                      isHighZoom ? "w-3.5 -ml-[7px] hover:scale-125" : "w-2 -ml-[4px] hover:scale-110"
                    }`}
                    style={{ left: `${leftPct}%` }}
                    title={`⚡ ${ev.timeStr} Uhr: ${ev.message} (${ev.cameraName}) – Klicken zum Abspielen`}
                  >
                    <div
                      className={`rounded-full bg-rose-500 border border-white/90 shadow-[0_0_8px_#f43f5e] group-hover/ev:scale-125 transition-transform flex items-center justify-center ${
                        isHighZoom ? "h-3 w-3" : "h-1.5 w-1.5"
                      }`}
                    >
                      {isHighZoom && <Zap className="h-2 w-2 text-white fill-white" />}
                    </div>
                    <div
                      className={`flex-1 bg-rose-500/85 shadow-[0_0_5px_#f43f5e] ${
                        isHighZoom ? "w-[2px]" : "w-[1.5px]"
                      }`}
                    />
                    <div
                      className={`rounded-full bg-rose-500 ${
                        isHighZoom ? "h-1.5 w-1.5" : "h-1 w-1"
                      }`}
                    />
                  </div>
                );
              })}

              {/* Playhead Line & Handle */}
              {activeClip &&
                (() => {
                  const spanMin = timelineWindowMinutes;
                  const vStart = timelineStartMin;
                  const vEnd = timelineStartMin + spanMin;
                  const currentMin = position / 60;

                  if (currentMin < vStart || currentMin > vEnd) return null;
                  const leftPct = ((currentMin - vStart) / spanMin) * 100;

                  return (
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-amber-400 z-30 pointer-events-none shadow-[0_0_10px_#fbbf24]"
                      style={{ left: `${leftPct}%` }}
                    >
                      <div className="absolute top-1/2 -left-2 -translate-y-1/2 h-4 w-4 rounded-full bg-amber-400 border-2 border-slate-950 shadow-md" />
                    </div>
                  );
                })()}

              {/* Hover Scrubber Preview Tooltip */}
              {hoverScrubber && (
                <>
                  <div
                    className="absolute top-0 bottom-0 w-px bg-white/80 pointer-events-none z-35"
                    style={{ left: `${hoverScrubber.pct * 100}%` }}
                  />
                  <div
                    className="absolute top-1 pointer-events-none z-40 -translate-x-1/2 rounded-md bg-slate-950/95 border border-slate-700 px-2 py-0.5 text-[11px] text-white shadow-xl whitespace-nowrap flex items-center gap-1.5"
                    style={{
                      left: `${Math.max(5, Math.min(95, hoverScrubber.pct * 100))}%`,
                    }}
                  >
                    <span className="font-mono font-bold text-amber-300">{hoverScrubber.timeStr} Uhr</span>
                    {hoverScrubber.hasRecording ? (
                      <span className="text-sky-300 text-[10px]">● Aufnahme</span>
                    ) : (
                      <span className="text-slate-500 text-[10px]">Keine Aufnahme</span>
                    )}
                    {hoverScrubber.hasMotion && (
                      <span className="text-rose-400 font-semibold text-[10px] inline-flex items-center gap-0.5">
                        · <Zap className="h-2.5 w-2.5 fill-rose-400" /> Bewegung
                      </span>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </PlaybackScrubber>
      </div>

      {/* Ruler Axis */}
      <div className="relative mt-1.5 h-3.5 select-none">
        {timelineTicks.map((tick, idx) => (
          <span
            key={idx}
            className="absolute text-[10px] font-mono text-slate-400 -translate-x-1/2"
            style={{
              left: `${Math.max(1.5, Math.min(98.5, tick.pct))}%`,
            }}
          >
            {tick.label}
          </span>
        ))}
      </div>

      {/* 24h Mini-Map Bar when zoomed in */}
      {timelineWindowMinutes < 1440 && (
        <div className="mt-1.5 pt-1.5 border-t border-slate-800/50 flex items-center gap-2">
          <span className="text-[10px] text-slate-500 font-mono shrink-0">24h:</span>
          <div
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const clickX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
              const pct = clickX / Math.max(1, rect.width);
              const clickMin = Math.floor(pct * 1440);
              zoomToWindow(timelineWindowMinutes, clickMin, "center");
            }}
            className="relative h-2.5 flex-1 rounded bg-slate-900 border border-slate-800 overflow-hidden cursor-pointer"
            title="Klicke auf die 24h-Übersicht, um den sichtbaren Ausschnitt zu verschieben"
          >
            {streamSpans.map((span) => (
              <div
                key={span.id}
                className="absolute inset-y-0.5 bg-sky-500/40 pointer-events-none"
                style={{
                  left: `${(span.startSec / 86400) * 100}%`,
                  width: `${Math.max(0.2, ((span.endSec - span.startSec) / 86400) * 100)}%`,
                }}
              />
            ))}
            {timelineMotionEvents.map((ev) => (
              <div
                key={`mini-${ev.id}`}
                className="absolute inset-y-0 w-[2px] bg-rose-500/90 pointer-events-none z-10"
                style={{ left: `${(ev.totalMinutes / 1440) * 100}%` }}
              />
            ))}
            <div
              className="absolute inset-y-0 bg-amber-400/35 border border-amber-400 rounded-sm pointer-events-none z-20"
              style={{
                left: `${(timelineStartMin / 1440) * 100}%`,
                width: `${(timelineWindowMinutes / 1440) * 100}%`,
                minWidth: "4px",
              }}
            />
          </div>
        </div>
      )}

      {/* Ereignis-Chronik (Übersicht aller Bewegungen aller Kameras für diesen Tag) */}
      {!embedded && (
        <div className="mt-3 pt-2.5 border-t border-slate-800/80">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setShowEventLog(!showEventLog)}
              className="flex items-center gap-2 text-xs font-bold text-white hover:text-amber-400 transition"
            >
              <span className="h-2 w-2 rounded-full bg-rose-500 animate-pulse" />
              <span>Bewegungs-Übersicht (alle Kameras) für {formatGermanDate(selectedDate)}</span>
              <span className="rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 px-2 py-0.5 text-[10px] font-mono">
                {motionEvents.length} {motionEvents.length === 1 ? "Bewegung" : "Bewegungen"}
              </span>
              <span className="text-slate-400 text-xs">{showEventLog ? "▲" : "▼"}</span>
            </button>

            {showEventLog && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <input
                  type="text"
                  placeholder="Kamera oder Uhrzeit filtern…"
                  value={eventLogSearch}
                  onChange={(e) => setEventLogSearch(e.target.value)}
                  className="rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                />
                <select
                  value={eventLogTimeOfDay}
                  onChange={(e) => setEventLogTimeOfDay(e.target.value as typeof eventLogTimeOfDay)}
                  className="rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1 text-xs text-white focus:outline-none cursor-pointer"
                >
                  <option value="all">Alle Tageszeiten</option>
                  <option value="night">🌌 Nacht (00–06 Uhr)</option>
                  <option value="morning">🌅 Vormittag (06–12 Uhr)</option>
                  <option value="afternoon">☀️ Nachmittag (12–18 Uhr)</option>
                  <option value="evening">🌙 Abend (18–24 Uhr)</option>
                </select>
              </div>
            )}
          </div>

          {showEventLog && (
            <div className="mt-2.5">
              {filteredMotionEvents.length === 0 ? (
                <div className="p-4 rounded-xl border border-slate-800/80 bg-slate-950/40 text-center text-xs text-slate-400">
                  {motionEvents.length === 0
                    ? `Noch keine Bewegungsereignisse für ${formatGermanDate(selectedDate)} erfasst.`
                    : "Keine Ereignisse für den gewählten Filter gefunden."}
                </div>
              ) : (
                <div className="max-h-64 overflow-y-auto pr-1 scrollbar-thin">
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                    {filteredMotionEvents.map((ev) => (
                      <div
                        key={ev.id}
                        className="flex items-center justify-between gap-2 p-2.5 rounded-xl border border-slate-800 bg-slate-950/80 hover:border-rose-500/50 hover:bg-slate-900 transition-all shadow-sm"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <Zap className="h-3 w-3 text-rose-400 fill-rose-400 shrink-0" />
                            <span className="text-xs font-mono font-bold text-white">{ev.timeStr} Uhr</span>
                          </div>
                          <p className="text-[11px] font-medium text-slate-300 truncate mt-0.5">{ev.cameraName}</p>
                          <p className="text-[10px] text-slate-500 truncate">{ev.message}</p>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {ev.imageUrl && (
                            <button
                              type="button"
                              onClick={() =>
                                setSelectedSnapshot({
                                  url: ev.imageUrl!,
                                  title: `${ev.cameraName} (${ev.timeStr} Uhr) · ${ev.message}`,
                                })
                              }
                              className="rounded p-1 text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition"
                              title="Schnappschuss ansehen"
                            >
                              <ImageIcon className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => focusEventOnTimeline(ev)}
                            className="rounded p-1 text-slate-400 hover:text-white hover:bg-slate-800 transition"
                            title="Zeitleiste auf diesen Zeitpunkt zoomen"
                          >
                            <Search className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (pb.selectedCameraId !== ev.cameraId) {
                                pb.setSelectedCameraId(ev.cameraId);
                                if (!pb.selectedCameraIds.includes(ev.cameraId)) {
                                  pb.setSelectedCameraIds([ev.cameraId]);
                                }
                              }
                              void playEvent(ev);
                            }}
                            className="inline-flex items-center gap-1 rounded-lg bg-rose-500 hover:bg-rose-400 text-white font-bold px-2 py-1 text-[11px] shadow-sm transition active:scale-95"
                            title={`Video von ${ev.cameraName} ab ${ev.timeStr} Uhr abspielen`}
                          >
                            <Play className="h-3 w-3 fill-current" />
                            Play
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
