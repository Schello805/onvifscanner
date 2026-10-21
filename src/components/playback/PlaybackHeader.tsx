"use client";

import Link from "next/link";
import { Film, RefreshCw, Radio, BarChart3 } from "lucide-react";
import { formatGermanDateLong } from "@/components/playback/playbackUtils";
import type { PlaybackState } from "./usePlaybackPage";

export function PlaybackHeader({ pb }: { pb: PlaybackState }) {
  const { refreshing, selectedCameraId, selectedDate, setShowStatsModal, statsPeriod, activityStats, fetchActivityStats, fetchClips, filteredClips } = pb;
  return (
    <>
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <Film className="h-5 w-5 text-amber-400" />
            <span className="sm:hidden">Wiedergabe</span>
            <span className="hidden sm:inline">Wiedergabe & Vorfall-Prüfung</span>
          </h1>
          <span className="rounded-full bg-amber-500/10 border border-amber-500/25 px-2.5 py-0.5 text-xs font-semibold text-amber-300">
            {filteredClips.length} {filteredClips.length === 1 ? "Clip" : "Clips"}
          </span>
          {selectedDate && (
            <span className="hidden rounded-full bg-slate-800/80 border border-slate-700/60 px-2.5 py-0.5 text-xs font-medium text-slate-300 sm:inline-flex">
              📅 {formatGermanDateLong(selectedDate)}
            </span>
          )}
        </div>

        <div className="grid w-full grid-cols-3 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
          <button
            onClick={() => {
              setShowStatsModal(true);
              fetchActivityStats(statsPeriod);
            }}
            className="touch-manipulation inline-flex items-center justify-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/15 px-2 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-500/25 active:scale-95 transition-all shadow-sm sm:px-3 sm:py-1.5"
            title="Auswertung der Kamera-Aktivität & Bewegungserkennungen"
          >
            <BarChart3 className="h-3.5 w-3.5 text-amber-400" />
            <span className="sm:hidden">Analyse</span>
            <span className="hidden sm:inline">Kamera-Auswertung</span>
            {activityStats && activityStats.totalEvents > 0 && (
              <span className="rounded-full bg-amber-400/25 px-1.5 py-0.2 text-[10px] font-mono text-amber-200 border border-amber-400/30">
                {activityStats.totalEvents}⚡
              </span>
            )}
          </button>
          <button
            onClick={() => fetchClips(selectedCameraId, selectedDate)}
            disabled={refreshing}
            className="touch-manipulation inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-2 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 active:scale-95 transition-all sm:px-3 sm:py-1.5"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin text-amber-400" : ""}`} />
            <span className="sm:hidden">Neu laden</span>
            <span className="hidden sm:inline">Aktualisieren</span>
          </button>
          <Link
            href="/recordings"
            className="touch-manipulation inline-flex items-center justify-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2 py-2 text-xs font-medium text-rose-200 hover:bg-rose-500/20 active:scale-95 transition-all sm:px-3 sm:py-1.5"
          >
            <Radio className="h-3.5 w-3.5" />
            <span className="sm:hidden">Aufnahme</span>
            <span className="hidden sm:inline">Aufnahmesteuerung</span>
          </Link>
        </div>
      </div>
    </>
  );
}
