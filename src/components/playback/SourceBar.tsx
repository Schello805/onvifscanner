"use client";

import Link from "next/link";
import { Calendar, ChevronLeft, ChevronRight, Clock, Play, RefreshCw, Radio, Video, Pencil } from "lucide-react";
import { formatGermanDateLong, getTodayStr } from "./playbackUtils";
import type { PlaybackState } from "./usePlaybackPage";

function shiftDay(date: string, offset: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(y, m - 1, d + offset);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
}

/**
 * Kompakte Cockpit-Steuerleiste:
 * 1-Klick Kamera-Wechsel (Pills) + Datumsnavigation + Uhrzeit-Direktsprung auf minimalem Raum.
 */
export function SourceBar({ pb }: { pb: PlaybackState }) {
  const {
    cameras,
    selectedCamera,
    selectedCameraId,
    selectCameraFilter,
    setCameraPickerOpen,
    selectedDate,
    selectRecordingDate,
    mobileCalendarOpen,
    setMobileCalendarOpen,
    jumpTimeInput,
    setJumpTimeInput,
    jumpToTime,
    refreshing,
    fetchClips,
  } = pb;

  const today = getTodayStr();

  return (
    <section
      aria-label="Kamera, Tag und Uhrzeit wählen"
      className="rounded-2xl border border-slate-800/90 bg-slate-900/85 px-3 py-2.5 shadow-lg backdrop-blur-md"
    >
      <div className="flex flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between">
        {/* Left: 1-Click Camera Switcher Pills */}
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <button
            type="button"
            onClick={() => setCameraPickerOpen(true)}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-slate-700/80 bg-slate-950 px-2.5 text-xs font-semibold text-slate-300 hover:bg-slate-800 hover:text-white md:hidden"
            title="Kamera-Auswahl öffnen"
          >
            <Video className="h-3.5 w-3.5 text-sky-400" />
            <span className="truncate max-w-[130px]">{selectedCamera ? selectedCamera.name : "Kamera"}</span>
          </button>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar min-w-0 flex-1">
            {cameras.map((cam) => {
              const isSelected = cam.id === selectedCameraId;
              return (
                <button
                  key={cam.id}
                  type="button"
                  onClick={() => selectCameraFilter(cam.id)}
                  className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-all touch-manipulation ${
                    isSelected
                      ? "bg-amber-500 text-slate-950 shadow-sm shadow-amber-500/20 font-bold"
                      : "border border-slate-800 bg-slate-950/80 text-slate-300 hover:border-slate-700 hover:bg-slate-800 hover:text-white"
                  }`}
                >
                  <span
                    className={`h-2 w-2 rounded-full shrink-0 ${
                      cam.recordEnabled
                        ? isSelected
                          ? "bg-slate-950"
                          : "bg-emerald-400 shadow-[0_0_6px_#34d399]"
                        : "bg-slate-600"
                    }`}
                  />
                  <span className="truncate max-w-[160px]">{cam.name}</span>
                </button>
              );
            })}
          </div>

          {selectedCamera && (
            <Link
              href={`/?editCamera=${encodeURIComponent(selectedCamera.id)}`}
              className="hidden sm:inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-slate-800 bg-slate-950 px-2 text-xs text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
              title={`${selectedCamera.name} Einstellungen`}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>

        {/* Right: Date Picker, Time Jump & Quick Actions */}
        <div className="flex flex-wrap items-center justify-between sm:justify-end gap-1.5 shrink-0">
          {/* Date Controls */}
          <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-950 p-0.5">
            <button
              type="button"
              onClick={() => selectRecordingDate(shiftDay(selectedDate || today, -1))}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-300 hover:bg-slate-800 hover:text-white transition"
              aria-label="Vorheriger Tag"
              title="Vorheriger Tag"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setMobileCalendarOpen((open) => !open)}
              aria-expanded={mobileCalendarOpen}
              className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition ${
                mobileCalendarOpen
                  ? "bg-amber-500/20 text-amber-200 border border-amber-500/40"
                  : "text-white hover:bg-slate-800"
              }`}
              title="Kalender ein-/ausblenden"
            >
              <Calendar className="h-3.5 w-3.5 text-sky-400 shrink-0" />
              <span className="truncate">{selectedDate ? formatGermanDateLong(selectedDate) : "Alle Tage"}</span>
            </button>
            <button
              type="button"
              onClick={() => selectRecordingDate(shiftDay(selectedDate || today, 1))}
              disabled={Boolean(selectedDate) && selectedDate >= today}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-300 hover:bg-slate-800 hover:text-white disabled:opacity-30 disabled:pointer-events-none transition"
              aria-label="Nächster Tag"
              title="Nächster Tag"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            {selectedDate !== today && (
              <button
                type="button"
                onClick={() => selectRecordingDate(today)}
                className="h-7 rounded-md bg-emerald-500/15 border border-emerald-500/30 px-2 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/25 transition"
              >
                Heute
              </button>
            )}
          </div>

          {/* Direct Time Jump */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void jumpToTime(jumpTimeInput);
            }}
            className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-950 p-0.5"
          >
            <div className="flex h-7 items-center px-2">
              <Clock className="h-3.5 w-3.5 text-sky-400 mr-1.5 shrink-0" />
              <input
                type="time"
                step="60"
                value={jumpTimeInput}
                onChange={(e) => setJumpTimeInput(e.target.value)}
                className="bg-transparent text-xs font-mono text-white focus:outline-none w-[62px]"
                aria-label="Uhrzeit für Direktsprung"
              />
            </div>
            <button
              type="submit"
              className="inline-flex h-7 items-center gap-1 rounded-md bg-amber-500 px-2.5 text-xs font-bold text-slate-950 hover:bg-amber-400 transition"
              title="Zu dieser Uhrzeit springen"
            >
              <Play className="h-3 w-3 fill-slate-950" />
              <span className="hidden sm:inline">Start</span>
            </button>
          </form>

          {/* Refresh & Recording Settings */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => fetchClips(selectedCameraId, selectedDate)}
              disabled={refreshing}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-800 bg-slate-950 text-slate-300 hover:bg-slate-800 hover:text-white transition"
              title="Aufnahmen aktualisieren"
              aria-label="Aufnahmen aktualisieren"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin text-amber-400" : ""}`} />
            </button>
            <Link
              href="/recordings"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 text-xs font-medium text-rose-200 hover:bg-rose-500/20 transition"
              title="Aufnahmesteuerung"
            >
              <Radio className="h-3.5 w-3.5" />
              <span className="hidden md:inline">Aufnahmen</span>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
