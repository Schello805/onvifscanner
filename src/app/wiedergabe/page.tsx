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
  Zap,
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

type MotionEvent = {
  id: string;
  cameraId: string;
  cameraName: string;
  timestamp: string;
  dateStr?: string;
  timeStr: string;
  totalMinutes: number;
  message: string;
};

type ClipMotionEvent = {
  id: string;
  timeStr: string;
  offsetSec: number;
  message: string;
  pct: number;
};

function parseTimeToSeconds(timeStr: string): number {
  if (!timeStr) return 0;
  const parts = timeStr.split(":").map(Number);
  const h = isNaN(parts[0]) ? 0 : parts[0];
  const m = isNaN(parts[1]) ? 0 : parts[1];
  const s = isNaN(parts[2]) ? 0 : parts[2];
  return h * 3600 + m * 60 + s;
}

function formatSeconds(totalSec: number): string {
  if (isNaN(totalSec) || totalSec < 0) return "0:00";
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function getMotionEventsForClip(
  clip: RecordingClip,
  events: MotionEvent[],
  videoDuration = 0
): ClipMotionEvent[] {
  if (!clip || !events || events.length === 0) return [];
  const clipStartSec = parseTimeToSeconds(clip.timeStr);
  const maxDuration = videoDuration > 0 ? videoDuration : 900; // Standardsegment ca. 15 Min

  const matched: ClipMotionEvent[] = [];
  const seenSeconds = new Set<number>();

  for (const ev of events) {
    if (ev.cameraId && clip.cameraId && ev.cameraId !== clip.cameraId) {
      continue;
    }
    if (clip.dateStr && ev.dateStr && clip.dateStr !== ev.dateStr) {
      continue;
    }

    const evSec = parseTimeToSeconds(ev.timeStr);
    let offset = evSec - clipStartSec;

    // Tageswechsel-Kompensation (um Mitternacht)
    if (offset < -43200) offset += 86400;
    if (offset > 43200) offset -= 86400;

    // Toleranzbereich: Bis zu 2s vor Segmentstart oder 3s nach Segmentende
    if (offset >= -2 && offset <= maxDuration + 3) {
      const clampedOffset = Math.max(0, Math.min(maxDuration, offset));
      const roundedOffset = Math.round(clampedOffset);

      // Duplikate innerhalb von 2 Sekunden zusammenfassen
      let isDuplicate = false;
      for (const s of seenSeconds) {
        if (Math.abs(s - roundedOffset) <= 2) {
          isDuplicate = true;
          break;
        }
      }
      if (isDuplicate) continue;

      seenSeconds.add(roundedOffset);
      const pct = maxDuration > 0 ? (clampedOffset / maxDuration) * 100 : 0;
      matched.push({
        id: ev.id,
        timeStr: ev.timeStr,
        offsetSec: clampedOffset,
        message: ev.message,
        pct,
      });
    }
  }

  matched.sort((a, b) => a.offsetSec - b.offsetSec);
  return matched;
}

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
  const [filterMotionOnly, setFilterMotionOnly] = useState(false);

  // Clip Selection & Batch Delete
  const [selectedClipIds, setSelectedClipIds] = useState<Set<string>>(new Set());
  const [deletingBatch, setDeletingBatch] = useState(false);

  // Pagination
  const [pageSize, setPageSize] = useState<number | "all">(50);
  const [currentPage, setCurrentPage] = useState(1);

  // Motion Events & Timeline Scrubber State
  const [motionEvents, setMotionEvents] = useState<MotionEvent[]>([]);
  const [hoverScrubber, setHoverScrubber] = useState<{
    pct: number;
    timeStr: string;
    hasRecording: boolean;
    hasMotion: boolean;
    clipName?: string;
  } | null>(null);

  // Active Video Player Modal State
  const [activeClip, setActiveClip] = useState<RecordingClip | null>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [playerFullscreen, setPlayerFullscreen] = useState(false);
  const [autoPlayNext, setAutoPlayNext] = useState(true);
  const [videoDuration, setVideoDuration] = useState<number>(0);
  const [videoCurrentTime, setVideoCurrentTime] = useState<number>(0);
  const pendingSeekRef = useRef<number | null>(null);
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

      const [resClips, resEvents] = await Promise.all([
        fetch(`/api/nvr/recordings?${params.toString()}`, { cache: "no-store" }),
        fetch(`/api/nvr/events?${params.toString()}`, { cache: "no-store" }),
      ]);

      const dataClips = await resClips.json();
      if (dataClips.clips) {
        setClips(dataClips.clips);
        setSelectedClipIds(new Set());
        setCurrentPage(1);
      }

      const dataEvents = await resEvents.json().catch(() => ({ events: [] }));
      if (dataEvents.events) {
        setMotionEvents(dataEvents.events);
      } else {
        setMotionEvents([]);
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

  // Pre-calculate motion events per clip for instant lookup
  const clipMotionMap = useMemo(() => {
    const map = new Map<string, ClipMotionEvent[]>();
    for (const clip of clips) {
      map.set(clip.id, getMotionEventsForClip(clip, motionEvents));
    }
    return map;
  }, [clips, motionEvents]);

  const motionClipsCount = useMemo(() => {
    let count = 0;
    for (const clip of clips) {
      if ((clipMotionMap.get(clip.id)?.length || 0) > 0) count++;
    }
    return count;
  }, [clips, clipMotionMap]);

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

    if (filterMotionOnly) {
      result = result.filter((c) => (clipMotionMap.get(c.id)?.length || 0) > 0);
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
  }, [clips, searchQuery, timeFrom, timeTo, sortBy, filterMotionOnly, clipMotionMap]);

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

  // Motion events for the currently active clip
  const activeClipMotionEvents = useMemo(() => {
    if (!activeClip) return [];
    return getMotionEventsForClip(activeClip, motionEvents, videoDuration);
  }, [activeClip, motionEvents, videoDuration]);

  // Open clip handlers
  const openClip = (clip: RecordingClip) => {
    setVideoDuration(0);
    setVideoCurrentTime(0);
    pendingSeekRef.current = null;
    setActiveClip(clip);
    setIsPlaying(true);
  };

  const openClipWithOffset = (clip: RecordingClip, offsetSec = 0) => {
    setVideoDuration(0);
    setVideoCurrentTime(0);
    pendingSeekRef.current = offsetSec > 0 ? offsetSec : null;
    setActiveClip(clip);
    setIsPlaying(true);
  };

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

  const seekToOffset = (seconds: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = Math.max(0, seconds);
      videoRef.current.play().catch(() => {});
      setIsPlaying(true);
    }
  };

  const jumpToNextMotion = useCallback(() => {
    if (!videoRef.current || !activeClipMotionEvents.length) return;
    const curr = videoRef.current.currentTime;
    const next = activeClipMotionEvents.find((m) => m.offsetSec > curr + 1.5);
    if (next) {
      seekToOffset(next.offsetSec);
    } else {
      seekToOffset(activeClipMotionEvents[0].offsetSec);
    }
  }, [activeClipMotionEvents]);

  const jumpToPrevMotion = useCallback(() => {
    if (!videoRef.current || !activeClipMotionEvents.length) return;
    const curr = videoRef.current.currentTime;
    const prev = [...activeClipMotionEvents].reverse().find((m) => m.offsetSec < curr - 1.5);
    if (prev) {
      seekToOffset(prev.offsetSec);
    } else {
      seekToOffset(activeClipMotionEvents[activeClipMotionEvents.length - 1].offsetSec);
    }
  }, [activeClipMotionEvents]);

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
      openClip(filteredClips[activeClipIndex - 1]);
    }
  };

  const playNextClip = () => {
    if (activeClipIndex >= 0 && activeClipIndex < filteredClips.length - 1) {
      openClip(filteredClips[activeClipIndex + 1]);
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
      } else if (e.key === "n" || e.key === "m") {
        e.preventDefault();
        jumpToNextMotion();
      } else if (e.key === "p") {
        e.preventDefault();
        jumpToPrevMotion();
      } else if (e.key === "f") {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.key === "Escape") {
        setActiveClip(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeClip, jumpToNextMotion, jumpToPrevMotion]);

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

            {/* Filter: Nur Clips mit Bewegung */}
            <button
              onClick={() => {
                setFilterMotionOnly(!filterMotionOnly);
                setCurrentPage(1);
              }}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-all ${
                filterMotionOnly
                  ? "bg-amber-500 text-slate-950 font-bold shadow-md shadow-amber-500/20"
                  : "border border-slate-800 bg-slate-950 text-slate-300 hover:text-white hover:border-slate-700"
              }`}
              title="Nur Aufnahmen mit erkannter Bewegung anzeigen"
            >
              <Zap className={`h-3.5 w-3.5 ${filterMotionOnly ? "fill-slate-950 text-slate-950" : "fill-amber-400 text-amber-400"}`} />
              <span>Nur mit Bewegung</span>
              {motionClipsCount > 0 && (
                <span
                  className={`rounded-full px-1.5 py-0.2 text-[10px] font-mono ${
                    filterMotionOnly ? "bg-slate-950 text-amber-300" : "bg-slate-800 text-amber-400"
                  }`}
                >
                  {motionClipsCount}
                </span>
              )}
            </button>
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
                <div className="flex flex-wrap items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-400 animate-pulse"></span>
                  <h3 className="text-sm font-bold text-white truncate">{activeClip.cameraName}</h3>
                  <span className="rounded bg-slate-800 px-2 py-0.5 text-[11px] font-mono text-slate-300">
                    {activeClip.timeStr} Uhr
                  </span>
                  {activeClipMotionEvents.length > 0 ? (
                    <span className="inline-flex items-center gap-1 rounded bg-amber-500/20 border border-amber-500/40 px-2 py-0.5 text-[10px] font-bold text-amber-300 shadow-sm">
                      <Zap className="h-3 w-3 fill-amber-400 text-amber-400" />
                      {activeClipMotionEvents.length} {activeClipMotionEvents.length === 1 ? "Bewegung" : "Bewegungen"} im Clip
                    </span>
                  ) : (
                    <span className="rounded bg-slate-800/60 px-1.5 py-0.5 text-[10px] text-slate-400">
                      Keine Bewegung erkannt
                    </span>
                  )}
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
                className="w-full h-full max-h-[65vh] object-contain"
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onLoadedMetadata={(e) => {
                  const dur = e.currentTarget.duration || 0;
                  setVideoDuration(dur);
                  if (pendingSeekRef.current !== null && pendingSeekRef.current > 0) {
                    e.currentTarget.currentTime = Math.min(dur, pendingSeekRef.current);
                    pendingSeekRef.current = null;
                  }
                }}
                onTimeUpdate={(e) => {
                  setVideoCurrentTime(e.currentTarget.currentTime || 0);
                }}
                onEnded={() => {
                  if (autoPlayNext && activeClipIndex >= 0 && activeClipIndex < filteredClips.length - 1) {
                    playNextClip();
                  }
                }}
              />
            </div>

            {/* In-Clip Motion Timeline & Exact Moments Bar */}
            <div className="border-t border-slate-800 bg-slate-950/95 px-3 py-2.5">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-amber-400">
                    <Zap className="h-4 w-4 fill-amber-400 text-amber-400 animate-pulse" />
                    {activeClipMotionEvents.length > 0 ? (
                      <span>
                        {activeClipMotionEvents.length}{" "}
                        {activeClipMotionEvents.length === 1 ? "Bewegung" : "Bewegungen"} im Clip:
                      </span>
                    ) : (
                      <span className="text-slate-400 font-normal">
                        Keine Bewegungserkennung für diesen Clip registriert
                      </span>
                    )}
                  </div>
                  {activeClipMotionEvents.length > 0 && (
                    <span className="text-[10px] text-slate-400 hidden sm:inline">
                      (Klicke auf eine Marke, um genau dorthin zu springen)
                    </span>
                  )}
                </div>

                {/* Video Time Info */}
                {videoDuration > 0 && (
                  <div className="flex items-center gap-1 text-[11px] font-mono text-slate-300 shrink-0">
                    <span className="text-white font-bold">{formatSeconds(videoCurrentTime)}</span>
                    <span className="text-slate-500">/</span>
                    <span className="text-slate-400">{formatSeconds(videoDuration)}</span>
                  </div>
                )}
              </div>

              {/* In-Clip Interactive Scrubber Track with Motion Pins */}
              {videoDuration > 0 && (
                <div
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const clickX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
                    const pct = clickX / rect.width;
                    seekToOffset(pct * videoDuration);
                  }}
                  className="relative h-4.5 w-full rounded-md bg-slate-900 border border-slate-800/80 cursor-pointer overflow-hidden group select-none shadow-inner"
                  title="Klicke auf den Zeitstrahl zum Springen"
                >
                  {/* Played progress */}
                  <div
                    className="absolute top-0 bottom-0 left-0 bg-sky-500/25 border-r-2 border-sky-400 pointer-events-none transition-all duration-75"
                    style={{ width: `${Math.min(100, (videoCurrentTime / videoDuration) * 100)}%` }}
                  />

                  {/* Motion Markers */}
                  {activeClipMotionEvents.map((ev, idx) => {
                    const markerPct = Math.min(100, Math.max(0, (ev.offsetSec / videoDuration) * 100));
                    const isCurrent = Math.abs(videoCurrentTime - ev.offsetSec) < 2.5;
                    return (
                      <div
                        key={ev.id || idx}
                        onClick={(e) => {
                          e.stopPropagation();
                          seekToOffset(ev.offsetSec);
                        }}
                        className="absolute top-0 bottom-0 w-3 -ml-1.5 flex items-center justify-center cursor-pointer z-10 hover:scale-125 transition-transform"
                        style={{ left: `${markerPct}%` }}
                        title={`⚡ ${ev.timeStr} Uhr (bei ${formatSeconds(ev.offsetSec)}) - Klick zum Abspielen`}
                      >
                        <div
                          className={`w-1 h-full shadow-sm ${
                            isCurrent
                              ? "bg-amber-300 ring-2 ring-white scale-110 z-20"
                              : "bg-amber-400 ring-1 ring-amber-300/80"
                          }`}
                        />
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Clickable Motion Pills with Exact Timestamps and Video Offsets */}
              {activeClipMotionEvents.length > 0 && (
                <div className="flex items-center gap-1.5 overflow-x-auto pt-2 pb-0.5 scrollbar-thin">
                  <span className="text-[10px] text-slate-400 shrink-0 font-medium mr-1">
                    Genaue Zeitpunkte:
                  </span>
                  {activeClipMotionEvents.map((ev, idx) => {
                    const isNear = Math.abs(videoCurrentTime - ev.offsetSec) < 2.5;
                    return (
                      <button
                        key={ev.id || idx}
                        onClick={() => seekToOffset(ev.offsetSec)}
                        className={`shrink-0 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-mono transition-all ${
                          isNear
                            ? "bg-amber-400 text-slate-950 font-bold ring-2 ring-amber-300 shadow-md shadow-amber-500/30 scale-105"
                            : "border border-amber-500/30 bg-amber-950/20 text-amber-300 hover:bg-amber-500/20 hover:border-amber-400"
                        }`}
                        title={`Springe zu ${ev.timeStr} Uhr (bei ${formatSeconds(ev.offsetSec)})`}
                      >
                        <Zap className={`h-3 w-3 ${isNear ? "fill-slate-950 text-slate-950" : "fill-amber-400 text-amber-400"}`} />
                        <span className="font-semibold">{ev.timeStr} Uhr</span>
                        <span className={`text-[10px] ${isNear ? "text-slate-900" : "text-amber-200/80"}`}>
                          (bei {formatSeconds(ev.offsetSec)})
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Advanced NVR Toolbar */}
            <div className="p-3 border-t border-slate-800 bg-slate-900/70 flex flex-wrap items-center justify-between gap-3 text-xs">
              {/* Skip Controls, Motion Jumps & Clip Step */}
              <div className="flex flex-wrap items-center gap-1.5">
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

                {/* Direct Jump to Motion Buttons */}
                {activeClipMotionEvents.length > 0 && (
                  <div className="flex items-center gap-1 border-l border-slate-800 pl-1.5">
                    <button
                      onClick={jumpToPrevMotion}
                      className="inline-flex items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-950/30 px-2 py-1.5 text-amber-300 hover:bg-amber-500/20 hover:border-amber-400 transition-colors"
                      title="Zur vorherigen Bewegung springen (Taste P)"
                    >
                      <Zap className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                      <span className="hidden md:inline">Vorh. Bew.</span>
                    </button>
                    <button
                      onClick={jumpToNextMotion}
                      className="inline-flex items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-950/30 px-2 py-1.5 text-amber-300 hover:bg-amber-500/20 hover:border-amber-400 transition-colors"
                      title="Zur nächsten Bewegung springen (Taste N oder M)"
                    >
                      <Zap className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                      <span className="hidden md:inline">Nächste Bew.</span>
                    </button>
                  </div>
                )}

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
      <div className="rounded-2xl border border-slate-800/90 bg-gradient-to-b from-slate-900/95 to-slate-950 p-4 sm:p-5 mb-6 shadow-2xl backdrop-blur-md">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3.5">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 shadow-sm shadow-amber-500/10">
              <Clock className="h-4 w-4" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold text-white tracking-wide">24-Stunden Zeitstrahl</h2>
                <span className="rounded-full bg-slate-800/90 border border-slate-700/80 px-2.5 py-0.5 text-[11px] font-mono text-slate-300">
                  {selectedDate || "Alle Tage"}
                </span>
                {timelineClips.length > 0 && (
                  <span className="rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/30 px-2.5 py-0.5 text-[11px] font-medium flex items-center gap-1.5">
                    <Video className="h-3 w-3 text-sky-400" />
                    {timelineClips.length} {timelineClips.length === 1 ? "Segment" : "Segmente"}
                  </span>
                )}
                {motionEvents.length > 0 && (
                  <span className="rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2.5 py-0.5 text-[11px] font-medium flex items-center gap-1.5 shadow-sm shadow-amber-500/10">
                    <Zap className="h-3 w-3 text-amber-400 fill-amber-400" />
                    {motionEvents.length} {motionEvents.length === 1 ? "Bewegung" : "Bewegungen"}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Klicke auf die Zeitleiste oder ein Bewegungsevent (<Zap className="h-2.5 w-2.5 inline text-amber-400" />), um direkt dorthin zu springen.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Visual Legend */}
            <div className="hidden sm:flex items-center gap-3 text-[11px] text-slate-400 font-medium bg-slate-950/70 border border-slate-800 px-3 py-1.5 rounded-lg shadow-sm">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-sky-500 shadow-sm shadow-sky-500/40" />
                Aufnahme
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-amber-400 shadow-[0_0_6px_#f59e0b]" />
                Bewegung
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-cyan-300 shadow-[0_0_6px_#38bdf8]" />
                Aktuelle Wiedergabe
              </span>
            </div>

            {(timeFrom || timeTo) && (
              <button
                type="button"
                onClick={() => {
                  setTimeFrom("");
                  setTimeTo("");
                }}
                className="inline-flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 font-medium transition bg-amber-500/10 border border-amber-500/30 px-2.5 py-1 rounded-lg"
              >
                <RotateCcw className="h-3 w-3" />
                Filter zurücksetzen ({timeFrom || "00:00"} - {timeTo || "24:00"})
              </button>
            )}
          </div>
        </div>

        {/* Timeline Bar Track */}
        <div
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const clickX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
            const pct = clickX / rect.width;
            const totalMinutes = Math.floor(pct * 1440);
            const hour = Math.floor(totalMinutes / 60);
            const minute = totalMinutes % 60;
            const timeStr = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} Uhr`;

            const nearbyClip = timelineClips.find((c) => {
              const [h, m] = c.timeStr.split(":").map(Number);
              const clipMin = (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
              return totalMinutes >= clipMin && totalMinutes <= clipMin + 16;
            });

            const hasMotion = motionEvents.some(
              (ev) => Math.abs(ev.totalMinutes - totalMinutes) <= 6
            );

            setHoverScrubber({
              pct,
              timeStr,
              hasRecording: Boolean(nearbyClip),
              hasMotion,
              clipName: nearbyClip?.cameraName,
            });
          }}
          onMouseLeave={() => setHoverScrubber(null)}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const clickX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
            const pct = clickX / rect.width;
            const totalMinutes = Math.floor(pct * 1440);

            // Find matching clip at this time
            const matchingClip = timelineClips.find((c) => {
              const [h, m] = c.timeStr.split(":").map(Number);
              const clipMin = (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
              return totalMinutes >= clipMin && totalMinutes <= clipMin + 16;
            });

            if (matchingClip) {
              openClip(matchingClip);
            } else {
              const hour = Math.floor(totalMinutes / 60);
              const minute = Math.floor((totalMinutes % 60) / 15) * 15;
              const formatted = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
              setTimeFrom(formatted);
            }
          }}
          className="relative h-13 sm:h-14 w-full rounded-xl bg-slate-950 border border-slate-800/90 shadow-inner overflow-hidden cursor-crosshair select-none group"
          title="Klicke auf die Zeitachse zum Abspielen oder Filtern"
        >
          {/* Subtle background hour stripes (24 1-hour slots) */}
          <div className="absolute inset-0 grid grid-cols-24 pointer-events-none opacity-25">
            {Array.from({ length: 24 }).map((_, i) => (
              <div
                key={i}
                className={`h-full border-r border-slate-700/60 ${
                  i % 2 === 0 ? "bg-slate-800/20" : ""
                }`}
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
                  className="absolute top-0 bottom-0 bg-amber-500/15 border-x border-amber-500/50 pointer-events-none z-0"
                  style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                />
              );
            })()
          )}

          {/* Recorded Clips as a sleek modern continuous video track */}
          {timelineClips.map((clip) => {
            const timeParts = clip.timeStr.split(":").map(Number);
            const hh = isNaN(timeParts[0]) ? 0 : timeParts[0];
            const mm = isNaN(timeParts[1]) ? 0 : timeParts[1];
            const ss = isNaN(timeParts[2]) ? 0 : timeParts[2];
            const startMin = hh * 60 + mm + ss / 60;
            const leftPct = (startMin / 1440) * 100;
            const widthPct = Math.max(0.6, (15 / 1440) * 100);
            const isCurrentPlaying = activeClip?.id === clip.id;

            return (
              <div
                key={clip.id}
                onClick={(e) => {
                  e.stopPropagation();
                  openClip(clip);
                }}
                className={`absolute top-2 bottom-2 rounded-sm transition-all cursor-pointer z-10 ${
                  isCurrentPlaying
                    ? "bg-cyan-400 ring-2 ring-white shadow-lg shadow-cyan-500/50 z-20"
                    : "bg-sky-500/80 hover:bg-sky-400/95 border-y border-sky-400/30 hover:scale-y-105 shadow-sm"
                }`}
                style={{
                  left: `${leftPct}%`,
                  width: `${widthPct}%`,
                  minWidth: "3px",
                }}
                title={`${clip.cameraName} · ${clip.timeStr} Uhr (${formatBytes(clip.sizeBytes)}) - Klick zum Abspielen`}
              />
            );
          })}

          {/* Motion Event Markers Layer */}
          {motionEvents.map((ev) => {
            const leftPct = (ev.totalMinutes / 1440) * 100;
            return (
              <div
                key={ev.id}
                onClick={(e) => {
                  e.stopPropagation();
                  const matchingClip = timelineClips.find((c) => {
                    const [h, m] = c.timeStr.split(":").map(Number);
                    const clipMin = (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
                    return ev.totalMinutes >= clipMin && ev.totalMinutes <= clipMin + 20;
                  }) || timelineClips[0];

                  if (matchingClip) {
                    const clipStartSec = parseTimeToSeconds(matchingClip.timeStr);
                    const evSec = parseTimeToSeconds(ev.timeStr);
                    let offset = evSec - clipStartSec;
                    if (offset < -43200) offset += 86400;
                    if (offset > 43200) offset -= 86400;
                    const clampedOffset = Math.max(0, offset);
                    openClipWithOffset(matchingClip, clampedOffset);
                    toast.info(`Springe zu ${matchingClip.cameraName} (${ev.timeStr} Uhr - Bewegung)`);
                  }
                }}
                className="group/ev absolute top-0 bottom-0 w-2.5 -ml-[5px] z-25 cursor-pointer flex flex-col items-center justify-between pointer-events-auto"
                style={{ left: `${leftPct}%` }}
                title={`⚡ ${ev.timeStr} Uhr: ${ev.message} (${ev.cameraName}) - Klick zum Abspielen`}
              >
                <div className="h-2 w-2 rounded-full bg-amber-400 border border-amber-200 shadow-[0_0_8px_#f59e0b] group-hover/ev:scale-150 transition-transform mt-0.5" />
                <div className="w-0.5 flex-1 bg-amber-400/90 shadow-[0_0_5px_#f59e0b]" />
                <div className="h-1.5 w-1.5 rounded-full bg-amber-400 mb-0.5" />
              </div>
            );
          })}

          {/* Indicator for currently playing clip */}
          {activeClip && (
            (() => {
              const timeParts = activeClip.timeStr.split(":").map(Number);
              const hh = isNaN(timeParts[0]) ? 0 : timeParts[0];
              const mm = isNaN(timeParts[1]) ? 0 : timeParts[1];
              const ss = isNaN(timeParts[2]) ? 0 : timeParts[2];
              const startMin = hh * 60 + mm + ss / 60;
              const leftPct = (startMin / 1440) * 100;
              return (
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-cyan-300 z-30 pointer-events-none shadow-[0_0_10px_#38bdf8]"
                  style={{ left: `${leftPct}%` }}
                >
                  <div className="absolute -top-1 -left-1.5 h-3.5 w-3.5 rounded-full bg-cyan-400 border border-white shadow-md animate-pulse" />
                </div>
              );
            })()
          )}

          {/* Interactive Floating Hover Scrubber Line & Tooltip */}
          {hoverScrubber && (
            <>
              <div
                className="absolute top-0 bottom-0 w-px bg-white/70 pointer-events-none z-35 shadow-[0_0_4px_#fff]"
                style={{ left: `${hoverScrubber.pct * 100}%` }}
              />
              <div
                className="absolute top-1 pointer-events-none z-40 transform -translate-x-1/2 rounded-lg bg-slate-900/95 border border-slate-700/80 px-2 py-1 text-[10px] text-white shadow-xl backdrop-blur-sm whitespace-nowrap flex items-center gap-1.5"
                style={{
                  left: `${Math.max(6, Math.min(94, hoverScrubber.pct * 100))}%`,
                }}
              >
                <span className="font-mono font-semibold text-amber-300">
                  {hoverScrubber.timeStr}
                </span>
                {hoverScrubber.hasRecording && (
                  <span className="text-sky-300 flex items-center gap-1">
                    • 📹 Video
                  </span>
                )}
                {hoverScrubber.hasMotion && (
                  <span className="text-amber-400 font-medium flex items-center gap-0.5">
                    • <Zap className="h-2.5 w-2.5 fill-amber-400" /> Bewegung
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        {/* 24h Ruler Axis (00:00 - 24:00) */}
        <div className="relative mt-2 flex justify-between text-[10px] font-mono text-slate-500 select-none">
          <span className="hover:text-slate-300 transition-colors">00:00</span>
          <span className="hover:text-slate-300 transition-colors">02:00</span>
          <span className="hover:text-slate-300 transition-colors">04:00</span>
          <span className="hover:text-slate-300 transition-colors">06:00</span>
          <span className="hover:text-slate-300 transition-colors">08:00</span>
          <span className="hover:text-slate-300 transition-colors">10:00</span>
          <span className="hover:text-slate-300 transition-colors">12:00</span>
          <span className="hover:text-slate-300 transition-colors">14:00</span>
          <span className="hover:text-slate-300 transition-colors">16:00</span>
          <span className="hover:text-slate-300 transition-colors">18:00</span>
          <span className="hover:text-slate-300 transition-colors">20:00</span>
          <span className="hover:text-slate-300 transition-colors">22:00</span>
          <span className="hover:text-slate-300 transition-colors">24:00</span>
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
                  <th className="py-2.5 px-3">Bewegung</th>
                  <th className="py-2.5 px-3">Größe</th>
                  <th className="py-2.5 px-3 hidden md:table-cell">Speicherort</th>
                  <th className="py-2.5 px-3 hidden lg:table-cell">Dateiname</th>
                  <th className="py-2.5 px-3 text-right">Aktionen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {currentPageClips.map((clip) => {
                  const isSelected = selectedClipIds.has(clip.id);
                  const clipMotions = clipMotionMap.get(clip.id) || [];
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
                          onClick={() =>
                            clipMotions.length > 0
                              ? openClipWithOffset(clip, clipMotions[0].offsetSec)
                              : openClip(clip)
                          }
                          className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/90 text-slate-950 hover:bg-amber-400 hover:scale-105 active:scale-95 transition-all shadow-sm font-bold"
                          title={
                            clipMotions.length > 0
                              ? `Abspielen ab 1. Bewegung (${clipMotions[0].timeStr} Uhr)`
                              : "Abspielen"
                          }
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

                      {/* Bewegung */}
                      <td className="py-2 px-3">
                        {clipMotions.length > 0 ? (
                          <div className="flex flex-col gap-0.5">
                            <button
                              onClick={() => openClipWithOffset(clip, clipMotions[0].offsetSec)}
                              className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 border border-amber-500/35 px-2 py-0.5 text-[11px] font-semibold text-amber-300 hover:bg-amber-500/25 transition-colors group/m w-fit"
                              title={`Bewegungen um: ${clipMotions.map((m) => `${m.timeStr} (bei ${formatSeconds(m.offsetSec)})`).join(", ")} - Klick zum Abspielen`}
                            >
                              <Zap className="h-3 w-3 fill-amber-400 text-amber-400 group-hover/m:scale-110 transition-transform" />
                              <span>
                                {clipMotions.length} {clipMotions.length === 1 ? "Bewegung" : "Bewegungen"}
                              </span>
                            </button>
                            <span className="text-slate-400 font-mono text-[10px] pl-0.5">
                              {clipMotions.map((m) => m.timeStr).slice(0, 2).join(", ")}
                              {clipMotions.length > 2 ? "..." : ""}
                            </span>
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-500 italic">Keine</span>
                        )}
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
                            onClick={() =>
                              clipMotions.length > 0
                                ? openClipWithOffset(clip, clipMotions[0].offsetSec)
                                : openClip(clip)
                            }
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
            const clipMotions = clipMotionMap.get(clip.id) || [];
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

                  {/* Motion Info in Card */}
                  {clipMotions.length > 0 ? (
                    <button
                      onClick={() => openClipWithOffset(clip, clipMotions[0].offsetSec)}
                      className="w-full flex items-center justify-between text-[10px] text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/25 rounded px-2 py-1 mt-1.5 text-left transition-colors"
                      title={`Klick zum Abspielen ab 1. Bewegung (${clipMotions[0].timeStr} Uhr)`}
                    >
                      <span className="flex items-center gap-1 font-semibold">
                        <Zap className="h-2.5 w-2.5 fill-amber-400 text-amber-400 shrink-0" />
                        {clipMotions.length} {clipMotions.length === 1 ? "Bewegung" : "Bewegungen"}:
                      </span>
                      <span className="font-mono text-slate-300 truncate max-w-[110px]">
                        {clipMotions.map((m) => m.timeStr).join(", ")}
                      </span>
                    </button>
                  ) : (
                    <div className="text-[10px] text-slate-500 mt-1.5 pl-0.5">
                      Keine Bewegung registriert
                    </div>
                  )}

                  <div className="text-[10px] text-slate-500 truncate mt-1">
                    Speicher: <span className="text-slate-400">{clip.storageTargetName}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-1.5 pt-2.5 border-t border-slate-800/80 mt-2">
                  <button
                    onClick={() =>
                      clipMotions.length > 0
                        ? openClipWithOffset(clip, clipMotions[0].offsetSec)
                        : openClip(clip)
                    }
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
