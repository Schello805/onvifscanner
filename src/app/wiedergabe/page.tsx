"use client";

import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import Link from "next/link";
import {
  Film,
  Play,
  Pause,
  Download,
  Trash2,
  RefreshCw,
  Calendar,
  Clock,
  ChevronDown,
  ChevronUp,
  X,
  Maximize2,
  Minimize2,
  RotateCcw,
  RotateCw,
  Search,
  List,
  LayoutGrid,
  ArrowUpDown,
  CheckSquare,
  Square,
  ChevronLeft,
  ChevronRight,
  Video,
  Radio,
  HardDrive,
  SkipBack,
  SkipForward,
  Gauge,
  SlidersHorizontal,
} from "lucide-react";
import { useToast } from "@/components/ToastProvider";

type CameraSimple = {
  id: string;
  name: string;
  ip: string;
  recordEnabled?: boolean;
};

type RecordingClip = {
  id: string;
  cameraId: string;
  cameraName: string;
  filename: string;
  dateStr: string;
  timeStr: string;
  timestamp: string;
  sizeBytes: number;
  storageTargetName: string;
  streamUrl: string;
  downloadUrl: string;
};

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(2)} GB`;
  }
  return `${mb.toFixed(1)} MB`;
}

function getTodayStr(): string {
  const now = new Date();
  return now.toISOString().slice(0, 10);
}

function getYesterdayStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

export default function PlaybackPage() {
  const { toast } = useToast();
  const [cameras, setCameras] = useState<CameraSimple[]>([]);
  const [clips, setClips] = useState<RecordingClip[]>([]);
  const [loadingClips, setLoadingClips] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filters & Search
  const [selectedCameraId, setSelectedCameraId] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState<string>(getTodayStr());
  const [timeFrom, setTimeFrom] = useState<string>("");
  const [timeTo, setTimeTo] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "largest" | "smallest">("newest");
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");

  // Clip Selection & Batch Delete
  const [selectedClipIds, setSelectedClipIds] = useState<Set<string>>(new Set());
  const [deletingBatch, setDeletingBatch] = useState(false);

  // Pagination
  const [pageSize, setPageSize] = useState<number | "all">(50);
  const [currentPage, setCurrentPage] = useState(1);

  // Active Video Player Modal State
  const [activeClip, setActiveClip] = useState<RecordingClip | null>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [playerFullscreen, setPlayerFullscreen] = useState(false);
  const [autoPlayNext, setAutoPlayNext] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerContainerRef = useRef<HTMLDivElement>(null);

  const fetchCameras = async () => {
    try {
      const res = await fetch("/api/nvr/cameras", { cache: "no-store" });
      const data = await res.json();
      if (data.cameras) {
        setCameras(
          data.cameras.map((c: any) => ({
            id: c.id,
            name: c.name,
            ip: c.ip,
            recordEnabled: Boolean(c.recordEnabled),
          }))
        );
      }
    } catch {}
  };

  const fetchClips = useCallback(async (camId = selectedCameraId, date = selectedDate) => {
    try {
      setRefreshing(true);
      const params = new URLSearchParams();
      if (camId) params.set("cameraId", camId);
      if (date) params.set("date", date);

      const res = await fetch(`/api/nvr/recordings?${params.toString()}`, { cache: "no-store" });
      const data = await res.json();
      if (data.clips) {
        setClips(data.clips);
        setSelectedClipIds(new Set());
        setCurrentPage(1);
      }
    } catch {
      toast.error("Fehler beim Laden der Aufnahmen.");
    } finally {
      setLoadingClips(false);
      setRefreshing(false);
    }
  }, [selectedCameraId, selectedDate, toast]);

  useEffect(() => {
    let initialCamId = "";
    if (typeof window !== "undefined") {
      const q = new URLSearchParams(window.location.search).get("cameraId");
      if (q) {
        initialCamId = q;
        setSelectedCameraId(q);
      }
    }
    fetchCameras();
    fetchClips(initialCamId, getTodayStr());
  }, [fetchClips]);

  // Filtered & Sorted Clips
  const filteredClips = useMemo(() => {
    let result = [...clips];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (c) =>
          c.cameraName.toLowerCase().includes(q) ||
          c.filename.toLowerCase().includes(q) ||
          c.timeStr.toLowerCase().includes(q) ||
          c.dateStr.toLowerCase().includes(q) ||
          c.storageTargetName.toLowerCase().includes(q)
      );
    }
    if (timeFrom) {
      const tFrom = timeFrom.length === 5 ? `${timeFrom}:00` : timeFrom;
      if (timeTo) {
        const tTo = timeTo.length === 5 ? `${timeTo}:59` : timeTo;
        if (tFrom <= tTo) {
          result = result.filter((c) => c.timeStr >= tFrom && c.timeStr <= tTo);
        } else {
          result = result.filter((c) => c.timeStr >= tFrom || c.timeStr <= tTo);
        }
      } else {
        result = result.filter((c) => c.timeStr >= tFrom);
      }
    } else if (timeTo) {
      const tTo = timeTo.length === 5 ? `${timeTo}:59` : timeTo;
      result = result.filter((c) => c.timeStr <= tTo);
    }

    if (sortBy === "newest") {
      result.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    } else if (sortBy === "oldest") {
      result.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    } else if (sortBy === "largest") {
      result.sort((a, b) => b.sizeBytes - a.sizeBytes);
    } else if (sortBy === "smallest") {
      result.sort((a, b) => a.sizeBytes - b.sizeBytes);
    }
    return result;
  }, [clips, searchQuery, timeFrom, timeTo, sortBy]);

  // Clips for 24h Timeline (clips matching selected date and selected camera)
  const timelineClips = useMemo(() => {
    let list = clips;
    if (selectedDate) {
      list = list.filter((c) => c.dateStr === selectedDate);
    }
    if (selectedCameraId) {
      list = list.filter((c) => c.cameraId === selectedCameraId);
    }
    return list;
  }, [clips, selectedDate, selectedCameraId]);

  // Pagination
  const totalPages = pageSize === "all" ? 1 : Math.ceil(filteredClips.length / Number(pageSize)) || 1;
  const currentPageClips = useMemo(() => {
    if (pageSize === "all") return filteredClips;
    const size = Number(pageSize);
    const start = (currentPage - 1) * size;
    return filteredClips.slice(start, start + size);
  }, [filteredClips, pageSize, currentPage]);

  // Single Clip Deletion
  const handleDeleteClip = async (clip: RecordingClip) => {
    if (!confirm(`Aufnahme "${clip.filename}" wirklich löschen?`)) return;
    try {
      const res = await fetch(`/api/nvr/recordings?clipId=${encodeURIComponent(clip.id)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        toast.success(`Aufnahme ${clip.filename} gelöscht.`);
        setClips((prev) => prev.filter((c) => c.id !== clip.id));
        setSelectedClipIds((prev) => {
          const next = new Set(prev);
          next.delete(clip.id);
          return next;
        });
        if (activeClip?.id === clip.id) {
          setActiveClip(null);
        }
      } else {
        const data = await res.json();
        throw new Error(data.error || "Löschen fehlgeschlagen");
      }
    } catch (err: any) {
      toast.error(err.message || "Fehler beim Löschen.");
    }
  };

  // Batch Delete Selected Clips
  const handleDeleteBatch = async () => {
    if (selectedClipIds.size === 0) return;
    const count = selectedClipIds.size;
    if (!confirm(`${count} ausgewählte Aufnahme(n) wirklich unwiderruflich löschen?`)) {
      return;
    }
    setDeletingBatch(true);
    try {
      const res = await fetch("/api/nvr/recordings", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clipIds: Array.from(selectedClipIds) }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message || `${count} Aufnahmen gelöscht.`);
        setClips((prev) => prev.filter((c) => !selectedClipIds.has(c.id)));
        setSelectedClipIds(new Set());
      } else {
        throw new Error(data.error || "Löschen fehlgeschlagen");
      }
    } catch (err: any) {
      toast.error(err.message || "Fehler beim Löschen der Aufnahmen.");
    } finally {
      setDeletingBatch(false);
    }
  };

  const toggleSelectClip = (id: string) => {
    setSelectedClipIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllVisible = () => {
    if (selectedClipIds.size >= currentPageClips.length && currentPageClips.length > 0) {
      setSelectedClipIds(new Set());
    } else {
      const next = new Set(selectedClipIds);
      for (const c of currentPageClips) next.add(c.id);
      setSelectedClipIds(next);
    }
  };

  // Seek & Player Controls
  const seekRelative = (seconds: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime + seconds);
    }
  };

  const setSpeed = (rate: number) => {
    setPlaybackRate(rate);
    if (videoRef.current) {
      videoRef.current.playbackRate = rate;
    }
  };

  // Active clip index in current filtered list
  const activeClipIndex = useMemo(() => {
    if (!activeClip) return -1;
    return filteredClips.findIndex((c) => c.id === activeClip.id);
  }, [activeClip, filteredClips]);

  const playPreviousClip = () => {
    if (activeClipIndex > 0) {
      setActiveClip(filteredClips[activeClipIndex - 1]);
    }
  };

  const playNextClip = () => {
    if (activeClipIndex >= 0 && activeClipIndex < filteredClips.length - 1) {
      setActiveClip(filteredClips[activeClipIndex + 1]);
    }
  };

  // Keyboard Shortcuts for Video Player
  useEffect(() => {
    if (!activeClip) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input
      if (["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }
      if (e.key === " " || e.key === "k") {
        e.preventDefault();
        if (videoRef.current) {
          if (videoRef.current.paused) {
            void videoRef.current.play();
            setIsPlaying(true);
          } else {
            videoRef.current.pause();
            setIsPlaying(false);
          }
        }
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        seekRelative(-5);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        seekRelative(5);
      } else if (e.key === "j") {
        seekRelative(-10);
      } else if (e.key === "l") {
        seekRelative(10);
      } else if (e.key === "f") {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.key === "Escape") {
        setActiveClip(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeClip]);

  const toggleFullscreen = () => {
    if (!playerContainerRef.current) return;
    if (!document.fullscreenElement) {
      void playerContainerRef.current.requestFullscreen().then(() => setPlayerFullscreen(true)).catch(() => null);
    } else {
      void document.exitFullscreen().then(() => setPlayerFullscreen(false)).catch(() => null);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2.5">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <Film className="h-5 w-5 text-amber-400" />
            Wiedergabe
          </h1>
          <span className="rounded-full bg-amber-500/10 border border-amber-500/25 px-2.5 py-0.5 text-xs font-semibold text-amber-300">
            {filteredClips.length} {filteredClips.length === 1 ? "Clip" : "Clips"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchClips(selectedCameraId, selectedDate)}
            disabled={refreshing}
            className="touch-manipulation inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 active:scale-95 transition-all"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin text-amber-400" : ""}`} />
            Aktualisieren
          </button>
          <Link
            href="/recordings"
            className="touch-manipulation inline-flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-200 hover:bg-rose-500/20 active:scale-95 transition-all"
          >
            <Radio className="h-3.5 w-3.5" />
            Aufnahmesteuerung
          </Link>
        </div>
      </div>

      {/* Filter Toolbar Bar */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-3.5 shadow-md space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            {/* Search Input */}
            <div className="relative min-w-[180px] sm:min-w-[220px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Suche (Kamera, Uhrzeit, Datei)..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full rounded-lg border border-slate-800 bg-slate-950 pl-8 pr-7 py-1.5 text-xs text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Camera Filter */}
            <div className="flex items-center gap-1">
              <Video className="h-3.5 w-3.5 text-slate-400" />
              <select
                value={selectedCameraId}
                onChange={(e) => {
                  setSelectedCameraId(e.target.value);
                  fetchClips(e.target.value, selectedDate);
                }}
                className="rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:border-amber-500 focus:outline-none max-w-[160px] truncate"
              >
                <option value="">Alle Kameras</option>
                {cameras.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.recordEnabled ? `🔴 ${c.name} (REC)` : c.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Date Filter */}
            <div className="flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5 text-slate-400" />
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => {
                  setSelectedDate(e.target.value);
                  fetchClips(selectedCameraId, e.target.value);
                }}
                className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-1.5 text-xs text-white focus:border-amber-500 focus:outline-none"
              />
            </div>

            {/* Quick Date Pills */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  setSelectedDate(getTodayStr());
                  fetchClips(selectedCameraId, getTodayStr());
                }}
                className={`rounded-lg px-2 py-1 text-xs font-medium transition-all ${
                  selectedDate === getTodayStr()
                    ? "bg-amber-600 text-white font-semibold"
                    : "border border-slate-800 bg-slate-950 text-slate-400 hover:text-white"
                }`}
              >
                Heute
              </button>
              <button
                onClick={() => {
                  setSelectedDate(getYesterdayStr());
                  fetchClips(selectedCameraId, getYesterdayStr());
                }}
                className={`rounded-lg px-2 py-1 text-xs font-medium transition-all ${
                  selectedDate === getYesterdayStr()
                    ? "bg-amber-600 text-white font-semibold"
                    : "border border-slate-800 bg-slate-950 text-slate-400 hover:text-white"
                }`}
              >
                Gestern
              </button>
              <button
                onClick={() => {
                  setSelectedDate("");
                  fetchClips(selectedCameraId, "");
                }}
                className={`rounded-lg px-2 py-1 text-xs font-medium transition-all ${
                  selectedDate === ""
                    ? "bg-amber-600 text-white font-semibold"
                    : "border border-slate-800 bg-slate-950 text-slate-400 hover:text-white"
                }`}
              >
                Alle Tage
              </button>
            </div>
          </div>

          {/* View Mode & Sort Controls */}
          <div className="flex items-center gap-2">
            {/* Sort Dropdown */}
            <div className="flex items-center gap-1">
              <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-1.5 text-xs text-white focus:outline-none"
              >
                <option value="newest">Neueste zuerst</option>
                <option value="oldest">Älteste zuerst</option>
                <option value="largest">Größte zuerst</option>
                <option value="smallest">Kleinste zuerst</option>
              </select>
            </div>

            {/* View Switcher: List vs Grid */}
            <div className="flex items-center rounded-lg border border-slate-800 bg-slate-950 p-0.5">
              <button
                onClick={() => setViewMode("list")}
                title="Kompakte Listenansicht"
                className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-all ${
                  viewMode === "list"
                    ? "bg-slate-800 text-white font-semibold"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <List className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Liste</span>
              </button>
              <button
                onClick={() => setViewMode("grid")}
                title="Kartenansicht"
                className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-all ${
                  viewMode === "grid"
                    ? "bg-slate-800 text-white font-semibold"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Karten</span>
              </button>
            </div>
          </div>
        </div>

        {/* Time Range Filter Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 pt-2.5 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 text-slate-400">
              <Clock className="h-3.5 w-3.5 text-amber-400" />
              <span className="font-medium text-slate-300">Uhrzeit:</span>
            </div>

            <div className="flex items-center gap-1">
              <input
                type="time"
                value={timeFrom}
                onChange={(e) => {
                  setTimeFrom(e.target.value);
                  setCurrentPage(1);
                }}
                className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-white focus:border-amber-500 focus:outline-none"
                title="Von Uhrzeit (z. B. 08:00)"
              />
              <span className="text-slate-500">–</span>
              <input
                type="time"
                value={timeTo}
                onChange={(e) => {
                  setTimeTo(e.target.value);
                  setCurrentPage(1);
                }}
                className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-white focus:border-amber-500 focus:outline-none"
                title="Bis Uhrzeit (z. B. 18:00)"
              />
            </div>

            {/* Quick Presets */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  setTimeFrom("06:00");
                  setTimeTo("12:00");
                  setCurrentPage(1);
                }}
                className={`rounded-lg px-2 py-0.5 text-[11px] font-medium transition-all ${
                  timeFrom === "06:00" && timeTo === "12:00"
                    ? "bg-amber-600 text-white font-semibold"
                    : "border border-slate-800 bg-slate-950 text-slate-400 hover:text-white"
                }`}
              >
                06–12 Uhr
              </button>
              <button
                type="button"
                onClick={() => {
                  setTimeFrom("12:00");
                  setTimeTo("18:00");
                  setCurrentPage(1);
                }}
                className={`rounded-lg px-2 py-0.5 text-[11px] font-medium transition-all ${
                  timeFrom === "12:00" && timeTo === "18:00"
                    ? "bg-amber-600 text-white font-semibold"
                    : "border border-slate-800 bg-slate-950 text-slate-400 hover:text-white"
                }`}
              >
                12–18 Uhr
              </button>
              <button
                type="button"
                onClick={() => {
                  setTimeFrom("18:00");
                  setTimeTo("23:59");
                  setCurrentPage(1);
                }}
                className={`rounded-lg px-2 py-0.5 text-[11px] font-medium transition-all ${
                  timeFrom === "18:00" && timeTo === "23:59"
                    ? "bg-amber-600 text-white font-semibold"
                    : "border border-slate-800 bg-slate-950 text-slate-400 hover:text-white"
                }`}
              >
                18–24 Uhr
              </button>
              <button
                type="button"
                onClick={() => {
                  setTimeFrom("00:00");
                  setTimeTo("06:00");
                  setCurrentPage(1);
                }}
                className={`rounded-lg px-2 py-0.5 text-[11px] font-medium transition-all ${
                  timeFrom === "00:00" && timeTo === "06:00"
                    ? "bg-amber-600 text-white font-semibold"
                    : "border border-slate-800 bg-slate-950 text-slate-400 hover:text-white"
                }`}
              >
                00–06 Uhr
              </button>
            </div>

            {(timeFrom || timeTo) && (
              <button
                type="button"
                onClick={() => {
                  setTimeFrom("");
                  setTimeTo("");
                  setCurrentPage(1);
                }}
                className="rounded-lg bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-[11px] font-medium text-amber-300 hover:bg-amber-500/25 transition-all"
              >
                ✕ Zeitfilter löschen
              </button>
            )}
          </div>

          <div className="text-[11px] text-slate-400">
            {filteredClips.length} {filteredClips.length === 1 ? "Aufnahme" : "Aufnahmen"}
          </div>
        </div>

        {/* Batch Action Bar (when clips are selected) */}
        {selectedClipIds.size > 0 && (
          <div className="flex items-center justify-between rounded-lg border border-rose-500/30 bg-rose-950/30 px-3 py-2 text-xs text-rose-200 animate-fadeIn">
            <div className="flex items-center gap-2 font-medium">
              <CheckSquare className="h-4 w-4 text-rose-400" />
              <span>{selectedClipIds.size} Aufnahme(n) markiert</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSelectedClipIds(new Set())}
                className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-slate-300 hover:text-white text-xs"
              >
                Auswahl aufheben
              </button>
              <button
                onClick={handleDeleteBatch}
                disabled={deletingBatch}
                className="inline-flex items-center gap-1.5 rounded bg-rose-600 px-2.5 py-1 text-white hover:bg-rose-500 text-xs font-semibold shadow-sm active:scale-95 transition-all"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {deletingBatch ? "Wird gelöscht..." : "Ausgewählte löschen"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Video Player Modal with Advanced NVR Controls */}
      {activeClip && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-2 sm:p-4 backdrop-blur-md">
          <div
            ref={playerContainerRef}
            className="relative w-full max-w-4xl rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl overflow-hidden flex flex-col"
          >
            {/* Player Header */}
            <div className="flex items-center justify-between p-3.5 border-b border-slate-800 bg-slate-900/80">
              <div className="min-w-0 pr-4">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-400 animate-pulse"></span>
                  <h3 className="text-sm font-bold text-white truncate">{activeClip.cameraName}</h3>
                  <span className="rounded bg-slate-800 px-2 py-0.5 text-[11px] font-mono text-slate-300">
                    {activeClip.timeStr} Uhr
                  </span>
                  {activeClipIndex >= 0 && (
                    <span className="text-[10px] text-slate-500 font-mono">
                      ({activeClipIndex + 1}/{filteredClips.length})
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-0.5 truncate">
                  Datum: {activeClip.dateStr} · Größe: {formatBytes(activeClip.sizeBytes)} · Speicher:{" "}
                  {activeClip.storageTargetName} · Datei: {activeClip.filename}
                </p>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={toggleFullscreen}
                  className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
                  title="Vollbild (Taste F)"
                >
                  {playerFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                </button>
                <a
                  href={activeClip.downloadUrl}
                  className="rounded-lg border border-slate-700 bg-slate-800 p-2 text-slate-300 hover:text-white transition-colors"
                  title="Download MP4"
                >
                  <Download className="h-4 w-4" />
                </a>
                <button
                  onClick={() => setActiveClip(null)}
                  className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
                  title="Schließen (Taste Esc)"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Video Element */}
            <div className="relative bg-black aspect-video flex items-center justify-center">
              <video
                ref={videoRef}
                key={activeClip.id}
                src={activeClip.streamUrl}
                controls
                autoPlay
                playsInline
                className="w-full h-full max-h-[70vh] object-contain"
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onEnded={() => {
                  if (autoPlayNext && activeClipIndex >= 0 && activeClipIndex < filteredClips.length - 1) {
                    playNextClip();
                  }
                }}
              />
            </div>

            {/* Advanced NVR Toolbar */}
            <div className="p-3 border-t border-slate-800 bg-slate-900/70 flex flex-wrap items-center justify-between gap-3 text-xs">
              {/* Skip Controls & Clip Step */}
              <div className="flex items-center gap-1.5">
                <button
                  onClick={playPreviousClip}
                  disabled={activeClipIndex <= 0}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-slate-300 hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none"
                  title="Vorheriger Clip"
                >
                  <SkipBack className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Vorheriger</span>
                </button>

                <button
                  onClick={() => seekRelative(-60)}
                  className="rounded-lg border border-slate-800 bg-slate-900 px-2 py-1.5 text-slate-300 hover:bg-slate-800"
                  title="-60 Sekunden"
                >
                  -60s
                </button>
                <button
                  onClick={() => seekRelative(-10)}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 px-2 py-1.5 text-slate-300 hover:bg-slate-800"
                  title="-10 Sekunden (Taste J)"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> -10s
                </button>
                <button
                  onClick={() => seekRelative(10)}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 px-2 py-1.5 text-slate-300 hover:bg-slate-800"
                  title="+10 Sekunden (Taste L)"
                >
                  <RotateCw className="h-3.5 w-3.5" /> +10s
                </button>
                <button
                  onClick={() => seekRelative(60)}
                  className="rounded-lg border border-slate-800 bg-slate-900 px-2 py-1.5 text-slate-300 hover:bg-slate-800"
                  title="+60 Sekunden"
                >
                  +60s
                </button>

                <button
                  onClick={playNextClip}
                  disabled={activeClipIndex < 0 || activeClipIndex >= filteredClips.length - 1}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-slate-300 hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none"
                  title="Nächster Clip"
                >
                  <span className="hidden sm:inline">Nächster</span>
                  <SkipForward className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Playback Speed & Auto-Play */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setAutoPlayNext(!autoPlayNext)}
                  className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                    autoPlayNext
                      ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm"
                      : "border border-slate-800 bg-slate-900 text-slate-400 hover:text-white"
                  }`}
                  title={autoPlayNext ? "Auto-Play aktiv: Nächster Clip startet automatisch" : "Auto-Play deaktiviert"}
                >
                  <span>🔁</span>
                  <span className="hidden sm:inline">Auto-Play</span>
                </button>

                <div className="flex items-center gap-1">
                  <Gauge className="h-3.5 w-3.5 text-slate-400" />
                  <span className="text-[11px] text-slate-400 mr-1 hidden sm:inline">Tempo:</span>
                  {[0.5, 1, 1.5, 2, 4].map((rate) => (
                    <button
                      key={rate}
                      onClick={() => setSpeed(rate)}
                      className={`rounded px-1.5 py-1 font-mono text-[11px] transition-all ${
                        playbackRate === rate
                          ? "bg-amber-500 text-slate-950 font-bold"
                          : "border border-slate-800 bg-slate-900 text-slate-300 hover:text-white"
                      }`}
                    >
                      {rate}x
                    </button>
                  ))}
                </div>
              </div>

              {/* Delete Clip */}
              <button
                onClick={() => handleDeleteClip(activeClip)}
                className="inline-flex items-center gap-1 rounded-lg border border-rose-900/50 bg-rose-950/30 px-3 py-1.5 text-rose-300 hover:bg-rose-900/50 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" /> Diesen Clip löschen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 24-Stunden Zeitstrahl (Timeline Scrubber) */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-3.5 sm:p-4 mb-6 shadow-lg backdrop-blur-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400">
              <Clock className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-white">24-Stunden Zeitstrahl</h2>
                <span className="rounded-full bg-slate-800 border border-slate-700 px-2 py-0.5 text-[11px] font-mono text-slate-300">
                  {selectedDate || "Alle Tage"}
                </span>
                {timelineClips.length > 0 && (
                  <span className="rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-0.5 text-[11px] font-medium">
                    {timelineClips.length} {timelineClips.length === 1 ? "Segment" : "Segmente"}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400">
                Klicke auf einen Zeitabschnitt zum Abspielen oder auf die Zeitachse zum Filtern.
              </p>
            </div>
          </div>

          {(timeFrom || timeTo) && (
            <button
              type="button"
              onClick={() => {
                setTimeFrom("");
                setTimeTo("");
              }}
              className="inline-flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 font-medium transition"
            >
              <RotateCcw className="h-3 w-3" />
              Zeitfilter zurücksetzen ({timeFrom || "00:00"} - {timeTo || "24:00"})
            </button>
          )}
        </div>

        {/* Timeline Bar Track */}
        <div
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const pct = Math.max(0, Math.min(1, clickX / rect.width));
            const totalMinutes = Math.floor(pct * 1440);
            const hour = Math.floor(totalMinutes / 60);
            const minute = Math.floor((totalMinutes % 60) / 15) * 15;
            const formatted = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
            setTimeFrom(formatted);
          }}
          className="relative h-11 sm:h-12 w-full rounded-xl bg-slate-950 border border-slate-800 overflow-hidden cursor-crosshair select-none group"
          title="Klicke auf die Zeitachse, um ab dieser Uhrzeit zu filtern"
        >
          {/* Subtle background hour stripes (12 2-hour segments) */}
          <div className="absolute inset-0 grid grid-cols-12 pointer-events-none opacity-20">
            {Array.from({ length: 12 }).map((_, i) => (
              <div
                key={i}
                className={`h-full border-r border-slate-700 ${i % 2 === 0 ? "bg-slate-800/30" : ""}`}
              />
            ))}
          </div>

          {/* Active Time Window Highlight if timeFrom / timeTo are set */}
          {timeFrom && (
            (() => {
              const [fH, fM] = timeFrom.split(":").map(Number);
              const [tH, tM] = (timeTo || "24:00").split(":").map(Number);
              const startMin = (isNaN(fH) ? 0 : fH) * 60 + (isNaN(fM) ? 0 : fM);
              const endMin = (isNaN(tH) ? 24 : tH) * 60 + (isNaN(tM) ? 0 : tM);
              const leftPct = (startMin / 1440) * 100;
              const widthPct = Math.max(1, ((endMin - startMin) / 1440) * 100);
              return (
                <div
                  className="absolute top-0 bottom-0 bg-amber-500/15 border-x border-amber-500/40 pointer-events-none z-0"
                  style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                />
              );
            })()
          )}

          {/* Recorded Clips as interactive blocks */}
          {timelineClips.map((clip) => {
            const timeParts = clip.timeStr.split(":").map(Number);
            const hh = isNaN(timeParts[0]) ? 0 : timeParts[0];
            const mm = isNaN(timeParts[1]) ? 0 : timeParts[1];
            const startMin = hh * 60 + mm;
            const leftPct = (startMin / 1440) * 100;
            // standard segment is ~15 min
            const widthPct = Math.max(0.6, (15 / 1440) * 100);
            const isCurrentPlaying = activeClip?.id === clip.id;

            return (
              <div
                key={clip.id}
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveClip(clip);
                  setIsPlaying(true);
                }}
                className={`absolute top-1 bottom-1 rounded transition-all cursor-pointer z-10 ${
                  isCurrentPlaying
                    ? "bg-cyan-400 ring-2 ring-white shadow-lg shadow-cyan-500/50 z-20"
                    : "bg-amber-500/85 hover:bg-amber-400 border border-amber-400/60 hover:scale-y-110 shadow-sm"
                }`}
                style={{
                  left: `${leftPct}%`,
                  width: `${widthPct}%`,
                  minWidth: "4px",
                }}
                title={`${clip.cameraName} · ${clip.timeStr} Uhr (${formatBytes(clip.sizeBytes)}) - Klick zum Abspielen`}
              />
            );
          })}

          {/* Indicator for currently playing clip */}
          {activeClip && (
            (() => {
              const timeParts = activeClip.timeStr.split(":").map(Number);
              const hh = isNaN(timeParts[0]) ? 0 : timeParts[0];
              const mm = isNaN(timeParts[1]) ? 0 : timeParts[1];
              const startMin = hh * 60 + mm;
              const leftPct = (startMin / 1440) * 100;
              return (
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-cyan-300 z-30 pointer-events-none shadow-[0_0_8px_#38bdf8]"
                  style={{ left: `${leftPct}%` }}
                >
                  <div className="absolute -top-1 -left-1.5 h-3.5 w-3.5 rounded-full bg-cyan-400 border border-white shadow-md animate-pulse" />
                </div>
              );
            })()
          )}
        </div>

        {/* 24h Ruler Axis (00:00 - 24:00) */}
        <div className="relative mt-1.5 flex justify-between text-[10px] font-mono text-slate-500 select-none">
          <span>00:00</span>
          <span>03:00</span>
          <span>06:00</span>
          <span>09:00</span>
          <span>12:00</span>
          <span>15:00</span>
          <span>18:00</span>
          <span>21:00</span>
          <span>24:00</span>
        </div>
      </div>

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
                  <th className="py-2.5 px-3">Kamera</th>
                  <th className="py-2.5 px-3">Aufnahmezeit</th>
                  <th className="py-2.5 px-3">Größe</th>
                  <th className="py-2.5 px-3 hidden md:table-cell">Speicherort</th>
                  <th className="py-2.5 px-3 hidden lg:table-cell">Dateiname</th>
                  <th className="py-2.5 px-3 text-right">Aktionen</th>
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

                      {/* Play Button */}
                      <td className="py-2 px-3 text-center">
                        <button
                          onClick={() => setActiveClip(clip)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/90 text-slate-950 hover:bg-amber-400 hover:scale-105 active:scale-95 transition-all shadow-sm font-bold"
                          title="Abspielen"
                        >
                          <Play className="h-3 w-3 fill-current ml-0.5" />
                        </button>
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
                      <td className="py-2 px-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            onClick={() => setActiveClip(clip)}
                            className="rounded p-1.5 text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
                            title="Abspielen"
                          >
                            <Play className="h-3.5 w-3.5" />
                          </button>
                          <a
                            href={clip.downloadUrl}
                            className="rounded p-1.5 text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
                            title="Download"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </a>
                          <button
                            onClick={() => handleDeleteClip(clip)}
                            className="rounded p-1.5 text-slate-400 hover:bg-rose-950/60 hover:text-rose-400 transition-colors"
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

                  <div className="text-[10px] text-slate-500 truncate mt-1">
                    Speicher: <span className="text-slate-400">{clip.storageTargetName}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-1.5 pt-2.5 border-t border-slate-800/80 mt-2">
                  <button
                    onClick={() => setActiveClip(clip)}
                    className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 px-2 py-1 text-xs font-bold shadow-sm active:scale-95 transition-all"
                  >
                    <Play className="h-3 w-3 fill-current" />
                    Play
                  </button>

                  <a
                    href={clip.downloadUrl}
                    className="rounded p-1.5 border border-slate-800 bg-slate-950 text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                    title="Download"
                  >
                    <Download className="h-3.5 w-3.5" />
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
    </div>
  );
}
