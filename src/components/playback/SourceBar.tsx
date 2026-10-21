"use client";

import Link from "next/link";
import { Calendar, ChevronLeft, ChevronRight, ChevronDown, Pencil, Video, Clock, Play } from "lucide-react";
import { formatGermanDateLong, getTodayStr } from "./playbackUtils";
import type { PlaybackState } from "./usePlaybackPage";

function shiftDay(date: string, offset: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(y, m - 1, d + offset);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
}

/** Auswahl der Quelle: Kamera und Tag, immer direkt oberhalb des Players. */
export function SourceBar({ pb }: { pb: PlaybackState }) {
  const {
    cameras,
    selectedCamera,
    selectedCameraId,
    selectCameraFilter,
    setCameraPickerOpen,
    cameraPickerOpen,
    selectedDate,
    selectRecordingDate,
    showAllRecordingDays,
    mobileCalendarOpen,
    setMobileCalendarOpen,
    loadingCalendar,
    calendarMonthClipCount,
    jumpTimeInput,
    setJumpTimeInput,
    jumpToTime,
  } = pb;

  const today = getTodayStr();
  const navButton =
    "touch-manipulation rounded-lg border border-slate-700 bg-slate-950 p-2 text-slate-300 hover:bg-slate-800 hover:text-white disabled:pointer-events-none disabled:opacity-30";

  return (
    <section
      aria-label="Kamera und Tag wählen"
      className="rounded-xl border border-slate-800 bg-slate-900/80 p-3 shadow-md sm:rounded-2xl"
    >
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_auto_auto] lg:items-end">
        {/* Kamera */}
        <div className="min-w-0">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Kamera</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCameraPickerOpen(true)}
              className="flex min-h-10 min-w-0 flex-1 touch-manipulation items-center justify-between gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 text-left text-sm text-white md:hidden"
              aria-haspopup="dialog"
              aria-expanded={cameraPickerOpen}
            >
              <span className="flex min-w-0 items-center gap-2">
                <Video className="h-4 w-4 shrink-0 text-sky-400" />
                <span className="truncate font-medium">{selectedCamera ? selectedCamera.name : "Alle Kameras"}</span>
              </span>
              <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
            </button>

            <div className="hidden min-h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm md:flex">
              <Video className="h-4 w-4 shrink-0 text-sky-400" />
              <select
                value={selectedCameraId}
                onChange={(event) => selectCameraFilter(event.target.value)}
                className="min-w-0 flex-1 cursor-pointer truncate bg-transparent text-sm text-white focus:outline-none"
                aria-label="Kamera auswählen"
              >
                <option value="">Alle Kameras</option>
                {cameras.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.recordEnabled ? `🔴 ${c.name} (REC)` : c.name}
                  </option>
                ))}
              </select>
            </div>

            {selectedCamera ? (
              <Link
                href={`/?editCamera=${encodeURIComponent(selectedCamera.id)}`}
                className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg border border-indigo-500/35 bg-indigo-500/10 px-3 text-xs font-semibold text-indigo-200 hover:bg-indigo-500/20"
                title={`${selectedCamera.name} bearbeiten`}
              >
                <Pencil className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Bearbeiten</span>
              </Link>
            ) : null}
          </div>
        </div>

        {/* Tag */}
        <div>
          <div className="mb-1 flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            <span>Tag</span>
            <span className="font-medium normal-case tracking-normal text-slate-500">
              {loadingCalendar ? "lädt…" : `${calendarMonthClipCount} Clips im Monat`}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={navButton}
              onClick={() => selectRecordingDate(shiftDay(selectedDate || today, -1))}
              aria-label="Vorheriger Tag"
              title="Vorheriger Tag"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setMobileCalendarOpen((open) => !open)}
              aria-expanded={mobileCalendarOpen}
              className={`inline-flex min-h-10 min-w-0 flex-1 touch-manipulation items-center justify-center gap-2 rounded-lg border px-3 text-sm font-semibold md:min-w-[230px] ${
                mobileCalendarOpen
                  ? "border-amber-500/50 bg-amber-500/10 text-amber-200"
                  : "border-slate-700 bg-slate-950 text-white hover:bg-slate-800"
              }`}
              title="Kalender öffnen"
            >
              <Calendar className="h-4 w-4 shrink-0 text-sky-400" />
              <span className="truncate">{selectedDate ? formatGermanDateLong(selectedDate) : "Alle Tage"}</span>
            </button>
            <button
              type="button"
              className={navButton}
              onClick={() => selectRecordingDate(shiftDay(selectedDate || today, 1))}
              disabled={Boolean(selectedDate) && selectedDate >= today}
              aria-label="Nächster Tag"
              title="Nächster Tag"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => selectRecordingDate(today)}
              className="min-h-10 touch-manipulation rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20"
            >
              Heute
            </button>
            {selectedDate ? (
              <button
                type="button"
                onClick={showAllRecordingDays}
                className="hidden min-h-10 rounded-lg border border-slate-700 bg-slate-950 px-3 text-xs font-semibold text-slate-300 hover:bg-slate-800 lg:block"
                title="Datumsfilter aufheben"
              >
                Alle Tage
              </button>
            ) : null}
          </div>
        </div>

        {/* Uhrzeit & Direktstart */}
        <div>
          <div className="mb-1 flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            <span>Uhrzeit</span>
            <span className="font-medium normal-case tracking-normal text-slate-500">Direktsuche</span>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void jumpToTime(jumpTimeInput);
            }}
            className="flex items-center gap-2"
          >
            <div className="relative flex min-h-10 items-center rounded-lg border border-slate-700 bg-slate-950 px-3">
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
              className="inline-flex min-h-10 touch-manipulation items-center gap-1.5 rounded-lg bg-amber-500 px-3 text-xs font-bold text-slate-950 hover:bg-amber-400 transition-colors shadow-sm shrink-0"
              title="Video an dieser Uhrzeit starten"
            >
              <Play className="h-3.5 w-3.5 fill-slate-950" />
              <span>Video ansehen</span>
            </button>
            <button
              type="button"
              onClick={() => {
                const now = new Date();
                const hh = String(now.getHours()).padStart(2, "0");
                const mm = String(now.getMinutes()).padStart(2, "0");
                const timeNow = `${hh}:${mm}`;
                setJumpTimeInput(timeNow);
                void jumpToTime(timeNow);
              }}
              className="min-h-10 touch-manipulation rounded-lg border border-slate-700 bg-slate-950 px-2.5 text-xs font-semibold text-slate-300 hover:bg-slate-800 hover:text-white shrink-0"
              title="Zur aktuellen Uhrzeit springen"
            >
              Jetzt
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
