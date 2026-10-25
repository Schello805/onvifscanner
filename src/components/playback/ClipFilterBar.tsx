"use client";

import {
  ArrowUpDown,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  Clock,
  Gauge,
  HardDrive,
  LayoutGrid,
  List,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import type { ClipSizeFilter } from "./playbackTypes";
import type { PlaybackState } from "./usePlaybackPage";

const selectBox =
  "flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-xs";

/** Überschrift, Suche und Filter für die Clip-Liste. Erweiterte Filter sind einklappbar. */
export function ClipFilterBar({ pb }: { pb: PlaybackState }) {
  const {
    filteredClips,
    searchQuery,
    setSearchQuery,
    setCurrentPage,
    viewMode,
    setViewMode,
    mobileFiltersOpen,
    setMobileFiltersOpen,
    activeAdvancedFilterCount,
    timePreset,
    handleTimePresetChange,
    timeFrom,
    setTimeFrom,
    timeTo,
    setTimeTo,
    storageFilter,
    setStorageFilter,
    availableStorageTargets,
    sizeFilter,
    setSizeFilter,
    sortBy,
    setSortBy,
    selectedClipIds,
    setSelectedClipIds,
    handleDeleteBatch,
    deletingBatch,
  } = pb;

  return (
    <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/80 p-3 shadow-md sm:rounded-2xl sm:p-4">
      {/* Titel + Suche + Ansicht */}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto flex items-center gap-2 text-sm font-bold text-white">
          Aufnahmen
          <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-300">
            {filteredClips.length}
          </span>
        </h2>

        <div className="relative order-last w-full sm:order-none sm:w-64">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Clip oder Kamera suchen..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentPage(1);
            }}
            className="w-full rounded-lg border border-slate-800 bg-slate-950 py-1.5 pl-8 pr-7 text-xs text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
              aria-label="Suche leeren"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center rounded-lg border border-slate-800 bg-slate-950 p-0.5">
          {(
            [
              { id: "list", label: "Liste", Icon: List },
              { id: "grid", label: "Karten", Icon: LayoutGrid },
            ] as const
          ).map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setViewMode(id)}
              title={label}
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-all ${
                viewMode === id ? "bg-slate-800 font-semibold text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setMobileFiltersOpen((open) => !open)}
          aria-expanded={mobileFiltersOpen}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition ${
            mobileFiltersOpen || activeAdvancedFilterCount > 0
              ? "border-amber-500/50 bg-amber-500/10 text-amber-200"
              : "border-slate-700 bg-slate-950 text-slate-200 hover:bg-slate-800"
          }`}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Filter{activeAdvancedFilterCount > 0 ? ` (${activeAdvancedFilterCount})` : ""}
          {mobileFiltersOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* Erweiterte Filter */}
      {mobileFiltersOpen && (
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-800 pt-3">
          <div className={selectBox}>
            <Clock className="h-3.5 w-3.5 shrink-0 text-amber-400" />
            <select
              value={timePreset}
              onChange={(e) => handleTimePresetChange(e.target.value)}
              className="cursor-pointer bg-transparent text-xs text-white focus:outline-none"
              aria-label="Tageszeit"
            >
              <option value="all">Ganzer Tag (00–24 Uhr)</option>
              <option value="morning">🌅 Vormittag (06–12 Uhr)</option>
              <option value="afternoon">☀️ Nachmittag (12–18 Uhr)</option>
              <option value="evening">🌙 Abend (18–24 Uhr)</option>
              <option value="night">🌌 Nacht (00–06 Uhr)</option>
              <option value="custom">⚙️ Eigene Uhrzeit...</option>
            </select>
            {timePreset === "custom" && (
              <div className="ml-1 flex items-center gap-1">
                <input
                  type="time"
                  value={timeFrom}
                  onChange={(e) => {
                    setTimeFrom(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="rounded border border-slate-700 bg-slate-900 px-1 text-xs text-white"
                />
                <span className="text-slate-500">–</span>
                <input
                  type="time"
                  value={timeTo}
                  onChange={(e) => {
                    setTimeTo(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="rounded border border-slate-700 bg-slate-900 px-1 text-xs text-white"
                />
              </div>
            )}
          </div>

          <div className={selectBox}>
            <HardDrive className="h-3.5 w-3.5 shrink-0 text-sky-400" />
            <select
              value={storageFilter}
              onChange={(event) => {
                setStorageFilter(event.target.value);
                setCurrentPage(1);
              }}
              className="max-w-[150px] cursor-pointer bg-transparent text-xs text-white focus:outline-none"
              aria-label="Nach Speicherort filtern"
            >
              <option value="">Alle Speicherorte</option>
              {availableStorageTargets.map((target) => (
                <option key={target} value={target}>
                  {target}
                </option>
              ))}
            </select>
          </div>

          <div className={selectBox}>
            <Gauge className="h-3.5 w-3.5 shrink-0 text-violet-400" />
            <select
              value={sizeFilter}
              onChange={(event) => {
                setSizeFilter(event.target.value as ClipSizeFilter);
                setCurrentPage(1);
              }}
              className="cursor-pointer bg-transparent text-xs text-white focus:outline-none"
              aria-label="Nach Dateigröße filtern"
            >
              <option value="all">Alle Größen</option>
              <option value="under-25">Unter 25 MB</option>
              <option value="25-100">25–100 MB</option>
              <option value="100-500">100–500 MB</option>
              <option value="over-500">Ab 500 MB</option>
            </select>
          </div>

          <div className={selectBox}>
            <ArrowUpDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="cursor-pointer bg-transparent text-xs text-white focus:outline-none"
              aria-label="Sortierung"
            >
              <option value="newest">Neueste zuerst</option>
              <option value="oldest">Älteste zuerst</option>
              <option value="camera-asc">Kamera A–Z</option>
              <option value="camera-desc">Kamera Z–A</option>
              <option value="largest">Größte zuerst</option>
              <option value="smallest">Kleinste zuerst</option>
              <option value="storage-asc">Speicherort A–Z</option>
              <option value="storage-desc">Speicherort Z–A</option>
              <option value="filename-asc">Dateiname A–Z</option>
              <option value="filename-desc">Dateiname Z–A</option>
            </select>
          </div>
        </div>
      )}

      {/* Sammelaktionen */}
      {selectedClipIds.size > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-rose-500/30 bg-rose-950/30 px-3 py-2 text-xs text-rose-200">
          <div className="flex items-center gap-2 font-medium">
            <CheckSquare className="h-4 w-4 text-rose-400" />
            <span>{selectedClipIds.size} Aufnahme(n) markiert</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedClipIds(new Set())}
              className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:text-white"
            >
              Auswahl aufheben
            </button>
            <button
              type="button"
              onClick={handleDeleteBatch}
              disabled={deletingBatch}
              className="inline-flex items-center gap-1.5 rounded bg-rose-600 px-2.5 py-1 text-xs font-semibold text-white shadow-sm transition-all hover:bg-rose-500 active:scale-95"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {deletingBatch ? "Wird gelöscht..." : "Ausgewählte löschen"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
