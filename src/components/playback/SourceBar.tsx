"use client";

import Link from "next/link";
import { Calendar, ChevronLeft, ChevronRight, Clock, Play, RefreshCw, Radio, Pencil, Grid2x2, Square } from "lucide-react";
import { formatGermanDateLong, getTodayStr } from "./playbackUtils";
import type { PlaybackState } from "./usePlaybackPage";

function shiftDay(date: string, offset: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(y, m - 1, d + offset);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
}

/**
 * Kompakte Cockpit-Steuerleiste:
 * Anklickbare Kamera-Buttons für 1 bis 4 Kameras gleichzeitig (Multi-View) + Datumsnavigation + Uhrzeit-Direktsprung.
 */
export function SourceBar({ pb }: { pb: PlaybackState }) {
  const {
    cameras,
    selectedCamera,
    selectedCameraId,
    selectedCameraIds,
    toggleCameraSelection,
    selectSingleCamera,
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
  const activeIds =
    selectedCameraIds.length > 0
      ? selectedCameraIds
      : selectedCameraId
      ? [selectedCameraId]
      : [];

  return (
    <section
      aria-label="Kameras, Tag und Uhrzeit wählen"
      className="rounded-2xl border border-slate-800/90 bg-slate-900/85 px-3 py-2.5 shadow-lg backdrop-blur-md"
    >
      <div className="flex flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between">
        {/* Left: Clickable Camera Multi-Select Buttons (1 to 4 simultaneous cameras, no scrollbar) */}
        <div className="flex flex-wrap items-center gap-1.5 min-w-0 flex-1">
          <span
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-800 bg-slate-950/90 px-2 text-[11px] font-semibold text-slate-400 shrink-0"
            title="Bis zu 4 Kameras gleichzeitig anklicken (0% Server-CPU durch Direkt-Streaming)"
          >
            <Grid2x2 className="h-3.5 w-3.5 text-sky-400" />
            <span className="font-mono text-white">{activeIds.length}/4</span>
          </span>

          {cameras.map((cam) => {
            const slotIdx = activeIds.indexOf(cam.id);
            const isSelected = slotIdx !== -1;
            const isPrimary = cam.id === activeIds[0];
            return (
              <button
                key={cam.id}
                type="button"
                onClick={() => toggleCameraSelection(cam.id)}
                onDoubleClick={() => selectSingleCamera(cam.id)}
                title={
                  isSelected
                    ? activeIds.length > 1
                      ? `${cam.name} aus Multi-Ansicht abwählen (Doppelklick: nur diese Kamera)`
                      : `${cam.name} aktiv (weitere Kameras anklicken für bis zu 4er-Splitscreen)`
                    : `${cam.name} zur Ansicht hinzufügen (bis zu 4 gleichzeitig)`
                }
                className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition-all touch-manipulation ${
                  isSelected
                    ? isPrimary
                      ? "bg-amber-500 text-slate-950 shadow-sm shadow-amber-500/20 font-bold"
                      : "bg-sky-500/25 text-sky-200 border border-sky-400/60 shadow-sm font-bold"
                    : "border border-slate-800 bg-slate-950/80 text-slate-300 hover:border-slate-700 hover:bg-slate-800 hover:text-white"
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full shrink-0 ${
                    cam.recordEnabled
                      ? isSelected && isPrimary
                        ? "bg-slate-950"
                        : "bg-emerald-400 shadow-[0_0_6px_#34d399]"
                      : "bg-slate-600"
                  }`}
                />
                <span className="truncate max-w-[150px]">{cam.name}</span>
                {isSelected && activeIds.length > 1 && (
                  <span
                    className={`ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-mono font-bold ${
                      isPrimary
                        ? "bg-slate-950/20 text-slate-950"
                        : "bg-sky-400/25 text-sky-200"
                    }`}
                  >
                    {slotIdx + 1}
                  </span>
                )}
              </button>
            );
          })}

          {activeIds.length > 1 && (
            <button
              type="button"
              onClick={() => selectSingleCamera(activeIds[0])}
              className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-slate-700 bg-slate-950 px-2 text-[11px] font-semibold text-slate-300 hover:bg-slate-800 hover:text-white transition"
              title="Zurück zur Einzelansicht (1 Kamera)"
            >
              <Square className="h-3 w-3 text-amber-400" />
              <span>1x1</span>
            </button>
          )}

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
                className="bg-transparent text-xs font-mono text-white focus:outline-none w-[82px]"
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
