"use client";

import { BarChart3, RefreshCw, X, Zap, Clock, Award, Video } from "lucide-react";
import type { ActivityStatsResponse } from "./playbackTypes";

type StatsPeriod = "today" | "yesterday" | "7d" | "30d" | "all";

type ActivityStatsModalProps = {
  isOpen: boolean;
  onClose: () => void;
  activityStats: ActivityStatsResponse | null;
  loadingStats: boolean;
  statsPeriod: StatsPeriod;
  onPeriodChange: (period: StatsPeriod) => void;
  onSelectCameraFilter: (cameraId: string) => void;
};

export function ActivityStatsModal({
  isOpen,
  onClose,
  activityStats,
  loadingStats,
  statsPeriod,
  onPeriodChange,
  onSelectCameraFilter,
}: ActivityStatsModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-3 sm:p-6 md:p-8 backdrop-blur-md overflow-y-auto">
      <div className="relative w-full max-w-4xl rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl overflow-hidden flex flex-col my-auto max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-900/90 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400">
              <BarChart3 className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white">Kamera-Aktivitätsauswertung</h3>
                <span className="rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 px-2 py-0.5 text-[10px] font-bold">
                  Bewegungserkennungen
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Rangliste der meist-aktiven Kameras, Spitzenzeiten und Erkennung von Fehlalarmen (z. B. Wind/Pflanzen).
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onPeriodChange(statsPeriod)}
              disabled={loadingStats}
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
              title="Neu laden"
            >
              <RefreshCw className={`h-4 w-4 ${loadingStats ? "animate-spin text-amber-400" : ""}`} />
            </button>
            <button
              onClick={onClose}
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
              title="Schließen (Esc)"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
          {/* Period Selector Tabs */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 bg-slate-900/60 border border-slate-800 p-1.5 rounded-xl">
            <div className="flex flex-wrap items-center gap-1">
              {(
                [
                  { id: "today", label: "Heute" },
                  { id: "yesterday", label: "Gestern" },
                  { id: "7d", label: "Letzte 7 Tage" },
                  { id: "30d", label: "Letzte 30 Tage" },
                  { id: "all", label: "Gesamt (Alle)" },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => onPeriodChange(tab.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    statsPeriod === tab.id
                      ? "bg-amber-500 text-slate-950 shadow-md font-bold"
                      : "text-slate-400 hover:text-white hover:bg-slate-800/80"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            {activityStats && (
              <span className="text-xs text-slate-400 font-mono pr-2">
                {activityStats.totalEvents} {activityStats.totalEvents === 1 ? "Erkennung" : "Erkennungen"} registriert
              </span>
            )}
          </div>

          {/* KPI Cards */}
          {activityStats && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3.5">
                <span className="text-[11px] font-medium text-slate-400 block mb-1">Gesamte Bewegungen</span>
                <span className="text-2xl font-extrabold text-white flex items-center gap-1.5">
                  <Zap className="h-5 w-5 text-amber-400 fill-amber-400" />
                  {activityStats.totalEvents}
                </span>
                <span className="text-[10px] text-slate-500 mt-0.5 block">
                  in {activityStats.activeCamerasCount} von {activityStats.totalCamerasCount} Kameras
                </span>
              </div>

              <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-3.5">
                <span className="text-[11px] font-medium text-amber-300/80 block mb-1">🥇 Aktivste Kamera</span>
                <span className="text-lg font-bold text-amber-200 truncate block">
                  {activityStats.ranking[0]?.count > 0 ? activityStats.ranking[0].cameraName : "–"}
                </span>
                <span className="text-[11px] text-amber-300/70 mt-0.5 block font-mono">
                  {activityStats.ranking[0]?.count > 0
                    ? `${activityStats.ranking[0].count}x (${activityStats.ranking[0].percentage}%)`
                    : "Keine Aktivität"}
                </span>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3.5">
                <span className="text-[11px] font-medium text-slate-400 block mb-1">Spitzen-Uhrzeit (Peak)</span>
                <span className="text-lg font-bold text-white truncate block">
                  {activityStats.peakHour || "–"}
                </span>
                <span className="text-[11px] text-slate-400 mt-0.5 block font-mono">
                  {activityStats.peakHourCount > 0 ? `${activityStats.peakHourCount} Bewegungen` : "–"}
                </span>
              </div>
            </div>
          )}

          {/* 24-Hour Activity Heatmap / Bar Distribution */}
          {activityStats && activityStats.totalEvents > 0 && (
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
              <div className="flex items-center justify-between mb-2.5">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-amber-400" />
                  Tagesverlauf (Erkennungen nach Uhrzeit 0:00 – 23:00 Uhr)
                </span>
                <span className="text-[10px] text-slate-400 font-mono">
                  Spitze: {activityStats.peakHourCount} in 1 Stunde
                </span>
              </div>
              <div className="flex items-end gap-1 h-16 w-full pt-2">
                {activityStats.overallHourly.map((count, hour) => {
                  const max = Math.max(1, ...activityStats.overallHourly);
                  const heightPct = count > 0 ? Math.max(12, Math.round((count / max) * 100)) : 4;
                  const isPeak = count === activityStats.peakHourCount && count > 0;
                  return (
                    <div
                      key={hour}
                      className="flex-1 flex flex-col items-center h-full justify-end group relative"
                    >
                      <div
                        style={{ height: `${heightPct}%` }}
                        className={`w-full rounded-t transition-all ${
                          isPeak
                            ? "bg-amber-400 shadow-md shadow-amber-400/40"
                            : count > 0
                            ? "bg-amber-500/70 group-hover:bg-amber-400"
                            : "bg-slate-800/40"
                        }`}
                      />
                      <span className="text-[8px] font-mono text-slate-500 mt-1 select-none">
                        {hour % 3 === 0 ? hour : ""}
                      </span>
                      {/* Tooltip */}
                      <div className="absolute bottom-full mb-1 hidden group-hover:flex flex-col items-center z-20 pointer-events-none">
                        <span className="bg-slate-950 border border-slate-700 text-white rounded px-1.5 py-0.5 text-[9px] font-mono whitespace-nowrap shadow-lg">
                          {hour}:00 Uhr: {count} {count === 1 ? "Bewegung" : "Bewegungen"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Camera Activity Ranking List */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-white flex items-center gap-1.5">
                <Award className="h-4 w-4 text-amber-400" />
                Kamera-Rangliste (Meist-aktive zuerst)
              </h4>
              <span className="text-xs text-slate-400">
                Klicke auf eine Kamera zum direkten Filtern
              </span>
            </div>

            {loadingStats ? (
              <div className="flex items-center justify-center p-8 text-slate-400 text-xs">
                <RefreshCw className="h-5 w-5 animate-spin text-amber-400 mr-2" />
                Lade Auswertung...
              </div>
            ) : !activityStats || activityStats.ranking.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400 rounded-xl border border-slate-800 bg-slate-900/30">
                Keine Kameras oder Bewegungserkennungen in diesem Zeitraum vorhanden.
              </div>
            ) : (
              <div className="grid gap-2.5">
                {activityStats.ranking.map((cam, idx) => {
                  const rankMedal = idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : `#${idx + 1}`;
                  return (
                    <div
                      key={cam.cameraId}
                      className={`rounded-xl border p-3.5 transition-all ${
                        cam.isHighActivity && cam.count >= 30
                          ? "border-amber-500/40 bg-gradient-to-r from-amber-950/20 to-slate-900/80"
                          : "border-slate-800 bg-slate-900/70 hover:border-slate-700"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="text-base font-bold w-6 text-center shrink-0">
                            {rankMedal}
                          </span>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-bold text-white truncate">
                                {cam.cameraName}
                              </span>
                              {cam.recordEnabled && (
                                <span className="rounded bg-rose-500/20 text-rose-300 border border-rose-500/40 px-1.5 py-0.2 text-[9px] font-bold">
                                  REC
                                </span>
                              )}
                              {cam.cameraIp && (
                                <span className="text-[11px] font-mono text-slate-400">
                                  ({cam.cameraIp})
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400 mt-0.5">
                              {cam.peakHour && (
                                <span>
                                  Peak: <strong className="text-slate-200">{cam.peakHour}</strong>
                                </span>
                              )}
                              {cam.lastEventAt && (
                                <span>
                                  · Letzte Erkennung:{" "}
                                  {new Date(cam.lastEventAt).toLocaleTimeString("de-DE", {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                    second: "2-digit",
                                    timeZone: "Europe/Berlin",
                                  })}{" "}
                                  Uhr
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() => onSelectCameraFilter(cam.cameraId)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-white px-2.5 py-1 text-xs font-semibold transition active:scale-95 shadow-sm"
                            title={`Nur Aufnahmen von ${cam.cameraName} anzeigen`}
                          >
                            <Video className="h-3 w-3 text-amber-400" />
                            <span>Aufnahmen filtern</span>
                          </button>

                          {cam.cameraIp && (
                            <a
                              href={`http://${cam.cameraIp}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-950/30 hover:bg-emerald-900/50 text-emerald-300 px-2.5 py-1 text-xs font-medium transition"
                              title="Weboberfläche öffnen, um Empfindlichkeit oder Zonen anzupassen"
                            >
                              <span>🌿 Weboberfläche</span>
                            </a>
                          )}
                        </div>
                      </div>

                      {/* Progress Bar & Percentage Pill */}
                      <div className="flex items-center gap-3 mt-2">
                        <div className="flex-1 h-3 rounded-full bg-slate-950 border border-slate-800 overflow-hidden shadow-inner">
                          <div
                            style={{ width: `${Math.min(100, cam.percentage)}%` }}
                            className={`h-full rounded-full transition-all duration-500 ${
                              idx === 0
                                ? "bg-gradient-to-r from-amber-500 to-amber-300"
                                : idx === 1
                                ? "bg-gradient-to-r from-sky-500 to-sky-400"
                                : "bg-slate-400"
                            }`}
                          />
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0 font-mono text-xs">
                          <span className="font-extrabold text-white">{cam.count}</span>
                          <span className="text-slate-400 text-[10px]">
                            {cam.count === 1 ? "Erkennung" : "Erkennungen"} ({cam.percentage}%)
                          </span>
                        </div>
                      </div>

                      {/* False Alarm Hint when high activity */}
                      {cam.isHighActivity && cam.count >= 40 && (
                        <div className="mt-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-1.5 flex items-center justify-between gap-2 text-[11px] text-amber-200">
                          <span>
                            ⚠️ <strong>Sehr hohe Aktivität:</strong> Wenn hier keine Personen unterwegs waren, bewegen sich vermutlich Pflanzen im Wind.
                          </span>
                          {cam.cameraIp && (
                            <a
                              href={`http://${cam.cameraIp}`}
                              target="_blank"
                              rel="noreferrer"
                              className="shrink-0 underline text-amber-300 hover:text-white font-semibold"
                            >
                              Empfindlichkeit in Kamera senken ➔
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
