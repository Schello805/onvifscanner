"use client";

import { ChevronDown } from "lucide-react";
import { formatGermanDateLong } from "@/components/playback/playbackUtils";
import type { PlaybackState } from "./usePlaybackPage";

export function DailySummaryPanel({ pb }: { pb: PlaybackState }) {
  const { selectedCameraId, selectCameraFilter, selectedDate, dailySummary } = pb;
  return (
    <>
      {dailySummary && selectedDate && (
        <details className="group rounded-xl border border-cyan-500/20 bg-gradient-to-br from-cyan-950/20 to-slate-950 shadow-md sm:rounded-2xl">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-300">Tagesüberblick</p>
              <h2 className="text-sm font-bold text-white">{formatGermanDateLong(selectedDate)}</h2>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs font-semibold text-cyan-200">
                {dailySummary.totalEvents} Ereignisse
              </span>
              <ChevronDown className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-180" />
            </div>
          </summary>
          <div className="px-4 pb-4">
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["Personen", dailySummary.counts.person, "text-emerald-300"],
              ["Fahrzeuge", dailySummary.counts.vehicle, "text-sky-300"],
              ["Tiere", dailySummary.counts.animal, "text-amber-300"],
              ["Nur Bewegung", dailySummary.counts.unclassified, "text-slate-300"],
            ].map(([label, value, color]) => (
              <div key={String(label)} className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
                <div className={`text-xl font-bold ${color}`}>{value}</div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
              </div>
            ))}
          </div>
          {dailySummary.cameras.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">
                Kameras ({dailySummary.cameras.length})
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {dailySummary.cameras.map((camera) => (
                <button
                  key={camera.cameraId}
                  type="button"
                  onClick={() => selectCameraFilter(camera.cameraId)}
                  className={`min-w-0 rounded-lg border px-3 py-2 text-left transition hover:border-cyan-500/40 ${
                    selectedCameraId === camera.cameraId
                      ? "border-cyan-500/50 bg-cyan-500/10"
                      : "border-white/10 bg-white/[0.04]"
                  }`}
                >
                  <span className="block truncate text-xs font-semibold text-white">{camera.cameraName}</span>
                  <span className="block truncate text-[10px] text-slate-400">
                    {camera.events} Ereignisse · {camera.objects} Objekte
                  </span>
                </button>
              ))}
              </div>
            </div>
          )}
          </div>
        </details>
      )}
    </>
  );
}
