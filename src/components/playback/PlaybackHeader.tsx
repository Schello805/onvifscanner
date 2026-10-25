"use client";

import Link from "next/link";
import { Film, RefreshCw, Radio } from "lucide-react";
import { formatGermanDateLong } from "@/components/playback/playbackUtils";
import type { PlaybackState } from "./usePlaybackPage";

export function PlaybackHeader({ pb }: { pb: PlaybackState }) {
  const { refreshing, selectedCameraId, selectedDate, fetchClips, filteredClips } = pb;
  return (
    <>
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <Film className="h-5 w-5 text-amber-400" />
            <span className="sm:hidden">Wiedergabe</span>
            <span className="hidden sm:inline">Wiedergabe & Archiv</span>
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

        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchClips(selectedCameraId, selectedDate)}
            disabled={refreshing}
            className="touch-manipulation inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 active:scale-95 transition-all"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin text-amber-400" : ""}`} />
            <span>Aktualisieren</span>
          </button>
          <Link
            href="/recordings"
            className="touch-manipulation inline-flex items-center justify-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 text-xs font-medium text-rose-200 hover:bg-rose-500/20 active:scale-95 transition-all"
          >
            <Radio className="h-3.5 w-3.5" />
            <span>Aufnahmesteuerung</span>
          </Link>
        </div>
      </div>
    </>
  );
}
