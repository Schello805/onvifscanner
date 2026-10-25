"use client";

import Link from "next/link";
import { Film, Play, Download, Trash2, RefreshCw, Clock, List, CheckSquare, Square, ChevronLeft, ChevronRight, Radio } from "lucide-react";
import { formatSeconds, formatBytes } from "@/components/playback/playbackUtils";
import { LazyVideoThumb } from "@/components/playback/LazyVideoThumb";
import type { PlaybackState } from "./usePlaybackPage";

export function ClipList({ pb }: { pb: PlaybackState }) {
  const { cameras, loadingClips, searchQuery, viewMode, selectedClipIds, pageSize, setPageSize, currentPage, setCurrentPage, toggleTableSort, sortIndicator, filteredClips, totalPages, currentPageClips, openClip, handleDeleteClip, toggleSelectClip, toggleSelectAllVisible } = pb;
  return (
    <>
      {/* Main Content Area: List vs Grid */}
      {loadingClips ? (
        <div className="flex flex-col items-center justify-center p-16 text-slate-400">
          <RefreshCw className="h-8 w-8 animate-spin text-amber-400 mb-3" />
          <p className="text-sm">Lade archivierte Videosegmente...</p>
        </div>
      ) : filteredClips.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-950/40 p-16 text-center">
          <Film className="mx-auto h-12 w-12 text-slate-600 mb-3" />
          <h3 className="text-base font-semibold text-white">Keine Aufnahmen gefunden</h3>
          <p className="text-sm text-slate-400 mt-1 max-w-md mx-auto">
            {searchQuery
              ? `Keine Treffer für "${searchQuery}". Versuche einen anderen Suchbegriff.`
              : "Für den gewählten Filter wurden keine Aufnahmen gefunden. Wähle ein anderes Datum oder 'Alle Tage'."}
          </p>
          <div className="mt-4">
            <Link
              href="/recordings"
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3.5 py-2 text-xs font-semibold text-rose-300 hover:bg-rose-500/20"
            >
              <Radio className="h-3.5 w-3.5" />
              Zur Aufnahme-Konfiguration
            </Link>
          </div>
        </div>
      ) : viewMode === "list" ? (
        /* KOMPAKTE TABELLEN- / LISTENANSICHT */
        <div className="rounded-xl border border-slate-800 bg-slate-900/90 shadow-md overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300 border-collapse">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/80 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  <th className="py-2.5 px-3 w-10 text-center">
                    <button
                      onClick={toggleSelectAllVisible}
                      title="Alle auf dieser Seite auswählen"
                      className="text-slate-400 hover:text-white"
                    >
                      {selectedClipIds.size > 0 && selectedClipIds.size >= currentPageClips.length ? (
                        <CheckSquare className="h-4 w-4 text-amber-400" />
                      ) : (
                        <Square className="h-4 w-4" />
                      )}
                    </button>
                  </th>
                  <th className="py-2.5 px-3 w-12 text-center">Play</th>
                  <th className="py-2.5 px-3">
                    <button
                      type="button"
                      onClick={() => toggleTableSort("camera-asc", "camera-desc")}
                      className="inline-flex items-center gap-1 hover:text-white"
                      title="Nach Kameraname sortieren"
                    >
                      Kamera <span aria-hidden="true">{sortIndicator("camera-asc", "camera-desc")}</span>
                    </button>
                  </th>
                  <th className="py-2.5 px-3">
                    <button
                      type="button"
                      onClick={() => toggleTableSort("oldest", "newest")}
                      className="inline-flex items-center gap-1 hover:text-white"
                      title="Nach Aufnahmezeit sortieren"
                    >
                      Aufnahmezeit <span aria-hidden="true">{sortIndicator("oldest", "newest")}</span>
                    </button>
                  </th>
                  <th className="py-2.5 px-3">
                    <span className="text-slate-400">Aufnahmetyp</span>
                  </th>
                  <th className="py-2.5 px-3">
                    <button
                      type="button"
                      onClick={() => toggleTableSort("smallest", "largest")}
                      className="inline-flex items-center gap-1 hover:text-white"
                      title="Nach Dateigröße sortieren"
                    >
                      Größe <span aria-hidden="true">{sortIndicator("smallest", "largest")}</span>
                    </button>
                  </th>
                  <th className="py-2.5 px-3 hidden md:table-cell">
                    <button
                      type="button"
                      onClick={() => toggleTableSort("storage-asc", "storage-desc")}
                      className="inline-flex items-center gap-1 hover:text-white"
                      title="Nach Speicherort sortieren"
                    >
                      Speicherort <span aria-hidden="true">{sortIndicator("storage-asc", "storage-desc")}</span>
                    </button>
                  </th>
                  <th className="py-2.5 px-3 hidden lg:table-cell">
                    <button
                      type="button"
                      onClick={() => toggleTableSort("filename-asc", "filename-desc")}
                      className="inline-flex items-center gap-1 hover:text-white"
                      title="Nach Dateiname sortieren"
                    >
                      Dateiname <span aria-hidden="true">{sortIndicator("filename-asc", "filename-desc")}</span>
                    </button>
                  </th>
                  <th className="sticky right-0 z-10 bg-slate-950 py-2.5 px-3 text-right shadow-[-8px_0_12px_rgba(2,6,23,0.65)]">Aktionen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {currentPageClips.map((clip) => {
                  const isSelected = selectedClipIds.has(clip.id);
                  return (
                    <tr
                      key={clip.id}
                      className={`hover:bg-slate-800/50 transition-colors ${
                        isSelected ? "bg-amber-950/20" : ""
                      }`}
                    >
                      {/* Checkbox */}
                      <td className="py-2 px-3 text-center">
                        <button
                          onClick={() => toggleSelectClip(clip.id)}
                          className="text-slate-400 hover:text-white"
                        >
                          {isSelected ? (
                            <CheckSquare className="h-4 w-4 text-amber-400" />
                          ) : (
                            <Square className="h-4 w-4" />
                          )}
                        </button>
                      </td>

                      {/* Play Button & Thumbnail */}
                      <td className="py-2 px-3">
                        <div className="relative h-12 w-20 bg-slate-900 rounded overflow-hidden group/thumb flex items-center justify-center shrink-0 border border-slate-700/50">
                          <LazyVideoThumb
                            src={`${clip.streamUrl}#t=0.1`}
                            className="absolute inset-0 w-full h-full object-cover opacity-60 group-hover/thumb:opacity-100 transition-opacity"
                          />
                          <button
                            onClick={() => openClip(clip)}
                            className="relative z-10 inline-flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/90 text-slate-950 hover:bg-amber-400 hover:scale-105 active:scale-95 transition-all shadow-sm font-bold opacity-0 group-hover/thumb:opacity-100"
                            title="Abspielen"
                          >
                            <Play className="h-3 w-3 fill-current ml-0.5" />
                          </button>
                        </div>
                      </td>

                      {/* Kamera */}
                      <td className="py-2 px-3">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-semibold text-white truncate max-w-[180px]">
                            {clip.cameraName}
                          </span>
                          {cameras.find((c) => c.id === clip.cameraId)?.recordEnabled && (
                            <span
                              className="shrink-0 inline-flex items-center gap-1 rounded bg-rose-500/25 border border-rose-500/40 px-1.5 py-0.5 text-[9px] font-bold text-rose-300"
                              title="Diese Kamera zeichnet aktuell auf"
                            >
                              <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse"></span>
                              REC
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Zeit */}
                      <td className="py-2 px-3">
                        <div className="flex items-center gap-1.5 text-slate-200 font-mono text-[11px]">
                          <Clock className="h-3 w-3 text-slate-500 shrink-0" />
                          <span>{clip.timeStr}</span>
                          <span className="text-slate-500 text-[10px]">({clip.dateStr})</span>
                        </div>
                      </td>

                      {/* Bewegung */}
                      <td className="py-2 px-3">
                        <button
                          onClick={() => openClip(clip)}
                          className="inline-flex items-center gap-1 rounded-md bg-sky-500/10 border border-sky-500/30 px-2 py-0.5 text-[11px] font-semibold text-sky-300 hover:bg-sky-500/20 transition-colors group/d w-fit cursor-pointer"
                          title="Klick zum Abspielen dieser Daueraufnahme"
                        >
                          <Film className="h-3 w-3 text-sky-400 group-hover/d:scale-110 transition-transform" />
                          <span>Daueraufnahme{clip.durationSeconds ? ` (${Math.round(clip.durationSeconds / 60)}m)` : ""}</span>
                        </button>
                      </td>

                      {/* Größe */}
                      <td className="py-2 px-3">
                        <span className="font-mono text-slate-300 font-medium">
                          {formatBytes(clip.sizeBytes)}
                        </span>
                      </td>

                      {/* Speicher */}
                      <td className="py-2 px-3 hidden md:table-cell">
                        <span className="rounded bg-slate-800/80 px-2 py-0.5 text-[10px] text-slate-300 border border-slate-700/60">
                          {clip.storageTargetName}
                        </span>
                      </td>

                      {/* Dateiname */}
                      <td className="py-2 px-3 hidden lg:table-cell">
                        <span className="text-slate-500 font-mono text-[10px] truncate block max-w-[180px]" title={clip.filename}>
                          {clip.filename}
                        </span>
                      </td>

                      {/* Aktionen */}
                      <td className="sticky right-0 z-10 bg-slate-900/95 py-2 px-2 text-right shadow-[-8px_0_12px_rgba(2,6,23,0.65)] backdrop-blur-sm sm:px-3">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            onClick={() => openClip(clip)}
                            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white transition-colors sm:h-auto sm:w-auto sm:p-1.5"
                            title="Abspielen"
                          >
                            <Play className="h-3.5 w-3.5" />
                          </button>
                          <a
                            href={clip.downloadUrl}
                            download={clip.filename}
                            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-sky-500/35 bg-sky-500/10 px-3 font-semibold text-sky-200 hover:bg-sky-500/20 hover:text-white transition-colors sm:h-auto sm:border-0 sm:bg-transparent sm:p-1.5 sm:text-slate-300"
                            title="Clip herunterladen"
                          >
                            <Download className="h-3.5 w-3.5" />
                            <span className="sm:hidden">Download</span>
                          </a>
                          <button
                            onClick={() => handleDeleteClip(clip)}
                            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-950/60 hover:text-rose-400 transition-colors sm:h-auto sm:w-auto sm:p-1.5"
                            title="Löschen"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* KOMPAKTE KARTENANSICHT */
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {currentPageClips.map((clip) => {
            const isSelected = selectedClipIds.has(clip.id);
            return (
              <div
                key={clip.id}
                className={`group relative flex flex-col justify-between rounded-xl border bg-slate-900/90 p-3 shadow-sm hover:border-slate-700 transition-all ${
                  isSelected ? "border-amber-500/80 bg-amber-950/10" : "border-slate-800"
                }`}
              >
                <div>
                  <div className="relative w-full h-28 bg-slate-900 rounded-lg overflow-hidden mb-3 border border-slate-700/50 group/thumb flex items-center justify-center">
                    <LazyVideoThumb
                      src={`${clip.streamUrl}#t=0.1`}
                      className="absolute inset-0 w-full h-full object-cover opacity-60 group-hover/thumb:opacity-100 transition-opacity pointer-events-none"
                    />
                    <button
                      onClick={() => openClip(clip)}
                      className="relative z-10 inline-flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/90 text-slate-950 hover:bg-amber-400 hover:scale-105 active:scale-95 transition-all shadow-sm font-bold opacity-0 group-hover/thumb:opacity-100"
                      title="Abspielen"
                    >
                      <Play className="h-4 w-4 fill-current ml-1" />
                    </button>
                  </div>
                  <div className="flex items-start justify-between gap-1.5 mb-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <button
                        onClick={() => toggleSelectClip(clip.id)}
                        className="text-slate-400 hover:text-white shrink-0"
                      >
                        {isSelected ? (
                          <CheckSquare className="h-3.5 w-3.5 text-amber-400" />
                        ) : (
                          <Square className="h-3.5 w-3.5" />
                        )}
                      </button>
                      <h4 className="text-xs font-bold text-white truncate" title={clip.cameraName}>
                        {clip.cameraName}
                      </h4>
                      {cameras.find((c) => c.id === clip.cameraId)?.recordEnabled && (
                        <span
                          className="shrink-0 inline-flex items-center gap-1 rounded bg-rose-500/25 border border-rose-500/40 px-1 py-0.2 text-[9px] font-bold text-rose-300"
                          title="Diese Kamera zeichnet aktuell auf"
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse"></span>
                          REC
                        </span>
                      )}
                    </div>
                    <span className="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono text-slate-300">
                      {formatBytes(clip.sizeBytes)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono py-1 border-t border-slate-800/60">
                    <span className="flex items-center gap-1 text-white">
                      <Clock className="h-3 w-3 text-slate-500" />
                      {clip.timeStr} Uhr
                    </span>
                    <span className="text-slate-500 text-[10px]">{clip.dateStr}</span>
                  </div>

                  <button
                    onClick={() => openClip(clip)}
                    className="w-full flex items-center justify-between text-[10px] text-sky-300 bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/25 rounded px-2 py-1 mt-1.5 text-left transition-colors cursor-pointer group/d"
                    title="Klick zum Abspielen dieser Daueraufnahme"
                  >
                    <span className="flex items-center gap-1 font-semibold">
                      <Film className="h-2.5 w-2.5 text-sky-400 group-hover/d:scale-110 transition-transform shrink-0" />
                      Daueraufnahme
                    </span>
                    <span className="text-slate-400 font-mono">
                      {clip.durationSeconds ? `${Math.round(clip.durationSeconds / 60)} Min.` : "15 Min."}
                    </span>
                  </button>

                  <div className="text-[10px] text-slate-500 truncate mt-1">
                    Speicher: <span className="text-slate-400">{clip.storageTargetName}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-1.5 pt-2.5 border-t border-slate-800/80 mt-2">
                  <button
                    onClick={() => openClip(clip)}
                    className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 px-2 py-1 text-xs font-bold shadow-sm active:scale-95 transition-all"
                  >
                    <Play className="h-3 w-3 fill-current" />
                    Play
                  </button>

                  <a
                    href={clip.downloadUrl}
                    download={clip.filename}
                    className="flex-1 inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-sky-500/35 bg-sky-500/10 px-2 py-1 text-xs font-semibold text-sky-200 hover:bg-sky-500/20 hover:text-white transition-colors"
                    title="Clip herunterladen"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download
                  </a>

                  <button
                    onClick={() => handleDeleteClip(clip)}
                    className="rounded p-1.5 border border-slate-800 bg-slate-950 text-slate-400 hover:text-rose-400 hover:bg-rose-950/60 transition-colors"
                    title="Löschen"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {/* Pagination Footer */}
      {filteredClips.length > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-slate-800/80 pt-3 text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <span>Zeige</span>
            <select
              value={pageSize}
              onChange={(e) => {
                const val = e.target.value === "all" ? "all" : Number(e.target.value);
                setPageSize(val);
                setCurrentPage(1);
              }}
              className="rounded border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-white focus:outline-none"
            >
              <option value="25">25 pro Seite</option>
              <option value="50">50 pro Seite</option>
              <option value="100">100 pro Seite</option>
              <option value="all">Alle anzeigen ({filteredClips.length})</option>
            </select>
            <span>von {filteredClips.length} Segmenten</span>
          </div>

          {pageSize !== "all" && totalPages > 1 && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="rounded border border-slate-800 bg-slate-950 p-1.5 text-slate-400 hover:text-white disabled:opacity-30 disabled:pointer-events-none"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="px-2 font-mono text-slate-300">
                Seite {currentPage} / {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="rounded border border-slate-800 bg-slate-950 p-1.5 text-slate-400 hover:text-white disabled:opacity-30 disabled:pointer-events-none"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
