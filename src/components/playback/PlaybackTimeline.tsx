"use client";

import { Play, Clock, Search, Video, Zap, Image as ImageIcon } from "lucide-react";
import { TIMELINE_WINDOWS, objectClassLabels } from "@/components/playback/playbackTypes";
import { formatGermanDate, formatMinutesToTime, parseTimeToSeconds, formatBytes, getTodayStr } from "@/components/playback/playbackUtils";
import type { PlaybackState } from "./usePlaybackPage";

export function PlaybackTimeline({ pb }: { pb: PlaybackState }) {
  const { toast, cameras, selectedDate, timeFrom, timeTo, timelineWindowMinutes, timelineStartMin, showEventLog, setShowEventLog, eventLogSearch, setEventLogSearch, eventLogTimeOfDay, setEventLogTimeOfDay, showVideoTrack, setShowVideoTrack, motionEvents, hoverScrubber, setHoverScrubber, activeClip, videoCurrentTime, setSelectedSnapshot, selectRecordingDate, timelineClips, openClipWithOffset, zoomToWindow, goToNow, panTimeline, jumpToMotionCluster, playEvent, focusEventOnTimeline, timelineTicks, timelinePanStepMinutes, timelinePanLabel, filteredMotionEvents } = pb;
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
              {motionEvents.length > 0 && (
                <button
                  onClick={jumpToMotionCluster}
                  className="rounded-full bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 px-2.5 py-0.5 text-[11px] font-medium flex items-center gap-1 transition active:scale-95"
                  title="Fokus auf erste Bewegung"
                >
                  <Zap className="h-3 w-3 fill-amber-400 text-amber-400" />
                  <span>{motionEvents.length} {motionEvents.length === 1 ? "Bewegung" : "Bewegungen"}</span>
                </button>
              )}
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
              <span className="flex items-center gap-1 px-1.5 py-0.5 text-amber-300 font-semibold">
                <span className="h-2 w-2 rounded-full bg-amber-400 shadow-[0_0_6px_#f59e0b]" />
                <span>Bewegung</span>
              </span>
            </div>
          </div>
        </div>

        {/* Timeline Bar Track */}
        <div
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const clickX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
            const pct = clickX / rect.width;
            const spanMin = timelineWindowMinutes;
            const clickSeconds = (timelineStartMin + pct * spanMin) * 60;
            const totalMinutes = Math.floor(clickSeconds / 60);
            const hour = Math.floor(totalMinutes / 60) % 24;
            const minute = totalMinutes % 60;
            const timeStr = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} Uhr`;

            const nearbyClip = timelineClips.find((c) => {
              const clipStartSec = parseTimeToSeconds(c.timeStr);
              const cam = cameras.find((cm) => cm.id === c.cameraId);
              const segSec = (cam?.recordSegmentMinutes || 15) * 60;
              return clickSeconds >= clipStartSec && clickSeconds <= clipStartSec + segSec + 15;
            }) || timelineClips.find((c) => {
              const clipStartSec = parseTimeToSeconds(c.timeStr);
              return Math.abs(clickSeconds - clipStartSec) <= 16 * 60;
            });

            const hasMotion = motionEvents.some(
              (ev) => Math.abs(ev.totalMinutes - totalMinutes) <= (timelineWindowMinutes <= 15 ? 0.25 : timelineWindowMinutes <= 120 ? 1 : 4)
            );

            setHoverScrubber({
              pct,
              timeStr,
              hasRecording: Boolean(nearbyClip),
              hasMotion,
              clipName: nearbyClip?.cameraName,
            });
          }}
          onMouseLeave={() => setHoverScrubber(null)}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const clickX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
            const pct = clickX / rect.width;
            const spanMin = timelineWindowMinutes;
            const clickSeconds = (timelineStartMin + pct * spanMin) * 60;
            const totalMinutes = Math.floor(clickSeconds / 60);

            // Find matching clip at this time (exact second accuracy + duration tolerance)
            const matchingClip = timelineClips.find((c) => {
              const clipStartSec = parseTimeToSeconds(c.timeStr);
              const cam = cameras.find((cm) => cm.id === c.cameraId);
              const segSec = (cam?.recordSegmentMinutes || 15) * 60;
              return clickSeconds >= clipStartSec && clickSeconds <= clipStartSec + segSec + 15;
            }) || timelineClips.find((c) => {
              const clipStartSec = parseTimeToSeconds(c.timeStr);
              return Math.abs(clickSeconds - clipStartSec) <= 16 * 60;
            });

            if (matchingClip) {
              const clipStartSec = parseTimeToSeconds(matchingClip.timeStr);
              const offset = Math.max(0, Math.floor(clickSeconds - clipStartSec));
              openClipWithOffset(matchingClip, offset);
            } else {
              // Check if a motion event is near this point on the timeline
              const nearbyEvent = motionEvents.find((ev) => Math.abs(ev.totalMinutes - totalMinutes) <= 2);
              if (nearbyEvent) {
                void playEvent(nearbyEvent);
                return;
              }
              const hour = Math.floor(totalMinutes / 60) % 24;
              const minute = totalMinutes % 60;
              const timeFormatted = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} Uhr`;
              toast.info(`Keine Aufnahme für ${timeFormatted} vorhanden.`);
            }
          }}
          className="relative h-14 sm:h-16 w-full rounded-xl bg-slate-950 border border-slate-800/90 shadow-inner overflow-hidden cursor-crosshair select-none group"
          title="Klicke auf die Zeitleiste zum Abspielen oder Vorfall-Prüfen"
        >
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

          {/* Recorded Clips as a sleek modern slim baseline track */}
          {showVideoTrack &&
            timelineClips.map((clip) => {
              const spanMin = timelineWindowMinutes;
              const vStart = timelineStartMin;
              const vEnd = timelineStartMin + spanMin;
              const timeParts = clip.timeStr.split(":").map(Number);
              const hh = isNaN(timeParts[0]) ? 0 : timeParts[0];
              const mm = isNaN(timeParts[1]) ? 0 : timeParts[1];
              const ss = isNaN(timeParts[2]) ? 0 : timeParts[2];
              const clipStartMin = hh * 60 + mm + ss / 60;
              const camInfo = cameras.find((c) => c.id === clip.cameraId);
              const clipDurationMin = camInfo?.recordSegmentMinutes || 15;
              const clipEndMin = clipStartMin + clipDurationMin;

              if (clipEndMin < vStart || clipStartMin > vEnd) return null;

              const rStart = Math.max(vStart, clipStartMin);
              const rEnd = Math.min(vEnd, clipEndMin);
              const leftPct = ((rStart - vStart) / spanMin) * 100;
              const widthPct = Math.max(0.4, ((rEnd - rStart) / spanMin) * 100);
              const isCurrentPlaying = activeClip?.id === clip.id;

              return (
                <div
                  key={clip.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    const clipRect = e.currentTarget.getBoundingClientRect();
                    const innerPct = Math.max(0, Math.min(1, (e.clientX - clipRect.left) / clipRect.width));
                    const cam = cameras.find((cm) => cm.id === clip.cameraId);
                    const segSec = (cam?.recordSegmentMinutes || 15) * 60;
                    const offset = Math.floor(innerPct * segSec);
                    openClipWithOffset(clip, offset);
                  }}
                  className={`absolute top-2 bottom-2 rounded-lg transition-all cursor-pointer z-10 ${
                    isCurrentPlaying
                      ? "bg-sky-500/50 border-2 border-cyan-300 shadow-lg shadow-cyan-500/40 z-20"
                      : "bg-sky-500/25 hover:bg-sky-400/50 border border-sky-400/35 hover:border-sky-300 shadow-sm"
                  }`}
                  style={{
                    left: `${leftPct}%`,
                    width: `${widthPct}%`,
                    minWidth: "4px",
                  }}
                  title={`${clip.cameraName} · ${clip.timeStr} Uhr (${formatBytes(clip.sizeBytes)}) - Klick zum Abspielen`}
                />
              );
            })}

          {/* Motion Event Markers Layer */}
          {motionEvents.map((ev) => {
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
                onClick={(e) => {
                  e.stopPropagation();
                  playEvent(ev);
                }}
                className={`group/ev absolute top-1 bottom-3 z-25 cursor-pointer flex flex-col items-center justify-between pointer-events-auto transition-transform ${
                  isHighZoom ? "w-4 -ml-2 hover:scale-125" : "w-2.5 -ml-[5px] hover:scale-110"
                }`}
                style={{ left: `${leftPct}%` }}
                title={`⚡ ${ev.timeStr} Uhr: ${ev.message} (${ev.cameraName}) - Klick zum Abspielen`}
              >
                <div
                  className={`rounded-full bg-amber-400 border border-white shadow-[0_0_10px_#f59e0b] group-hover/ev:scale-125 transition-transform flex items-center justify-center ${
                    isHighZoom ? "h-3.5 w-3.5" : "h-2 w-2"
                  }`}
                >
                  {isHighZoom && <Zap className="h-2 w-2 text-slate-950 fill-slate-950" />}
                </div>
                <div
                  className={`flex-1 bg-amber-400/80 shadow-[0_0_6px_#f59e0b] ${
                    isHighZoom ? "w-[2px] bg-amber-300" : "w-[1px]"
                  }`}
                />
                <div
                  className={`rounded-full bg-amber-400 ${
                    isHighZoom ? "h-2 w-2" : "h-1.5 w-1.5"
                  }`}
                />
              </div>
            );
          })}

          {/* Indicator for currently playing clip */}
          {activeClip && (
            (() => {
              const spanMin = timelineWindowMinutes;
              const vStart = timelineStartMin;
              const vEnd = timelineStartMin + spanMin;
              const timeParts = activeClip.timeStr.split(":").map(Number);
              const hh = isNaN(timeParts[0]) ? 0 : timeParts[0];
              const mm = isNaN(timeParts[1]) ? 0 : timeParts[1];
              const ss = isNaN(timeParts[2]) ? 0 : timeParts[2];
              const startMin = hh * 60 + mm + ss / 60;
              const currentMin = startMin + (videoCurrentTime / 60);

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
                {hoverScrubber.hasMotion && (
                  <span className="text-amber-400 font-medium flex items-center gap-0.5">
                    • <Zap className="h-2.5 w-2.5 fill-amber-400" /> Bewegung
                  </span>
                )}
              </div>
            </>
          )}
        </div>

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

        {/* Ereignis-Chronik (Detaillierter Bewegungs-Inspektor) */}
        <div className="mt-4 pt-3.5 border-t border-slate-800/80">
          <div className="flex flex-wrap items-center justify-between gap-2.5 mb-2.5">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowEventLog(!showEventLog)}
                className="flex items-center gap-2 text-xs font-bold text-white hover:text-amber-400 transition"
              >
                <div className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                <span>Ereignis-Chronik für {formatGermanDate(selectedDate)}</span>
                <span className="rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-0.2 text-[10px] font-mono">
                  {motionEvents.length} {motionEvents.length === 1 ? "Ereignis" : "Ereignisse"}
                </span>
                <span className="text-slate-400 text-xs">
                  {showEventLog ? "▲" : "▼"}
                </span>
              </button>
            </div>

            {showEventLog && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {/* Search */}
                <input
                  type="text"
                  placeholder="Filter (z.B. 11:25)..."
                  value={eventLogSearch}
                  onChange={(e) => setEventLogSearch(e.target.value)}
                  className="rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                />

                {/* Tageszeit Dropdown Filter */}
                <select
                  value={eventLogTimeOfDay}
                  onChange={(e) => setEventLogTimeOfDay(e.target.value as any)}
                  className="rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1 text-xs text-white focus:outline-none cursor-pointer"
                >
                  <option value="all">Alle Tageszeiten</option>
                  <option value="morning">🌅 Vormittag (06–12 Uhr)</option>
                  <option value="afternoon">☀️ Nachmittag (12–18 Uhr)</option>
                  <option value="evening">🌙 Abend (18–24 Uhr)</option>
                  <option value="night">🌌 Nacht (00–06 Uhr)</option>
                </select>
              </div>
            )}
          </div>

          {showEventLog && (
            <div className="space-y-2">
              {filteredMotionEvents.length === 0 ? (
                <div className="p-4 rounded-xl border border-slate-800/80 bg-slate-950/40 text-center text-xs text-slate-400">
                  {motionEvents.length === 0
                    ? `Keine Bewegungsereignisse für ${formatGermanDate(selectedDate)} erfasst.`
                    : "Keine Ereignisse für den gewählten Filter gefunden."}
                </div>
              ) : (
                <div className="max-h-72 overflow-y-auto pr-1 space-y-1.5 scrollbar-thin">
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                    {filteredMotionEvents.map((ev) => (
                      <div
                        key={ev.id}
                        className="flex items-center justify-between gap-2 p-2.5 rounded-xl border border-slate-800 bg-slate-950/80 hover:border-amber-500/50 hover:bg-slate-900 transition-all shadow-sm group"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <Zap className="h-3 w-3 text-amber-400 fill-amber-400 shrink-0" />
                            <span className="text-xs font-mono font-bold text-white">
                              {ev.timeStr} Uhr
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-400 truncate mt-0.5">
                            {ev.cameraName} · {ev.message}
                          </p>
                          {ev.objectDetections && ev.objectDetections.length > 0 ? (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {ev.objectDetections.map((detection, index) => (
                                <span key={`${detection.className || detection.group}-${index}`} className="rounded bg-cyan-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-cyan-300">
                                  {objectClassLabels[detection.className || ""] || detection.className || detection.group || "Objekt"}
                                  {typeof detection.score === "number" ? ` ${Math.round(detection.score * 100)} %` : ""}
                                </span>
                              ))}
                            </div>
                          ) : ev.objectClasses && ev.objectClasses.length > 0 ? (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {ev.objectClasses.map((group) => (
                                <span key={group} className="rounded bg-cyan-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-cyan-300">
                                  {group === "person" ? "Person" : group === "vehicle" ? "Fahrzeug" : group === "animal" ? "Tier" : group}
                                </span>
                              ))}
                            </div>
                          ) : null}
                          {ev.motionRecordingStatus && !["ready", "continuous"].includes(ev.motionRecordingStatus) && (
                            <p className={`mt-0.5 text-[9px] ${["failed", "disabled"].includes(ev.motionRecordingStatus) ? "text-rose-400" : "text-amber-400"}`} title={ev.motionRecordingError || undefined}>
                              {ev.motionRecordingStatus === "failed"
                                ? "Clip konnte nicht erstellt werden"
                                : ev.motionRecordingStatus === "disabled"
                                  ? "Bewegungsaufnahme war nicht aktiv"
                                  : "Clip wird erstellt …"}
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {ev.imageUrl && (
                            <button
                              onClick={() => setSelectedSnapshot({ url: ev.imageUrl!, title: `${ev.cameraName} (${ev.timeStr} Uhr) · ${ev.message}` })}
                              className="rounded p-1 text-slate-400 hover:text-red-400 hover:bg-slate-800 transition"
                              title="Schnappschuss mit rotem Erkennungsrahmen ansehen"
                            >
                              <ImageIcon className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button
                            onClick={() => focusEventOnTimeline(ev)}
                            className="rounded p-1 text-slate-400 hover:text-white hover:bg-slate-800 transition"
                            title="Zeitleiste auf diese Minute zoomen"
                          >
                            <Search className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => playEvent(ev)}
                            className="inline-flex items-center gap-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-2 py-1 text-[11px] shadow-sm transition active:scale-95"
                            title={`Abspielen ab ${ev.timeStr} Uhr`}
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
      </div>
    </>
  );
}
