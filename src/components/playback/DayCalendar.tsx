"use client";

import { Calendar, ChevronDown, ChevronUp, ChevronLeft, ChevronRight } from "lucide-react";
import { formatGermanDate, formatGermanDateLong, getTodayStr, shiftMonth, formatMonth } from "@/components/playback/playbackUtils";
import type { PlaybackState } from "./usePlaybackPage";

export function DayCalendar({ pb }: { pb: PlaybackState }) {
  const { cameras, selectedCameraId, setSelectedCameraId, selectedDate, calendarMonth, setCalendarMonth, calendarDays, loadingCalendar, mobileCalendarOpen, setMobileCalendarOpen, fetchClips, selectRecordingDate, showAllRecordingDays, calendarCells, selectedCalendarDay, calendarMonthClipCount } = pb;
  return (
    <>
      {/* Central recording calendar */}
      {mobileCalendarOpen && <section id="recording-calendar" className="overflow-hidden rounded-xl border border-slate-800 bg-gradient-to-b from-slate-900/95 to-slate-950 shadow-xl sm:rounded-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 p-2 text-sky-300">
              <Calendar className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Aufnahme-Kalender</h2>
              <p className="text-[11px] text-slate-400">Blau markierte Tage haben Aufnahmen. Tag antippen zum Auswählen.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setMobileCalendarOpen(false)}
            className="inline-flex touch-manipulation items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-[11px] font-semibold text-slate-200 hover:bg-slate-800"
          >
            <ChevronUp className="h-3.5 w-3.5" /> Schließen
          </button>
        </div>

        <div className="grid gap-4 p-3 sm:p-4 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="min-w-0">
            <div className="mb-3 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setCalendarMonth((month) => shiftMonth(month, -1))}
                className="touch-manipulation rounded-lg border border-slate-800 bg-slate-900 p-2 text-slate-300 hover:bg-slate-800 hover:text-white"
                aria-label="Vorheriger Monat"
                title="Vorheriger Monat"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="flex items-center gap-2">
                <strong className="min-w-32 text-center text-sm capitalize text-white">{formatMonth(calendarMonth)}</strong>
                <input
                  type="month"
                  value={calendarMonth}
                  onChange={(event) => event.target.value && setCalendarMonth(event.target.value)}
                  className="max-w-36 rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-slate-300 outline-none focus:border-sky-500"
                  aria-label="Monat auswählen"
                />
              </div>
              <button
                type="button"
                onClick={() => setCalendarMonth((month) => shiftMonth(month, 1))}
                className="touch-manipulation rounded-lg border border-slate-800 bg-slate-900 p-2 text-slate-300 hover:bg-slate-800 hover:text-white"
                aria-label="Nächster Monat"
                title="Nächster Monat"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-1 text-center">
              {["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((weekday) => (
                <div key={weekday} className="py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  {weekday}
                </div>
              ))}
              {calendarCells.map((date, index) => {
                if (!date) return <div key={`empty-${index}`} className="min-h-14 sm:min-h-16" />;
                const dayInfo = calendarDays[date];
                const hasRecordings = Boolean(dayInfo?.count);
                const selected = selectedDate === date;
                const today = getTodayStr() === date;
                return (
                  <button
                    key={date}
                    type="button"
                    onClick={() => {
                      selectRecordingDate(date);
                      setMobileCalendarOpen(false);
                    }}
                    className={`relative min-h-14 rounded-lg border p-1.5 text-left transition sm:min-h-16 sm:p-2 ${
                      selected
                        ? "border-amber-400/70 bg-amber-400/15 shadow-[0_0_14px_rgba(251,191,36,0.12)]"
                        : hasRecordings
                          ? "border-sky-500/30 bg-sky-500/[0.08] hover:border-sky-400/60 hover:bg-sky-500/15"
                          : "border-white/5 bg-white/[0.02] hover:border-slate-700 hover:bg-white/[0.05]"
                    }`}
                    title={hasRecordings ? `${dayInfo.count} Aufnahme(n) von ${dayInfo.cameras.length} Kamera(s)` : "Keine Aufnahmen"}
                    aria-label={`${formatGermanDate(date)}: ${hasRecordings ? `${dayInfo.count} Aufnahmen` : "keine Aufnahmen"}`}
                  >
                    <span className={`text-xs font-semibold sm:text-sm ${selected ? "text-amber-200" : today ? "text-emerald-300" : "text-slate-300"}`}>
                      {Number(date.slice(-2))}
                    </span>
                    {hasRecordings ? (
                      <span className="absolute inset-x-1.5 bottom-1.5 flex items-center justify-between gap-1 sm:inset-x-2 sm:bottom-2">
                        <span className="h-2 w-2 shrink-0 rounded-full bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.75)]" />
                        <span className="truncate text-[9px] font-bold text-sky-200 sm:text-[10px]">{dayInfo.count}</span>
                      </span>
                    ) : null}
                    {today ? <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-emerald-400" title="Heute" /> : null}
                  </button>
                );
              })}
            </div>
          </div>

          <aside className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Ausgewählter Tag</div>
                <div className="mt-0.5 text-sm font-bold text-white">
                  {selectedDate ? formatGermanDateLong(selectedDate) : "Alle Tage"}
                </div>
              </div>
              <button
                type="button"
                onClick={() => selectRecordingDate(getTodayStr())}
                className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold text-emerald-300 hover:bg-emerald-500/20"
              >
                Heute
              </button>
            </div>

            <div className="mt-3 border-t border-slate-800 pt-3">
              {selectedCalendarDay?.cameras.length ? (
                <>
                  <div className="mb-2 text-[11px] text-slate-400">
                    {selectedCalendarDay.count} Aufnahme(n) von {selectedCalendarDay.cameras.length} Kamera(s)
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {selectedCalendarDay.cameras.map((camera) => (
                      <button
                        key={camera.id}
                        type="button"
                        onClick={() => {
                          setSelectedCameraId(camera.id);
                          void fetchClips(camera.id, selectedDate);
                        }}
                        className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition ${
                          selectedCameraId === camera.id
                            ? "border-sky-500/50 bg-sky-500/15 text-sky-100"
                            : "border-white/5 bg-white/[0.03] text-slate-300 hover:border-slate-700 hover:bg-white/[0.06]"
                        }`}
                      >
                        <span className="min-w-0 truncate font-medium">{camera.name}</span>
                        <span className="shrink-0 rounded-full bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">{camera.count}</span>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <div className="rounded-lg border border-dashed border-slate-800 px-3 py-5 text-center text-xs text-slate-500">
                  {selectedDate ? "An diesem Tag sind keine Aufnahmen vorhanden." : "Wähle einen Tag im Kalender aus."}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={showAllRecordingDays}
              className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800 hover:text-white"
            >
              Alle Tage anzeigen
            </button>
          </aside>
        </div>
      </section>}
    </>
  );
}
