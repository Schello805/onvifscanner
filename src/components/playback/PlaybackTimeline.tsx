"use client";

import { useMemo, useRef } from "react";
import { Play, Clock, Video } from "lucide-react";
import { TIMELINE_WINDOWS } from "@/components/playback/playbackTypes";
import { formatGermanDate, formatMinutesToTime, parseTimeToSeconds, formatBytes, getTodayStr } from "@/components/playback/playbackUtils";
import type { RecordingClip } from "@/components/playback/playbackTypes";
import type { PlaybackState } from "./usePlaybackPage";
import { recordingDayPosition } from "./playbackTiming";
import { PlaybackScrubber } from "./PlaybackScrubber";

function formatTimelineTime(seconds: number) {
  const time = Math.max(0, Math.min(86400, Math.floor(seconds)));
  return [Math.floor(time / 3600), Math.floor(time / 60) % 60, time % 60].map((part) => String(part).padStart(2, "0")).join(":");
}

export function PlaybackTimeline({ pb }: { pb: PlaybackState }) {
  const { toast, cameras, selectedDate, timeFrom, timeTo, timelineWindowMinutes, timelineStartMin, showVideoTrack, setShowVideoTrack, hoverScrubber, setHoverScrubber, activeClip, videoCurrentTime, selectRecordingDate, timelineClips, openClipWithOffset, zoomToWindow, goToNow, panTimeline, timelineTicks, timelinePanStepMinutes, timelinePanLabel } = pb;

  // Merge contiguous / adjacent recording segments into unbroken continuous stream spans ("durchgehender Stream")
  const streamSpans = useMemo(() => {
    if (!timelineClips || timelineClips.length === 0) return [];

    // Group clips by camera to preserve camera separation
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
      const clipDuration = typeof clip.durationSeconds === "number" && clip.durationSeconds > 0
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
      // Sort chronologically by startSec
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
        // Merge segments if adjacent or overlapping (tolerance up to 5s handover gap)
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
    const matches = streamSpans.flatMap((span) => span.clips).filter((item) => seconds >= item.startSec && seconds < item.endSec);
    return matches.find((item) => item.clip.cameraId === (pb.selectedCameraId || activeClip?.cameraId)) || matches[0];
  };

  // Active clip highlight within the timeline
  const activeClipHighlight = useMemo(() => {
    if (!activeClip) return null;
    const startSec = recordingDayPosition(activeClip, selectedDate || activeClip.dateStr);
    const cam = cameras.find((c) => c.id === activeClip.cameraId);
    const segSec = (cam?.recordSegmentMinutes || 15) * 60;
    const clipDuration = typeof activeClip.durationSeconds === "number" && activeClip.durationSeconds > 0
      ? activeClip.durationSeconds
      : segSec;
    const endSec = startSec + clipDuration;

    const spanMin = timelineWindowMinutes;
    const vStart = timelineStartMin;
    const vEnd = timelineStartMin + spanMin;

    const startMin = startSec / 60;
    const endMin = endSec / 60;

    if (endMin < vStart || startMin > vEnd) return null;

    const rStart = Math.max(vStart, startMin);
    const rEnd = Math.min(vEnd, endMin);
    const leftPct = ((rStart - vStart) / spanMin) * 100;
    const widthPct = Math.max(0.3, ((rEnd - rStart) / spanMin) * 100);

    return { leftPct, widthPct };
  }, [activeClip, cameras, timelineWindowMinutes, timelineStartMin, selectedDate]);
  return (
    <>
      {/* Modern High-Precision Timeline */}
      <div className="rounded-2xl border border-slate-800/90 bg-gradient-to-b from-slate-900/95 to-slate-950 p-4 sm:p-5 shadow-2xl backdrop-blur-md">
        {/* Timeline Header & Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400">
              <Clock className="h-4 w-4" />
            </div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-white tracking-wide">
                Zeitleiste
              </h2>
            </div>
          </div>

          {/* Zoom Buttons & Timeline Navigation */}
          <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto">
            {/* Pan Controls if zoomed */}
            {timelineWindowMinutes < 1440 && (
              <div className="flex items-center gap-1 bg-slate-950/80 border border-slate-800 rounded-lg p-0.5">
                <button
                  onClick={() => panTimeline(-timelinePanStepMinutes)}
                  disabled={timelineStartMin <= 0}
                  className="px-2 py-1 text-slate-400 hover:text-white disabled:opacity-30 disabled:pointer-events-none text-xs rounded hover:bg-slate-800 transition"
                  title={`${timelinePanLabel} zurückrollen`}
                >
                  ◄ -{timelinePanLabel}
                </button>
                <button
                  onClick={() => panTimeline(timelinePanStepMinutes)}
                  disabled={timelineStartMin + timelineWindowMinutes >= 1440}
                  className="px-2 py-1 text-slate-400 hover:text-white disabled:opacity-30 disabled:pointer-events-none text-xs rounded hover:bg-slate-800 transition"
                  title={`${timelinePanLabel} vorrollen`}
                >
                  +{timelinePanLabel} ►
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                if (selectedDate !== getTodayStr()) {
                  selectRecordingDate(getTodayStr());
                }
                goToNow();
              }}
              className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 transition"
              title="Zeitleiste auf die aktuelle Uhrzeit setzen"
            >
              Jetzt
            </button>

            {/* Zoom-Stufen */}
            <div className="flex flex-wrap items-center rounded-lg border border-slate-800 bg-slate-950/90 p-0.5 text-xs font-medium">
              <span className="text-[11px] text-slate-400 px-2 hidden md:inline">Zoom:</span>
              {TIMELINE_WINDOWS.map((option) => (
                <button
                  key={option.minutes}
                  onClick={() => zoomToWindow(option.minutes)}
                  className={`px-2 py-1 sm:px-2.5 rounded-md font-mono transition-all ${
                    timelineWindowMinutes === option.minutes
                      ? "bg-amber-500 text-slate-950 font-bold shadow-sm"
                      : "text-slate-400 hover:text-white"
                  }`}
                  title={`${option.label} Zeitbereich anzeigen`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {/* Visual Legend & Spur-Schalter */}
            <div className="flex items-center gap-1.5 text-[11px] font-medium bg-slate-950/70 border border-slate-800 p-0.5 rounded-lg">
              <button
                type="button"
                onClick={() => setShowVideoTrack(!showVideoTrack)}
                className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-xs transition ${
                  showVideoTrack
                    ? "text-sky-300 bg-sky-500/20 border border-sky-500/40 font-semibold"
                    : "text-slate-500 hover:text-slate-300 border border-transparent opacity-60"
                }`}
                title="Blaue Video-Spur ein- oder ausblenden"
              >
                <span className={`h-1.5 w-2 rounded-sm ${showVideoTrack ? "bg-sky-400 shadow-[0_0_6px_#38bdf8]" : "bg-slate-600"}`} />
                <span>Video-Spur</span>
              </button>
            </div>
          </div>
        </div>

        {/* Timeline Bar Track */}
        <PlaybackScrubber
          label="Aufnahmezeit"
          min={timelineStartMin * 60}
          max={(timelineStartMin + timelineWindowMinutes) * 60}
          value={activeClip ? recordingDayPosition(activeClip, selectedDate || activeClip.dateStr) + videoCurrentTime : timelineStartMin * 60}
          formatValue={formatTimelineTime}
          onPreview={(seconds, pct) => {
            if (seconds === null) { setHoverScrubber(null); return; }
            const recording = recordingAtPosition(seconds);
            const proximityMin = timelineWindowMinutes <= 15 ? 0.25 : timelineWindowMinutes <= 120 ? 1 : 4;
            setHoverScrubber({ pct, timeStr: formatTimelineTime(seconds), hasRecording: Boolean(recording), hasMotion: false, clipName: recording?.clip.cameraName });
          }}
          onScrubStart={() => { missingRecording.current = null; pb.beginScrubbing(); }}
          onSeek={(seconds) => {
            const recording = recordingAtPosition(seconds);
            missingRecording.current = recording ? null : seconds;
            if (recording) openClipWithOffset(recording.clip, seconds - recording.startSec);
          }}
          onScrubEnd={() => {
            pb.endScrubbing(missingRecording.current === null);
            if (missingRecording.current !== null) toast.info(`Keine Aufnahme für ${formatTimelineTime(missingRecording.current)} Uhr vorhanden.`);
          }}
          className="relative h-14 sm:h-16 w-full rounded-xl bg-slate-950 border border-slate-800/90 shadow-inner overflow-hidden cursor-crosshair select-none group"
        >
          {(position) => <>
          {/* Subtle background hour/slot grid stripes */}
          <div className="absolute inset-0 flex pointer-events-none opacity-20">
            {timelineTicks.map((_, i) => (
              <div
                key={i}
                className={`flex-1 h-full border-r border-slate-700/60 ${
                  i % 2 === 0 ? "bg-slate-800/25" : ""
                }`}
              />
            ))}
          </div>

          {/* Active Time Window Highlight if timeFrom / timeTo are set */}
          {timeFrom && (
            (() => {
              const spanMin = timelineWindowMinutes;
              const vStart = timelineStartMin;
              const vEnd = timelineStartMin + spanMin;
              const [fH, fM] = timeFrom.split(":").map(Number);
              const [tH, tM] = (timeTo || "24:00").split(":").map(Number);
              const startMin = (isNaN(fH) ? 0 : fH) * 60 + (isNaN(fM) ? 0 : fM);
              const endMin = (isNaN(tH) ? 24 : tH) * 60 + (isNaN(tM) ? 0 : tM);

              if (endMin < vStart || startMin > vEnd) return null;
              const rStart = Math.max(vStart, startMin);
              const rEnd = Math.min(vEnd, endMin);
              const leftPct = ((rStart - vStart) / spanMin) * 100;
              const widthPct = Math.max(0.5, ((rEnd - rStart) / spanMin) * 100);

              return (
                <div
                  className="absolute top-0 bottom-0 bg-amber-500/15 border-x border-amber-500/50 pointer-events-none z-0"
                  style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                />
              );
            })()
          )}

          {/* Continuous Recorded Video Stream Spans ("Durchgehender Stream") */}
          {showVideoTrack &&
            streamSpans.map((span) => {
              const spanMin = timelineWindowMinutes;
              const vStart = timelineStartMin;
              const vEnd = timelineStartMin + spanMin;

              const spanStartMin = span.startSec / 60;
              const spanEndMin = span.endSec / 60;

              // Outside visible timeline window?
              if (spanEndMin < vStart || spanStartMin > vEnd) return null;

              const rStartMin = Math.max(vStart, spanStartMin);
              const rEndMin = Math.min(vEnd, spanEndMin);
              const leftPct = ((rStartMin - vStart) / spanMin) * 100;
              const widthPct = Math.max(0.3, ((rEndMin - rStartMin) / spanMin) * 100);

              const isLeftCapped = spanStartMin >= vStart;
              const isRightCapped = spanEndMin <= vEnd;

              return (
                <div
                  key={span.id}
                  className={`absolute top-2.5 bottom-2.5 bg-sky-500/35 hover:bg-sky-400/45 border-y border-sky-400/60 shadow-inner cursor-pointer z-10 transition-colors ${
                    isLeftCapped ? "rounded-l-md border-l" : ""
                  } ${isRightCapped ? "rounded-r-md border-r" : ""}`}
                  style={{
                    left: `${leftPct}%`,
                    width: `${widthPct}%`,
                  }}
                  title={`${span.cameraName} · Durchgehender Stream (${formatMinutesToTime(spanStartMin)} – ${formatMinutesToTime(spanEndMin)}) – Klick zum Abspielen`}
                >
                  {/* Subtle inner linear gradient along the continuous stream */}
                  <div className="absolute inset-0 bg-gradient-to-b from-sky-400/20 to-transparent pointer-events-none" />
                </div>
              );
            })}

          {/* Active Clip Highlight Band within the Stream */}
          {showVideoTrack && activeClipHighlight && (
            <div
              className="absolute top-2 bottom-2 bg-sky-400/40 border-y-2 border-cyan-300 rounded-sm pointer-events-none z-15 shadow-[0_0_12px_rgba(56,189,248,0.5)]"
              style={{
                left: `${activeClipHighlight.leftPct}%`,
                width: `${activeClipHighlight.widthPct}%`,
              }}
            />
          )}

          {/* Indicator for currently playing clip */}
          {activeClip && (
            (() => {
              const spanMin = timelineWindowMinutes;
              const vStart = timelineStartMin;
              const vEnd = timelineStartMin + spanMin;
              const currentMin = position / 60;

              if (currentMin < vStart || currentMin > vEnd) return null;
              const leftPct = ((currentMin - vStart) / spanMin) * 100;

              return (
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-cyan-300 z-30 pointer-events-none shadow-[0_0_12px_#38bdf8]"
                  style={{ left: `${leftPct}%` }}
                >
                  <div className="absolute -top-1.5 -left-2 h-4 w-4 rounded-full bg-cyan-400 border-2 border-white shadow-lg animate-pulse" />
                </div>
              );
            })()
          )}

          {/* Interactive Floating Hover Scrubber Line & Tooltip */}
          {hoverScrubber && (
            <>
              <div
                className="absolute top-0 bottom-0 w-px bg-white/70 pointer-events-none z-35 shadow-[0_0_4px_#fff]"
                style={{ left: `${hoverScrubber.pct * 100}%` }}
              />
              <div
                className="absolute top-1 pointer-events-none z-40 transform -translate-x-1/2 rounded-lg bg-slate-900/95 border border-slate-700/80 px-2 py-1 text-[10px] text-white shadow-xl backdrop-blur-sm whitespace-nowrap flex items-center gap-1.5"
                style={{
                  left: `${Math.max(6, Math.min(94, hoverScrubber.pct * 100))}%`,
                }}
              >
                <span className="font-mono font-semibold text-amber-300">
                  {hoverScrubber.timeStr}
                </span>
                {hoverScrubber.hasRecording && (
                  <span className="text-sky-300 flex items-center gap-1">
                    • 📹 Video
                  </span>
                )}
              </div>
            </>
          )}
          </>}
        </PlaybackScrubber>
        <p className="mt-1 text-[10px] text-slate-500">Tippen oder ziehen zum Springen · Bildvorschau beim Ziehen · Lücken enthalten keine Aufnahme</p>

        {/* Dynamic Zoom Ruler Axis with German time formatting */}
        <div className="relative mt-2 h-4 select-none">
          {timelineTicks.map((tick, idx) => (
            <span
              key={idx}
              className="absolute text-[10px] font-mono text-slate-400 -translate-x-1/2 hover:text-white transition-colors"
              style={{
                left: `${Math.max(1.5, Math.min(98.5, tick.pct))}%`,
              }}
            >
              {tick.label}
            </span>
          ))}
        </div>

        {/* Mini-Map Overview when zoomed in */}
        {timelineWindowMinutes < 1440 && (
          <div className="mt-3 pt-2 border-t border-slate-800/60 flex items-center gap-3">
            <span className="text-[10px] text-slate-500 font-mono shrink-0">24h Übersicht:</span>
            <div
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const clickX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
                const pct = clickX / rect.width;
                const clickMin = Math.floor(pct * 1440);
                zoomToWindow(timelineWindowMinutes, clickMin);
              }}
              className="relative h-2.5 flex-1 rounded bg-slate-950 border border-slate-800 overflow-hidden cursor-pointer"
              title="Klicke auf die 24h-Leiste, um das Zoom-Fenster zu verschieben"
            >
              {/* Highlight window */}
              <div
                className="absolute top-0 bottom-0 bg-amber-500/40 border border-amber-400 rounded-sm"
                style={{
                  left: `${(timelineStartMin / 1440) * 100}%`,
                  width: `${(timelineWindowMinutes / 1440) * 100}%`,
                  minWidth: "3px",
                }}
              />
            </div>
            <span className="text-[10px] text-slate-400 font-mono shrink-0">
              {formatMinutesToTime(timelineStartMin)} - {formatMinutesToTime(timelineStartMin + timelineWindowMinutes)}
            </span>
          </div>
        )}
      </div>
    </>
  );
}
