"use client";

import { useEffect, useState, useRef, useMemo, useCallback, type PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import {
  Film,
  Play,
  Pause,
  Download,
  Share2,
  Trash2,
  RefreshCw,
  Calendar,
  Clock,
  ChevronDown,
  ChevronUp,
  X,
  Maximize2,
  Minimize2,
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
  ZoomIn,
  ZoomOut,
  BarChart3,
  Award,
  Pencil,
  Image as ImageIcon,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useToast } from "@/components/ToastProvider";
import { SnapshotLightboxModal } from "@/components/SnapshotLightboxModal";
import { useBodyScrollLock } from "@/lib/useBodyScrollLock";
import {
  type CameraRankingItem,
  type ActivityStatsResponse,
  type CameraSimple,
  type RecordingClip,
  type RecordingCalendarDay,
  type ClipSortBy,
  type ClipSizeFilter,
  TIMELINE_WINDOWS,
  type TimelineWindowMinutes,
  cameraNameCollator,
  objectClassLabels,
  type MotionEvent,
  type DailySummary,
  type ClipMotionEvent,
} from "@/components/playback/playbackTypes";
import {
  formatGermanDate,
  formatGermanDateLong,
  formatMinutesToTime,
  parseTimeToSeconds,
  formatSeconds,
  getMotionEventsForClip,
  formatBytes,
  getTodayStr,
  shiftMonth,
  formatMonth,
} from "@/components/playback/playbackUtils";
import { LazyVideoThumb } from "@/components/playback/LazyVideoThumb";
import { ActivityStatsModal } from "@/components/playback/ActivityStatsModal";

export default function PlaybackPage() {
  const { toast } = useToast();
  const [cameras, setCameras] = useState<CameraSimple[]>([]);
  const [clips, setClips] = useState<RecordingClip[]>([]);
  const [loadingClips, setLoadingClips] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const clipsRequestIdRef = useRef(0);
  const clipRequestsInFlightRef = useRef(0);
  const clipsQueryKeyRef = useRef("");
  const calendarRequestIdRef = useRef(0);

  // Filters & Search
  const [selectedCameraId, setSelectedCameraId] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState<string>(getTodayStr());
  const [calendarMonth, setCalendarMonth] = useState<string>(getTodayStr().slice(0, 7));
  const [calendarDays, setCalendarDays] = useState<Record<string, RecordingCalendarDay>>({});
  const [loadingCalendar, setLoadingCalendar] = useState(true);
  const [timeFrom, setTimeFrom] = useState<string>("");
  const [timeTo, setTimeTo] = useState<string>("");
  const [timePreset, setTimePreset] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [sortBy, setSortBy] = useState<ClipSortBy>("newest");
  const [storageFilter, setStorageFilter] = useState("");
  const [sizeFilter, setSizeFilter] = useState<ClipSizeFilter>("all");
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [filterMotionOnly, setFilterMotionOnly] = useState(false);
  const [objectFilter, setObjectFilter] = useState<"all" | "person" | "vehicle" | "animal" | "plate">("all");
  const [cameraPickerOpen, setCameraPickerOpen] = useState(false);
  const [mobileCalendarOpen, setMobileCalendarOpen] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  // Timeline Zoom & Event Inspector State
  const [timelineWindowMinutes, setTimelineWindowMinutes] = useState<TimelineWindowMinutes>(1440);
  const [timelineStartMin, setTimelineStartMin] = useState<number>(0);
  const [showEventLog, setShowEventLog] = useState<boolean>(false);
  const [eventLogSearch, setEventLogSearch] = useState<string>("");
  const [eventLogTimeOfDay, setEventLogTimeOfDay] = useState<"all" | "night" | "morning" | "afternoon" | "evening">("all");
  const [showVideoTrack, setShowVideoTrack] = useState<boolean>(true);

  // Clip Selection & Batch Delete
  const [selectedClipIds, setSelectedClipIds] = useState<Set<string>>(new Set());
  const [deletingBatch, setDeletingBatch] = useState(false);

  // Pagination
  const [pageSize, setPageSize] = useState<number | "all">(50);
  const [currentPage, setCurrentPage] = useState(1);

  // Motion Events & Timeline Scrubber State
  const [motionEvents, setMotionEvents] = useState<MotionEvent[]>([]);
  const [dailySummary, setDailySummary] = useState<DailySummary | null>(null);
  const [hoverScrubber, setHoverScrubber] = useState<{
    pct: number;
    timeStr: string;
    hasRecording: boolean;
    hasMotion: boolean;
    clipName?: string;
  } | null>(null);

  // Active Video Player Modal State
  const [sharingClip, setSharingClip] = useState(false);

  const handleShareClip = async (clipId: string) => {
    setSharingClip(true);
    toast.info("Exportiere Clip mit Zeitstempel...");
    try {
      const res = await fetch("/api/nvr/recordings/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clipId, overlay: true, shareHours: 48 }),
      });
      const data = await res.json();
      if (!res.ok || !data.shareUrl) {
        throw new Error(data.error || "Fehler beim Erstellen des Links");
      }
      const fullUrl = `${window.location.origin}${data.shareUrl}`;
      await navigator.clipboard.writeText(fullUrl);
      toast.success("Teilen-Link kopiert (48h gültig)!");
    } catch (err: any) {
      toast.error(err?.message || "Teilen fehlgeschlagen");
    } finally {
      setSharingClip(false);
    }
  };
  const [activeClip, setActiveClip] = useState<RecordingClip | null>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [playerFullscreen, setPlayerFullscreen] = useState(false);
  const [autoPlayNext, setAutoPlayNext] = useState(true);
  const [videoDuration, setVideoDuration] = useState<number>(0);
  const [videoCurrentTime, setVideoCurrentTime] = useState<number>(0);
  const [compatiblePlayback, setCompatiblePlayback] = useState(false);
  const [playerPreparing, setPlayerPreparing] = useState(false);
  const [playerError, setPlayerError] = useState("");
  const [playerNeedsStart, setPlayerNeedsStart] = useState(false);
  const [playbackAttempt, setPlaybackAttempt] = useState(0);
  const [seekFeedback, setSeekFeedback] = useState("");
  const [playerOptionsOpen, setPlayerOptionsOpen] = useState(false);
  const pendingSeekRef = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const seekFeedbackTimerRef = useRef<number | null>(null);
  const lastPlayerTapRef = useRef<{ side: "left" | "right"; at: number } | null>(null);
  const playerGestureRef = useRef<{
    pointerId: number | null;
    side: "left" | "right";
    held: boolean;
    holdTimer: number | null;
    repeatTimer: number | null;
  }>({ pointerId: null, side: "left", held: false, holdTimer: null, repeatTimer: null });

  // Motion Activity Stats & Ranking State
  const [showStatsModal, setShowStatsModal] = useState(false);
  const [statsPeriod, setStatsPeriod] = useState<"today" | "yesterday" | "7d" | "30d" | "all">("today");
  const [activityStats, setActivityStats] = useState<ActivityStatsResponse | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [selectedSnapshot, setSelectedSnapshot] = useState<{ url: string; title: string } | null>(null);
  useBodyScrollLock(Boolean(showStatsModal || (activeClip && playerFullscreen) || cameraPickerOpen || selectedSnapshot));

  const fetchActivityStats = useCallback(async (period: string) => {
    try {
      setLoadingStats(true);
      const res = await fetch(`/api/nvr/stats?period=${period}`, { cache: "no-store" });
      const data = await res.json();
      if (data.ok) {
        setActivityStats(data);
      }
    } catch {
      // quiet fallback
    } finally {
      setLoadingStats(false);
    }
  }, []);

  const handleTimePresetChange = (preset: string) => {
    setTimePreset(preset);
    if (preset === "all") {
      setTimeFrom("");
      setTimeTo("");
    } else if (preset === "morning") {
      setTimeFrom("06:00");
      setTimeTo("12:00");
    } else if (preset === "afternoon") {
      setTimeFrom("12:00");
      setTimeTo("18:00");
    } else if (preset === "evening") {
      setTimeFrom("18:00");
      setTimeTo("23:59");
    } else if (preset === "night") {
      setTimeFrom("00:00");
      setTimeTo("06:00");
    }
    setCurrentPage(1);
  };

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
            recordSegmentMinutes: c.recordSegmentMinutes,
          })).sort((left: CameraSimple, right: CameraSimple) =>
            cameraNameCollator.compare(left.name, right.name) || left.ip.localeCompare(right.ip, "de", { numeric: true })
          )
        );
      }
    } catch {}
  };

  const fetchClips = useCallback(async (camId: string, date: string, silent = false) => {
    if (silent && clipRequestsInFlightRef.current > 0) return;
    const requestId = ++clipsRequestIdRef.current;
    const queryKey = `${camId}\u0000${date}`;
    clipRequestsInFlightRef.current += 1;
    try {
      if (!silent) setRefreshing(true);
      const params = new URLSearchParams();
      if (camId) params.set("cameraId", camId);
      if (date) params.set("date", date);

      const [resClips, resEvents, resSummary] = await Promise.all([
        fetch(`/api/nvr/recordings?${params.toString()}`, { cache: "no-store" }),
        fetch(`/api/nvr/events?${params.toString()}`, { cache: "no-store" }),
        date
          ? fetch(`/api/nvr/daily-summary?${params.toString()}`, { cache: "no-store" })
          : Promise.resolve(null),
      ]);

      if (!resClips.ok) throw new Error(`Aufnahmen: HTTP ${resClips.status}`);
      const dataClips = await resClips.json();
      if (requestId !== clipsRequestIdRef.current) return;
      if (Array.isArray(dataClips.clips)) {
        const unavailableTargets = Array.isArray(dataClips.unavailableStorageTargets)
          ? dataClips.unavailableStorageTargets.filter((entry: unknown): entry is string => typeof entry === "string")
          : [];
        setClips((current) => {
          const canRetainUnavailable = clipsQueryKeyRef.current === queryKey;
          clipsQueryKeyRef.current = queryKey;
          if (silent && canRetainUnavailable && current.length > 0 && dataClips.clips.length === 0) {
            return current;
          }
          if (!unavailableTargets.length || !canRetainUnavailable) return dataClips.clips;
          const incomingIds = new Set<string>(dataClips.clips.map((clip: RecordingClip) => clip.id));
          const retained = current.filter((clip) =>
            unavailableTargets.includes(clip.storageTargetName) && !incomingIds.has(clip.id)
          );
          return [...dataClips.clips, ...retained];
        });
        if (!silent) {
          setSelectedClipIds(new Set());
          setCurrentPage(1);
        }
      }

      if (resEvents.ok) {
        const dataEvents = await resEvents.json().catch(() => null);
        if (requestId === clipsRequestIdRef.current && Array.isArray(dataEvents?.events)) {
          setMotionEvents(dataEvents.events);
        }
      }
      if (resSummary) {
        if (resSummary.ok) {
          const summary = await resSummary.json().catch(() => null);
          if (requestId === clipsRequestIdRef.current && summary?.ok) setDailySummary(summary);
        }
      } else if (requestId === clipsRequestIdRef.current) {
        setDailySummary(null);
      }
    } catch {
      if (!silent && requestId === clipsRequestIdRef.current) {
        toast.error("Fehler beim Laden der Aufnahmen. Vorhandene Inhalte bleiben sichtbar.");
      }
    } finally {
      clipRequestsInFlightRef.current = Math.max(0, clipRequestsInFlightRef.current - 1);
      if (requestId === clipsRequestIdRef.current) {
        setLoadingClips(false);
        if (!silent) setRefreshing(false);
      }
    }
  }, [toast]);

  const fetchCalendar = useCallback(async (month: string, cameraId: string) => {
    const requestId = ++calendarRequestIdRef.current;
    try {
      setLoadingCalendar(true);
      const params = new URLSearchParams({ calendarMonth: month });
      if (cameraId) params.set("cameraId", cameraId);
      const response = await fetch(`/api/nvr/recordings?${params.toString()}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Kalender konnte nicht geladen werden.");
      if (requestId !== calendarRequestIdRef.current) return;
      if (result.partial) return;
      const indexed: Record<string, RecordingCalendarDay> = {};
      for (const day of result.days ?? []) indexed[day.date] = day;
      setCalendarDays(indexed);
    } catch {
      // Bei kurzzeitig nicht erreichbaren Speicherzielen den letzten stabilen Kalender behalten.
    } finally {
      if (requestId === calendarRequestIdRef.current) setLoadingCalendar(false);
    }
  }, []);

  const selectCameraFilter = useCallback((cameraId: string) => {
    setSelectedCameraId(cameraId);
    setCurrentPage(1);
    setTimeFrom("");
    setTimeTo("");
    setTimePreset("all");
    setCameraPickerOpen(false);
    void fetchClips(cameraId, selectedDate);
  }, [fetchClips, selectedDate]);

  useEffect(() => {
    if (!cameraPickerOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCameraPickerOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [cameraPickerOpen]);

  const selectRecordingDate = useCallback((date: string) => {
    setSelectedDate(date);
    setCalendarMonth(date.slice(0, 7));
    setTimelineStartMin(0);
    setCurrentPage(1);
    void fetchClips(selectedCameraId, date);
  }, [fetchClips, selectedCameraId]);

  const showAllRecordingDays = useCallback(() => {
    setSelectedDate("");
    setCurrentPage(1);
    setTimeFrom("");
    setTimeTo("");
    setTimePreset("all");
    void fetchClips(selectedCameraId, "");
  }, [fetchClips, selectedCameraId]);

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
    fetchActivityStats("today");
  }, [fetchClips, fetchActivityStats]);

  useEffect(() => {
    void fetchCalendar(calendarMonth, selectedCameraId);
  }, [calendarMonth, fetchCalendar, selectedCameraId]);

  useEffect(() => {
    const clipIsBeingCreated = motionEvents.some((event) =>
      ["pending", "buffering", "merging"].includes(event.motionRecordingStatus || "")
    );
    if (!clipIsBeingCreated) return;
    const timer = window.setInterval(() => {
      void fetchClips(selectedCameraId, selectedDate, true);
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [fetchClips, motionEvents, selectedCameraId, selectedDate]);

  const calendarCells = useMemo(() => {
    const [year, monthNumber] = calendarMonth.split("-").map(Number);
    const daysInMonth = new Date(year, monthNumber, 0).getDate();
    const leadingEmptyDays = (new Date(year, monthNumber - 1, 1).getDay() + 6) % 7;
    return [
      ...Array.from({ length: leadingEmptyDays }, () => null),
      ...Array.from({ length: daysInMonth }, (_, index) => {
        const day = String(index + 1).padStart(2, "0");
        return `${calendarMonth}-${day}`;
      }),
    ];
  }, [calendarMonth]);

  const selectedCalendarDay = selectedDate ? calendarDays[selectedDate] : undefined;
  const selectedCamera = cameras.find((camera) => camera.id === selectedCameraId);
  const activeAdvancedFilterCount = [
    Boolean(searchQuery.trim()),
    timePreset !== "all",
    filterMotionOnly,
    objectFilter !== "all",
    Boolean(storageFilter),
    sizeFilter !== "all",
    sortBy !== "newest",
  ].filter(Boolean).length;
  const calendarMonthClipCount = useMemo(
    () => Object.values(calendarDays).reduce((sum, day) => sum + day.count, 0),
    [calendarDays]
  );

  // Pre-calculate motion events per clip for instant lookup
  const clipMotionMap = useMemo(() => {
    const map = new Map<string, ClipMotionEvent[]>();
    for (const clip of clips) {
      const cam = cameras.find((c) => c.id === clip.cameraId);
      const fallback = (cam?.recordSegmentMinutes || 15) * 60;
      map.set(clip.id, getMotionEventsForClip(clip, motionEvents, 0, fallback));
    }
    return map;
  }, [clips, motionEvents, cameras]);

  const rawClipEventsMap = useMemo(() => {
    const map = new Map<string, MotionEvent[]>();
    for (const clip of clips) {
      const cam = cameras.find((c) => c.id === clip.cameraId);
      const fallbackSec = (cam?.recordSegmentMinutes || 15) * 60;
      const clipStartSec = parseTimeToSeconds(clip.timeStr);
      const matched = motionEvents.filter((ev) => {
        if (ev.clipId && ev.clipId !== clip.id) return false;
        if (ev.cameraId && clip.cameraId && ev.cameraId !== clip.cameraId) return false;
        if (clip.dateStr && ev.dateStr && clip.dateStr !== ev.dateStr) return false;
        const evSec = parseTimeToSeconds(ev.timeStr);
        const offset = evSec - clipStartSec;
        return offset >= -5 && offset <= fallbackSec + 5;
      });
      map.set(clip.id, matched);
    }
    return map;
  }, [clips, motionEvents, cameras]);

  const motionClipsCount = useMemo(() => {
    let count = 0;
    for (const clip of clips) {
      if ((clipMotionMap.get(clip.id)?.length || 0) > 0) count++;
    }
    return count;
  }, [clips, clipMotionMap]);

  const availableStorageTargets = useMemo(
    () => Array.from(new Set(clips.map((clip) => clip.storageTargetName))).sort((left, right) => left.localeCompare(right, "de")),
    [clips]
  );

  const toggleTableSort = (ascending: ClipSortBy, descending: ClipSortBy) => {
    setSortBy((current) => current === ascending ? descending : ascending);
    setCurrentPage(1);
  };

  const sortIndicator = (ascending: ClipSortBy, descending: ClipSortBy) =>
    sortBy === ascending ? "↑" : sortBy === descending ? "↓" : "↕";

  // Filtered & Sorted Clips
  const filteredClips = useMemo(() => {
    let result = [...clips];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter((c) => {
        if (
          c.cameraName.toLowerCase().includes(q) ||
          c.filename.toLowerCase().includes(q) ||
          c.timeStr.toLowerCase().includes(q) ||
          c.dateStr.toLowerCase().includes(q) ||
          c.storageTargetName.toLowerCase().includes(q)
        ) {
          return true;
        }
        const evs = rawClipEventsMap.get(c.id);
        if (evs && evs.length > 0) {
          for (const ev of evs) {
            if (ev.message && ev.message.toLowerCase().includes(q)) return true;
            if (ev.objectClasses && ev.objectClasses.some((cls) => cls.toLowerCase().includes(q))) return true;
            if (ev.licensePlates && ev.licensePlates.some((p) => p.plate.toLowerCase().includes(q) || (p.knownName && p.knownName.toLowerCase().includes(q)))) return true;
          }
        }
        return false;
      });
    }

    if (objectFilter !== "all") {
      result = result.filter((clip) => {
        const eventsForClip = rawClipEventsMap.get(clip.id) || [];
        return eventsForClip.some((ev) => {
          if (objectFilter === "plate") {
            return (ev.licensePlates && ev.licensePlates.length > 0) || (ev.message && /kennzeichen/i.test(ev.message));
          }
          if (objectFilter === "person") {
            return (ev.objectClasses && ev.objectClasses.includes("person")) || /person/i.test(ev.message || "");
          }
          if (objectFilter === "vehicle") {
            return (ev.objectClasses && ev.objectClasses.some((c) => ["vehicle", "car", "truck", "bus", "motorcycle"].includes(c))) || /fahrzeug|auto|lkw|motorrad/i.test(ev.message || "");
          }
          if (objectFilter === "animal") {
            return (ev.objectClasses && ev.objectClasses.some((c) => ["animal", "dog", "cat", "bird"].includes(c))) || /tier|hund|katze/i.test(ev.message || "");
          }
          return false;
        });
      });
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

    if (storageFilter) {
      result = result.filter((clip) => clip.storageTargetName === storageFilter);
    }

    const megabyte = 1024 * 1024;
    if (sizeFilter === "under-25") {
      result = result.filter((clip) => clip.sizeBytes < 25 * megabyte);
    } else if (sizeFilter === "25-100") {
      result = result.filter((clip) => clip.sizeBytes >= 25 * megabyte && clip.sizeBytes < 100 * megabyte);
    } else if (sizeFilter === "100-500") {
      result = result.filter((clip) => clip.sizeBytes >= 100 * megabyte && clip.sizeBytes < 500 * megabyte);
    } else if (sizeFilter === "over-500") {
      result = result.filter((clip) => clip.sizeBytes >= 500 * megabyte);
    }

    if (sortBy === "newest") {
      result.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    } else if (sortBy === "oldest") {
      result.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    } else if (sortBy === "largest") {
      result.sort((a, b) => b.sizeBytes - a.sizeBytes);
    } else if (sortBy === "smallest") {
      result.sort((a, b) => a.sizeBytes - b.sizeBytes);
    } else if (sortBy === "camera-asc" || sortBy === "camera-desc") {
      const direction = sortBy === "camera-asc" ? 1 : -1;
      result.sort((a, b) => direction * a.cameraName.localeCompare(b.cameraName, "de", { numeric: true }));
    } else if (sortBy === "motion-most" || sortBy === "motion-least") {
      const direction = sortBy === "motion-most" ? -1 : 1;
      result.sort((a, b) => direction * ((clipMotionMap.get(a.id)?.length || 0) - (clipMotionMap.get(b.id)?.length || 0)));
    } else if (sortBy === "storage-asc" || sortBy === "storage-desc") {
      const direction = sortBy === "storage-asc" ? 1 : -1;
      result.sort((a, b) => direction * a.storageTargetName.localeCompare(b.storageTargetName, "de", { numeric: true }));
    } else if (sortBy === "filename-asc" || sortBy === "filename-desc") {
      const direction = sortBy === "filename-asc" ? 1 : -1;
      result.sort((a, b) => direction * a.filename.localeCompare(b.filename, "de", { numeric: true }));
    }
    return result;
  }, [clips, searchQuery, timeFrom, timeTo, sortBy, filterMotionOnly, objectFilter, clipMotionMap, rawClipEventsMap, storageFilter, sizeFilter]);

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
    const cam = cameras.find((c) => c.id === activeClip.cameraId);
    const fallback = (cam?.recordSegmentMinutes || 15) * 60;
    return getMotionEventsForClip(activeClip, motionEvents, videoDuration, fallback);
  }, [activeClip, motionEvents, videoDuration, cameras]);

  // Open clip handlers
  const openClip = (clip: RecordingClip) => {
    setVideoDuration(0);
    setVideoCurrentTime(0);
    pendingSeekRef.current = null;
    setCompatiblePlayback(false);
    setPlayerPreparing(false);
    setPlayerError("");
    setPlayerNeedsStart(false);
    setPlaybackAttempt(0);
    setPlayerOptionsOpen(false);
    setActiveClip(clip);
    setIsPlaying(true);
  };

  const openClipWithOffset = (clip: RecordingClip, offsetSec = 0) => {
    setVideoDuration(0);
    setVideoCurrentTime(0);
    pendingSeekRef.current = offsetSec > 0 ? offsetSec : null;
    setCompatiblePlayback(false);
    setPlayerPreparing(false);
    setPlayerError("");
    setPlayerNeedsStart(false);
    setPlaybackAttempt(0);
    setPlayerOptionsOpen(false);
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
        void fetchCalendar(calendarMonth, selectedCameraId);
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
        void fetchCalendar(calendarMonth, selectedCameraId);
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

  const showSeekFeedback = (label: string) => {
    if (seekFeedbackTimerRef.current !== null) window.clearTimeout(seekFeedbackTimerRef.current);
    setSeekFeedback(label);
    seekFeedbackTimerRef.current = window.setTimeout(() => {
      setSeekFeedback("");
      seekFeedbackTimerRef.current = null;
    }, 700);
  };

  const clearPlayerGesture = useCallback(() => {
    const gesture = playerGestureRef.current;
    if (gesture.holdTimer !== null) window.clearTimeout(gesture.holdTimer);
    if (gesture.repeatTimer !== null) window.clearInterval(gesture.repeatTimer);
    gesture.pointerId = null;
    gesture.holdTimer = null;
    gesture.repeatTimer = null;
  }, []);

  const handlePlayerPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const side = event.clientX < bounds.left + bounds.width / 2 ? "left" : "right";
    const direction = side === "left" ? -1 : 1;
    event.currentTarget.setPointerCapture(event.pointerId);
    clearPlayerGesture();
    playerGestureRef.current.pointerId = event.pointerId;
    playerGestureRef.current.side = side;
    playerGestureRef.current.held = false;
    playerGestureRef.current.holdTimer = window.setTimeout(() => {
      playerGestureRef.current.held = true;
      seekRelative(direction * 2);
      showSeekFeedback(direction < 0 ? "◀ Schnell zurück" : "Schnell vor ▶");
      playerGestureRef.current.repeatTimer = window.setInterval(() => seekRelative(direction * 2), 220);
    }, 450);
  };

  const handlePlayerPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = playerGestureRef.current;
    if (gesture.pointerId !== event.pointerId) return;
    event.preventDefault();
    const wasHeld = gesture.held;
    const side = gesture.side;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    clearPlayerGesture();
    if (wasHeld) return;
    const now = Date.now();
    const previous = lastPlayerTapRef.current;
    if (previous?.side === side && now - previous.at < 330) {
      const seconds = side === "left" ? -10 : 10;
      seekRelative(seconds);
      showSeekFeedback(seconds < 0 ? "−10 Sekunden" : "+10 Sekunden");
      lastPlayerTapRef.current = null;
    } else {
      lastPlayerTapRef.current = { side, at: now };
    }
  };

  useEffect(() => () => {
    clearPlayerGesture();
    if (seekFeedbackTimerRef.current !== null) window.clearTimeout(seekFeedbackTimerRef.current);
  }, [clearPlayerGesture]);

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

  // Timeline Zoom & Pan Handlers
  const zoomToWindow = (span: TimelineWindowMinutes, centerMin?: number) => {
    setTimelineWindowMinutes(span);
    if (span === 1440) {
      setTimelineStartMin(0);
      return;
    }
    const currentCenter = timelineStartMin + Math.floor(timelineWindowMinutes / 2);
    const target = centerMin !== undefined ? centerMin : currentCenter;
    let start = target - Math.floor(span / 2);
    start = Math.max(0, Math.min(1440 - span, start));
    const snapMinutes = span >= 120 ? 15 : span >= 30 ? 5 : 1;
    start = Math.floor(start / snapMinutes) * snapMinutes;
    setTimelineStartMin(start);
  };

  // Zeitleiste auf "Jetzt" setzen: 2h-Fenster, aktuelle Zeit liegt im rechten Drittel
  const goToNow = () => {
    const parts = new Intl.DateTimeFormat("de-DE", {
      timeZone: "Europe/Berlin",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date());
    const hh = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
    const mm = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
    const nowMin = hh * 60 + mm;
    const span = 2 * 60;
    setTimelineWindowMinutes(120);
    setTimelineStartMin(Math.max(0, Math.min(1440 - span, nowMin - 90)));
  };

  // Beim ersten Laden immer mit "Jetzt" starten
  useEffect(() => {
    goToNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const panTimeline = (deltaMin: number) => {
    setTimelineStartMin((prev) => Math.max(0, Math.min(1440 - timelineWindowMinutes, prev + deltaMin)));
  };

  const jumpToMotionCluster = () => {
    if (!motionEvents.length) {
      toast.info("Keine Bewegungsereignisse an diesem Tag.");
      return;
    }
    const firstEv = motionEvents[0];
    const targetMin = Math.floor(firstEv.totalMinutes);
    zoomToWindow(120, targetMin);
    toast.success(`Zoom auf Bewegungen um ${firstEv.timeStr} Uhr`);
  };

  const playEvent = async (ev: MotionEvent) => {
    // 1. Direct clip associated with this event (motion recording)
    if (ev.clipId) {
      const linkedClip = clips.find((clip) => clip.id === ev.clipId);
      const clipToPlay: RecordingClip = linkedClip || {
        id: ev.clipId,
        cameraId: ev.cameraId,
        cameraName: ev.cameraName,
        filename: `${ev.dateStr || getTodayStr()}_${ev.timeStr.replace(/:/g, "-")}.mp4`,
        dateStr: ev.dateStr || getTodayStr(),
        timeStr: ev.timeStr,
        timestamp: ev.timestamp,
        sizeBytes: 0,
        storageTargetName: "Ereignis-Aufnahme",
        streamUrl: ev.streamUrl || `/api/nvr/recordings/stream?clipId=${ev.clipId}`,
        downloadUrl: `/api/nvr/recordings/stream?clipId=${ev.clipId}&download=1`,
      };
      const offset = typeof (ev as any).clipOffsetSec === "number" ? (ev as any).clipOffsetSec : 0;
      openClipWithOffset(clipToPlay, offset);
      toast.info(`Spiele Aufnahme für ${ev.cameraName} (${ev.timeStr} Uhr)`);
      return;
    }

    // 2. Continuous recording: find the clip that covers this camera at this time
    const evSec = parseTimeToSeconds(ev.timeStr);
    const cameraClips = clips.filter((c) => c.cameraId === ev.cameraId);
    let matchingClip = cameraClips.find((c) => {
      const [h, m, s] = c.timeStr.split(":").map(Number);
      const clipStartSec = (isNaN(h) ? 0 : h) * 3600 + (isNaN(m) ? 0 : m) * 60 + (isNaN(s) ? 0 : s);
      const cam = cameras.find((cm) => cm.id === c.cameraId);
      const segSec = (cam?.recordSegmentMinutes || 15) * 60;
      const offset = evSec - clipStartSec;
      return offset >= -5 && offset <= segSec + 15;
    });

    // 3. Fallback to nearest clip of this camera on the same day if in memory
    if (!matchingClip) {
      const sameDayCamClips = cameraClips.filter((c) => c.dateStr === ev.dateStr);
      if (sameDayCamClips.length > 0) {
        matchingClip = sameDayCamClips.reduce((best, curr) => {
          const bestDiff = Math.abs(parseTimeToSeconds(best.timeStr) - evSec);
          const currDiff = Math.abs(parseTimeToSeconds(curr.timeStr) - evSec);
          return currDiff < bestDiff ? curr : best;
        });
      }
    }

    // 4. If still not found, dynamically query server for clips of this camera on this date
    if (!matchingClip) {
      try {
        const queryParams = new URLSearchParams({ cameraId: ev.cameraId, date: ev.dateStr || "" });
        const res = await fetch(`/api/nvr/recordings?${queryParams.toString()}`);
        if (res.ok) {
          const data = await res.json();
          const serverClips: RecordingClip[] = Array.isArray(data.clips) ? data.clips : [];
          if (serverClips.length > 0) {
            setClips((prev) => {
              const prevIds = new Set(prev.map((c) => c.id));
              const newClips = serverClips.filter((c) => !prevIds.has(c.id));
              return newClips.length > 0 ? [...newClips, ...prev] : prev;
            });

            matchingClip = serverClips.find((c) => {
              const [h, m, s] = c.timeStr.split(":").map(Number);
              const clipStartSec = (isNaN(h) ? 0 : h) * 3600 + (isNaN(m) ? 0 : m) * 60 + (isNaN(s) ? 0 : s);
              const cam = cameras.find((cm) => cm.id === c.cameraId);
              const segSec = (cam?.recordSegmentMinutes || 15) * 60;
              const offset = evSec - clipStartSec;
              return offset >= -5 && offset <= segSec + 15;
            }) || serverClips[0];
          }
        }
      } catch {}
    }

    // 5. Check late clips from previous day if event is in the first 30 minutes of the day
    if (!matchingClip && evSec < 1800) {
      try {
        const prevDate = new Date(`${ev.dateStr}T00:00:00Z`);
        prevDate.setUTCDate(prevDate.getUTCDate() - 1);
        const prevDateStr = prevDate.toISOString().slice(0, 10);
        const queryParams = new URLSearchParams({ cameraId: ev.cameraId, date: prevDateStr });
        const res = await fetch(`/api/nvr/recordings?${queryParams.toString()}`);
        if (res.ok) {
          const data = await res.json();
          const prevClips: RecordingClip[] = Array.isArray(data.clips) ? data.clips : [];
          const lateClip = prevClips.find((c) => parseTimeToSeconds(c.timeStr) >= 84600);
          if (lateClip) {
            matchingClip = lateClip;
          }
        }
      } catch {}
    }

    if (matchingClip) {
      const clipStartSec = parseTimeToSeconds(matchingClip.timeStr);
      let offset = evSec - clipStartSec;
      if (offset < -43200) offset += 86400;
      if (offset > 43200) offset -= 86400;
      const clampedOffset = Math.max(0, offset);
      openClipWithOffset(matchingClip, clampedOffset);
      toast.info(`Springe zu ${matchingClip.cameraName} (${ev.timeStr} Uhr)`);
    } else {
      if (["pending", "buffering", "merging"].includes(ev.motionRecordingStatus || "")) {
        toast.info(`Der Clip für ${ev.timeStr} Uhr wird noch erstellt.`);
      } else if (ev.motionRecordingStatus === "failed") {
        toast.error(ev.motionRecordingError || `Der Clip für ${ev.timeStr} Uhr konnte nicht erstellt werden.`);
      } else if (ev.motionRecordingStatus === "disabled") {
        toast.warning(`Für "${ev.cameraName}" war die Videoaufnahme nicht aktiviert.`);
      } else {
        toast.warning(`Keine passende Videoaufnahme für ${ev.cameraName} um ${ev.timeStr} Uhr gefunden.`);
      }
    }
  };

  const focusEventOnTimeline = (ev: MotionEvent) => {
    zoomToWindow(60, Math.floor(ev.totalMinutes));
    toast.info(`Zeitleiste auf ${ev.timeStr} Uhr fokussiert`);
  };

  const timelineTicks = useMemo(() => {
    const span = timelineWindowMinutes;
    let stepMin = 240;
    if (span === 720) stepMin = 120;
    else if (span === 360) stepMin = 60;
    else if (span === 120) stepMin = 20;
    else if (span === 60) stepMin = 10;
    else if (span === 30) stepMin = 5;
    else if (span === 15) stepMin = 3;
    else if (span === 5) stepMin = 1;

    const ticks: { min: number; label: string; pct: number }[] = [];
    const start = timelineStartMin;
    const end = timelineStartMin + span;

    for (let m = start; m <= end; m += stepMin) {
      const hh = Math.floor(m / 60) % 24;
      const mm = m % 60;
      const label = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
      const pct = span > 0 ? ((m - start) / span) * 100 : 0;
      ticks.push({ min: m, label, pct });
    }
    return ticks;
  }, [timelineWindowMinutes, timelineStartMin]);
  const timelinePanStepMinutes = Math.min(60, timelineWindowMinutes);
  const timelinePanLabel = timelinePanStepMinutes === 60 ? "1h" : `${timelinePanStepMinutes}m`;

  const filteredMotionEvents = useMemo(() => {
    let list = motionEvents;
    if (eventLogSearch.trim()) {
      const q = eventLogSearch.toLowerCase().trim();
      list = list.filter(
        (ev) =>
          ev.timeStr.toLowerCase().includes(q) ||
          ev.cameraName.toLowerCase().includes(q) ||
          ev.message.toLowerCase().includes(q)
      );
    }
    if (eventLogTimeOfDay === "night") {
      list = list.filter((ev) => ev.totalMinutes >= 0 && ev.totalMinutes < 360);
    } else if (eventLogTimeOfDay === "morning") {
      list = list.filter((ev) => ev.totalMinutes >= 360 && ev.totalMinutes < 720);
    } else if (eventLogTimeOfDay === "afternoon") {
      list = list.filter((ev) => ev.totalMinutes >= 720 && ev.totalMinutes < 1080);
    } else if (eventLogTimeOfDay === "evening") {
      list = list.filter((ev) => ev.totalMinutes >= 1080 && ev.totalMinutes <= 1440);
    }
    return list;
  }, [motionEvents, eventLogSearch, eventLogTimeOfDay]);

  // Active clip index in current filtered list
  const activeClipIndex = useMemo(() => {
    if (!activeClip) return -1;
    return filteredClips.findIndex((c) => c.id === activeClip.id);
  }, [activeClip, filteredClips]);

  const activePlaybackUrl = activeClip
    ? compatiblePlayback
      ? `${activeClip.streamUrl}${activeClip.streamUrl.includes("?") ? "&" : "?"}compatible=1`
      : activeClip.streamUrl
    : "";

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

  useEffect(() => {
    if (!showStatsModal) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowStatsModal(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showStatsModal]);

  const toggleFullscreen = () => {
    if (!playerContainerRef.current) return;
    if (!document.fullscreenElement) {
      void playerContainerRef.current.requestFullscreen().then(() => setPlayerFullscreen(true)).catch(() => null);
    } else {
      void document.exitFullscreen().then(() => setPlayerFullscreen(false)).catch(() => null);
    }
  };

  useEffect(() => {
    if (activeClip && !playerFullscreen) {
      playerContainerRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [activeClip, playerFullscreen]);

  return (
    <div className="mx-auto max-w-6xl space-y-3 sm:space-y-5">
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

      {/* Central recording calendar */}
      <section id="recording-calendar" className="overflow-hidden rounded-xl border border-slate-800 bg-gradient-to-b from-slate-900/95 to-slate-950 shadow-xl sm:rounded-2xl">
        <div className="flex flex-col gap-3 border-b border-slate-800 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 p-2 text-sky-300">
              <Calendar className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Aufnahme-Kalender</h2>
              <p className="hidden text-[11px] text-slate-400 sm:block">Blaue Markierungen zeigen Tage mit vorhandenen Aufnahmen.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-sky-500/20 bg-sky-500/10 px-2.5 py-1 text-[11px] font-semibold text-sky-200">
              {loadingCalendar ? "Kalender wird geladen…" : `${calendarMonthClipCount} Clips im Monat`}
            </span>
            {selectedCameraId ? (
              <button
                type="button"
                onClick={() => {
                  setSelectedCameraId("");
                  void fetchClips("", selectedDate);
                }}
                className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-slate-300 hover:bg-slate-800 hover:text-white"
              >
                Alle Kameras anzeigen
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setMobileCalendarOpen((open) => !open)}
              className="ml-auto inline-flex touch-manipulation items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-slate-200 sm:hidden"
              aria-expanded={mobileCalendarOpen}
            >
              <span>{mobileCalendarOpen ? "Schließen" : selectedDate ? formatGermanDate(selectedDate) : "Kalender"}</span>
              {mobileCalendarOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        <div className={`${mobileCalendarOpen ? "grid" : "hidden"} gap-4 p-3 sm:grid sm:p-4 lg:grid-cols-[minmax(0,1fr)_260px]`}>
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
                    onClick={() => selectRecordingDate(date)}
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
      </section>

      {/* Sleek, Modern & Uncluttered Filter Bar */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-3 shadow-md">
        <div className="space-y-2 sm:hidden">
          <button
            type="button"
            onClick={() => setCameraPickerOpen(true)}
            className="flex min-h-11 w-full touch-manipulation items-center justify-between gap-3 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-left text-sm text-white"
            aria-haspopup="dialog"
            aria-expanded={cameraPickerOpen}
          >
            <span className="flex min-w-0 items-center gap-2">
              <Video className="h-4 w-4 shrink-0 text-sky-400" />
              <span className="truncate font-medium">
                {selectedCamera ? selectedCamera.name : "Alle Kameras"}
              </span>
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
          </button>
          {selectedCamera ? (
            <Link
              href={`/?editCamera=${encodeURIComponent(selectedCamera.id)}`}
              className="flex min-h-10 w-full touch-manipulation items-center justify-center gap-2 rounded-lg border border-indigo-500/35 bg-indigo-500/10 px-3 text-xs font-semibold text-indigo-200 active:scale-[0.98]"
            >
              <Pencil className="h-4 w-4" />
              Kamera bearbeiten
            </Link>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                setMobileCalendarOpen(true);
                requestAnimationFrame(() => document.getElementById("recording-calendar")?.scrollIntoView({ behavior: "smooth", block: "start" }));
              }}
              className="flex min-h-10 touch-manipulation items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-2 text-xs font-medium text-slate-200"
            >
              <Calendar className="h-4 w-4 text-sky-400" />
              <span className="truncate">{selectedDate ? formatGermanDate(selectedDate) : "Alle Tage"}</span>
            </button>
            <button
              type="button"
              onClick={() => setMobileFiltersOpen((open) => !open)}
              className={`flex min-h-10 touch-manipulation items-center justify-center gap-2 rounded-lg border px-2 text-xs font-semibold ${
                mobileFiltersOpen || activeAdvancedFilterCount > 0
                  ? "border-amber-500/50 bg-amber-500/10 text-amber-200"
                  : "border-slate-700 bg-slate-950 text-slate-200"
              }`}
              aria-expanded={mobileFiltersOpen}
            >
              <SlidersHorizontal className="h-4 w-4" />
              <span>Filter{activeAdvancedFilterCount > 0 ? ` (${activeAdvancedFilterCount})` : ""}</span>
              {mobileFiltersOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        <div className={`${mobileFiltersOpen ? "mt-3 flex" : "hidden"} flex-wrap items-center justify-between gap-2.5 border-t border-slate-800 pt-3 sm:flex sm:border-0 sm:pt-0`}>
          {/* Left Group: Search & Core Filters */}
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            {/* Search Input */}
            <div className="relative w-full min-w-[160px] sm:w-auto sm:min-w-[200px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Clip, Person, Auto, Kennzeichen..."
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

            {/* Quick Object Filter Pills */}
            <div className="flex items-center gap-1 overflow-x-auto py-0.5">
              {[
                { id: "all", label: "Alle" },
                { id: "person", label: "🚶 Person" },
                { id: "vehicle", label: "🚗 Fahrzeug" },
                { id: "animal", label: "🐾 Tier" },
                { id: "plate", label: "🏷️ Kennzeichen" },
              ].map((pill) => (
                <button
                  key={pill.id}
                  type="button"
                  onClick={() => {
                    setObjectFilter(pill.id as any);
                    setCurrentPage(1);
                  }}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors shrink-0 ${
                    objectFilter === pill.id
                      ? "bg-amber-500 text-black font-semibold shadow-sm"
                      : "bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-white"
                  }`}
                >
                  {pill.label}
                </button>
              ))}
            </div>

            {/* Camera Dropdown */}
            <div className="hidden items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-xs sm:flex">
              <Video className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <select
                value={selectedCameraId}
                onChange={(event) => selectCameraFilter(event.target.value)}
                className="max-w-[150px] cursor-pointer truncate bg-transparent text-xs text-white focus:outline-none"
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
                className="hidden items-center gap-1.5 rounded-lg border border-indigo-500/35 bg-indigo-500/10 px-2.5 py-1.5 text-xs font-semibold text-indigo-200 hover:bg-indigo-500/20 sm:flex"
                title={`${selectedCamera.name} bearbeiten`}
              >
                <Pencil className="h-3.5 w-3.5" />
                Bearbeiten
              </Link>
            ) : null}

            {/* Date selected in the central calendar */}
            <div className="hidden items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200 sm:flex">
              <Calendar className="h-3.5 w-3.5 shrink-0 text-sky-400" />
              <span>{selectedDate ? formatGermanDateLong(selectedDate) : "Alle Tage"}</span>
              {selectedDate ? (
                <button
                  type="button"
                  onClick={showAllRecordingDays}
                  className="ml-1 rounded px-1 text-slate-500 hover:bg-slate-800 hover:text-white"
                  aria-label="Datumsfilter aufheben"
                  title="Alle Tage anzeigen"
                >
                  ×
                </button>
              ) : null}
            </div>

            {/* Time of Day Preset Dropdown */}
            <div className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-xs">
              <Clock className="h-3.5 w-3.5 text-amber-400 shrink-0" />
              <select
                value={timePreset}
                onChange={(e) => handleTimePresetChange(e.target.value)}
                className="bg-transparent text-xs text-white focus:outline-none cursor-pointer"
              >
                <option value="all">Ganzer Tag (00–24 Uhr)</option>
                <option value="morning">🌅 Vormittag (06–12 Uhr)</option>
                <option value="afternoon">☀️ Nachmittag (12–18 Uhr)</option>
                <option value="evening">🌙 Abend (18–24 Uhr)</option>
                <option value="night">🌌 Nacht (00–06 Uhr)</option>
                <option value="custom">⚙️ Eigene Uhrzeit...</option>
              </select>
              {timePreset === "custom" && (
                <div className="flex items-center gap-1 ml-1">
                  <input
                    type="time"
                    value={timeFrom}
                    onChange={(e) => {
                      setTimeFrom(e.target.value);
                      setCurrentPage(1);
                    }}
                    className="bg-slate-900 border border-slate-700 rounded px-1 text-xs text-white"
                  />
                  <span className="text-slate-500">–</span>
                  <input
                    type="time"
                    value={timeTo}
                    onChange={(e) => {
                      setTimeTo(e.target.value);
                      setCurrentPage(1);
                    }}
                    className="bg-slate-900 border border-slate-700 rounded px-1 text-xs text-white"
                  />
                </div>
              )}
            </div>

            {/* Filter: Nur Clips mit Bewegung Toggle */}
            <button
              onClick={() => {
                setFilterMotionOnly(!filterMotionOnly);
                setCurrentPage(1);
              }}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-all ${
                filterMotionOnly
                  ? "bg-amber-500 text-slate-950 font-bold shadow-md shadow-amber-500/20"
                  : "border border-slate-800 bg-slate-950 text-slate-300 hover:text-white hover:border-slate-700"
              }`}
              title="Nur Aufnahmen mit erkannter Bewegung anzeigen"
            >
              <Zap className={`h-3.5 w-3.5 ${filterMotionOnly ? "fill-slate-950 text-slate-950" : "fill-amber-400 text-amber-400"}`} />
              <span>Nur Bewegung</span>
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

            {/* Storage target filter */}
            <div className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-xs">
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
                  <option key={target} value={target}>{target}</option>
                ))}
              </select>
            </div>

            {/* File size filter */}
            <div className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-xs">
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
          </div>

          {/* Right Group: Sort, View Switcher & Counter */}
          <div className="flex w-full items-center gap-2 sm:w-auto">
            {/* Sort Dropdown */}
            <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-950 px-2 py-1.5 text-xs">
              <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="bg-transparent text-xs text-white focus:outline-none cursor-pointer"
              >
                <option value="newest">Neueste zuerst</option>
                <option value="oldest">Älteste zuerst</option>
                <option value="camera-asc">Kamera A–Z</option>
                <option value="camera-desc">Kamera Z–A</option>
                <option value="motion-most">Meiste Bewegungen</option>
                <option value="motion-least">Wenigste Bewegungen</option>
                <option value="largest">Größte zuerst</option>
                <option value="smallest">Kleinste zuerst</option>
                <option value="storage-asc">Speicherort A–Z</option>
                <option value="storage-desc">Speicherort Z–A</option>
                <option value="filename-asc">Dateiname A–Z</option>
                <option value="filename-desc">Dateiname Z–A</option>
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

            <span className="text-[11px] text-slate-400 font-mono hidden md:inline">
              {filteredClips.length} {filteredClips.length === 1 ? "Clip" : "Clips"}
            </span>
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

      {/* Camera Motion Activity & Ranking Evaluation Modal */}
      <ActivityStatsModal
        isOpen={showStatsModal}
        onClose={() => setShowStatsModal(false)}
        activityStats={activityStats}
        loadingStats={loadingStats}
        statsPeriod={statsPeriod}
        onPeriodChange={(p) => {
          setStatsPeriod(p);
          fetchActivityStats(p);
        }}
        onSelectCameraFilter={(cameraId) => {
          setSelectedCameraId(cameraId);
          setShowStatsModal(false);
          fetchClips(cameraId, selectedDate);
        }}
      />


      {dailySummary && selectedDate && (
        <section className="mb-6 rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-cyan-950/20 to-slate-950 p-4 sm:p-5 shadow-xl">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-300">Tageszusammenfassung</p>
              <h2 className="mt-1 text-base font-bold text-white">{formatGermanDateLong(selectedDate)}</h2>
            </div>
            <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs font-semibold text-cyan-200">
              {dailySummary.totalEvents} Ereignisse
            </span>
          </div>
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
                  onClick={() => setSelectedCameraId(camera.cameraId)}
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
        </section>
      )}

      {/* Video Player Modal with Advanced NVR Controls */}
      {activeClip && (
        <div className={playerFullscreen ? "fixed inset-0 z-50 flex items-center justify-center bg-black overflow-hidden p-0" : "w-full mb-6 rounded-2xl border border-slate-800/90 bg-slate-950 p-2 sm:p-4 shadow-2xl overflow-hidden"}>
          <div
            ref={playerContainerRef}
            className={`group relative flex flex-col overflow-hidden bg-slate-950 transition-all ${
              playerFullscreen
                ? 'w-full h-full max-w-none rounded-none border-none'
                : 'w-full rounded-xl border border-slate-800/80 shadow-xl'
            }`}
          >
            {/* Player Header */}
            <div className={`flex items-center justify-between p-3.5 border-b border-slate-800 bg-slate-900/80 shrink-0 transition-opacity duration-300 ${playerFullscreen ? 'absolute top-0 inset-x-0 z-20 opacity-0 group-hover:opacity-100' : 'relative'}`}>
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
                    <span className="rounded bg-sky-500/20 border border-sky-500/40 px-2 py-0.5 text-[10px] font-bold text-sky-300 shadow-sm flex items-center gap-1">
                      <Film className="h-3 w-3 text-sky-400" />
                      Daueraufnahme (15 Min.)
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
                <Link
                  href={`/?editCamera=${encodeURIComponent(activeClip.cameraId)}`}
                  className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
                  title={`${activeClip.cameraName} bearbeiten`}
                  aria-label={`${activeClip.cameraName} bearbeiten`}
                >
                  <Pencil className="h-4 w-4" />
                </Link>
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
                  type="button"
                  onClick={() => handleShareClip(activeClip.id)}
                  disabled={sharingClip}
                  className="rounded-lg border border-amber-500/40 bg-amber-500/15 p-2 text-amber-300 hover:bg-amber-500/30 hover:text-white transition-colors disabled:opacity-50"
                  title="Clip mit Zeitstempel exportieren & Link teilen (48h gültig)"
                >
                  <Share2 className={`h-4 w-4 ${sharingClip ? "animate-spin" : ""}`} />
                </button>
                <button
                  onClick={() => {
                    setActiveClip(null);
                  }}
                  className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
                  title="Schließen (Taste Esc)"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Scrollable Player Body: Ensures Video, Timeline, and Toolbar are ALWAYS visible on any display */}
            <div className="flex-1 flex flex-col min-h-0 relative">
              {/* Video Element */}
              <div className={`relative bg-black flex items-center justify-center flex-1 overflow-hidden ${playerFullscreen ? 'h-full w-full' : 'max-h-[50vh] sm:max-h-[55vh] shrink-0'}`}>
                <video
                  ref={videoRef}
                  key={`${activeClip.id}-${compatiblePlayback ? "compatible" : "original"}-${playbackAttempt}`}
                  src={activePlaybackUrl}
                  autoPlay
                  playsInline
                  muted={isMuted}
                  className={`w-full h-full object-contain ${playerFullscreen ? '' : 'max-h-[50vh] sm:max-h-[55vh]'}`}
                  onPlay={() => {
                    setIsPlaying(true);
                    setPlayerNeedsStart(false);
                  }}
                  onPause={() => setIsPlaying(false)}
                  onLoadStart={() => {
                    if (compatiblePlayback) setPlayerPreparing(true);
                  }}
                  onCanPlay={(event) => {
                    setPlayerPreparing(false);
                    setPlayerError("");
                    void event.currentTarget.play()
                      .then(() => setPlayerNeedsStart(false))
                      .catch(() => {
                        // If unmuted autoplay blocked by browser, try muted autoplay
                        if (!isMuted && videoRef.current) {
                          videoRef.current.muted = true;
                          setIsMuted(true);
                          void videoRef.current.play()
                            .then(() => setPlayerNeedsStart(false))
                            .catch(() => setPlayerNeedsStart(true));
                        } else {
                          setPlayerNeedsStart(true);
                        }
                      });
                  }}
                  onError={() => {
                    if (!compatiblePlayback) {
                      setCompatiblePlayback(true);
                      setPlayerPreparing(true);
                      setPlayerError("");
                      return;
                    }
                    setPlayerPreparing(false);
                    setPlayerError("Das Video konnte auch im Smartphone-Modus nicht geladen werden.");
                  }}
                onLoadedMetadata={(e) => {
                  setPlayerPreparing(false);
                  setPlayerError("");
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
              <div
                data-pull-to-refresh-ignore="true"
                className="absolute inset-0 z-10 touch-manipulation select-none"
                onPointerDown={handlePlayerPointerDown}
                onPointerUp={handlePlayerPointerEnd}
                onPointerCancel={(event) => {
                  if (playerGestureRef.current.pointerId === event.pointerId) clearPlayerGesture();
                }}
                aria-label="Videogesten: links oder rechts doppeltippen für zehn Sekunden, gedrückt halten zum schnellen Spulen"
              />
              <div className="absolute bottom-3 left-3 z-20 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (!videoRef.current) return;
                    if (videoRef.current.paused) void videoRef.current.play();
                    else videoRef.current.pause();
                  }}
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-black/65 text-white shadow-xl backdrop-blur-md transition hover:bg-black/85"
                  aria-label={isPlaying ? "Pause" : "Abspielen"}
                  title={isPlaying ? "Pause" : "Abspielen"}
                >
                  {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const next = !isMuted;
                    setIsMuted(next);
                    if (videoRef.current) videoRef.current.muted = next;
                  }}
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-black/65 text-white shadow-xl backdrop-blur-md transition hover:bg-black/85"
                  aria-label={isMuted ? "Ton einschalten" : "Ton stummschalten"}
                  title={isMuted ? "Ton einschalten" : "Ton stummschalten"}
                >
                  {isMuted ? <VolumeX className="h-5 w-5 text-slate-400" /> : <Volume2 className="h-5 w-5 text-emerald-400" />}
                </button>
              </div>
              {seekFeedback ? (
                <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
                  <span className="rounded-full border border-white/15 bg-black/75 px-4 py-2 text-sm font-bold text-white shadow-2xl backdrop-blur-md">{seekFeedback}</span>
                </div>
              ) : null}
              {(playerPreparing || playerError || playerNeedsStart) && (
                <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/75 p-5 text-center">
                  <div className="max-w-xs rounded-xl border border-slate-700 bg-slate-950/95 px-4 py-3 shadow-xl">
                    {playerPreparing ? (
                      <>
                        <RefreshCw className="mx-auto h-6 w-6 animate-spin text-amber-400" />
                        <p className="mt-2 text-sm font-semibold text-white">Smartphone-Video wird vorbereitet</p>
                        <p className="mt-1 text-xs text-slate-400">Der Clip wird einmalig in ein kompatibles Format umgewandelt.</p>
                      </>
                    ) : playerNeedsStart ? (
                      <>
                        <Play className="mx-auto h-7 w-7 text-amber-400" />
                        <p className="mt-2 text-sm font-semibold text-white">Video ist bereit</p>
                        <button
                          type="button"
                          onClick={() => {
                            void videoRef.current?.play().then(() => setPlayerNeedsStart(false));
                          }}
                          className="mt-3 rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-slate-950"
                        >
                          Video starten
                        </button>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-semibold text-rose-200">{playerError}</p>
                        <button
                          type="button"
                          onClick={() => {
                            setPlayerError("");
                            setPlayerPreparing(true);
                            setPlaybackAttempt((attempt) => attempt + 1);
                          }}
                          className="mt-3 rounded-lg bg-amber-500 px-3 py-2 text-xs font-bold text-slate-950"
                        >
                          Erneut versuchen
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Combined Footer for Fullscreen / Normal */}
            <div className={`flex flex-col shrink-0 transition-opacity duration-300 ${playerFullscreen ? 'absolute bottom-0 inset-x-0 z-20 opacity-0 group-hover:opacity-100 bg-slate-950/80 backdrop-blur-md' : 'relative'}`}>
              {/* In-Clip Motion Timeline & Exact Moments Bar */}
              <div className="border-t border-slate-800 px-3 py-2.5">
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
                      <span className="text-sky-300 font-normal flex items-center gap-1.5">
                        <Film className="h-3.5 w-3.5 text-sky-400" />
                        Daueraufnahme aktiv (15 Min.)
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
                        className="absolute top-0 bottom-0 w-3 -ml-1.5 flex items-center justify-center cursor-pointer z-10 hover:scale-125 transition-transform group/marker"
                        style={{ left: `${markerPct}%` }}
                        title={`⚡ ${ev.timeStr} Uhr (bei ${formatSeconds(ev.offsetSec)}) - Klick zum Abspielen`}
                      >
                        <div
                          className={`w-[2px] h-full shadow-sm rounded-full ${
                            isCurrent
                              ? "bg-amber-300 ring-2 ring-amber-200/50 scale-125 z-20"
                              : "bg-amber-500/80 group-hover/marker:bg-amber-400 group-hover/marker:shadow-[0_0_8px_rgba(251,191,36,0.6)]"
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
              <div className="mt-2 flex items-center justify-between gap-2">
                <p className="text-[10px] text-slate-500 sm:hidden">
                  Doppeltippen links/rechts: 10 Sek. · Halten: schnell spulen
                </p>
                <span className="hidden sm:block" />
                <button
                  type="button"
                  onClick={() => setPlayerOptionsOpen((open) => !open)}
                  className={`ml-auto rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${playerOptionsOpen ? "border-amber-500/40 bg-amber-500/15 text-amber-200" : "border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800"}`}
                  aria-expanded={playerOptionsOpen}
                >
                  ⋯ Optionen
                </button>
              </div>
              </div>

              {/* Compact playback toolbar */}
              {playerOptionsOpen ? (
              <div className="p-4 sm:p-5 pb-6 border-t border-slate-800/50 flex flex-col gap-3.5 text-xs shrink-0">
              {/* Clip and motion navigation */}
              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    onClick={playPreviousClip}
                    disabled={activeClipIndex <= 0}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-slate-300 hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none transition-colors"
                    title="Vorheriger Clip"
                  >
                    <SkipBack className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Vorheriger</span>
                  </button>

                  {/* Direct Jump to Motion Buttons */}
                  {activeClipMotionEvents.length > 0 && (
                    <div className="flex items-center gap-1 border-l border-slate-800 pl-1.5">
                      <button
                        onClick={jumpToPrevMotion}
                        className="inline-flex items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-950/30 px-2.5 py-1.5 text-amber-300 hover:bg-amber-500/20 hover:border-amber-400 transition-colors"
                        title="Zur vorherigen Bewegung springen (Taste P)"
                      >
                        <Zap className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                        <span className="hidden md:inline">Vorh. Bew.</span>
                      </button>
                      <button
                        onClick={jumpToNextMotion}
                        className="inline-flex items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-950/30 px-2.5 py-1.5 text-amber-300 hover:bg-amber-500/20 hover:border-amber-400 transition-colors"
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
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-slate-300 hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none transition-colors"
                    title="Nächster Clip"
                  >
                    <span className="hidden sm:inline">Nächster</span>
                    <SkipForward className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Right side of Row 1: Delete Clip Button */}
                <button
                  onClick={() => handleDeleteClip(activeClip)}
                  className="inline-flex items-center gap-1 rounded-lg border border-rose-900/50 bg-rose-950/30 px-3 py-1.5 text-rose-300 hover:bg-rose-900/50 transition-colors shrink-0"
                  title="Diesen Clip von der Festplatte löschen"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Diesen Clip löschen</span>
                </button>
              </div>

              {/* Row 2: Speed, Auto-Play & Plant Sensitivity Helper */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2.5 border-t border-slate-800/80">
                <div className="flex flex-wrap items-center gap-3">
                  {/* Auto-Play */}
                  <button
                    type="button"
                    onClick={() => setAutoPlayNext(!autoPlayNext)}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                      autoPlayNext
                        ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm"
                        : "border border-slate-800 bg-slate-900 text-slate-400 hover:text-white"
                    }`}
                    title={autoPlayNext ? "Auto-Play aktiv: Nächster Clip startet automatisch" : "Auto-Play deaktiviert"}
                  >
                    <span>🔁</span>
                    <span>Auto-Play</span>
                  </button>

                  {/* Playback Speed */}
                  <div className="flex items-center gap-1">
                    <Gauge className="h-3.5 w-3.5 text-slate-400" />
                    <span className="text-[11px] text-slate-400 mr-1 hidden sm:inline">Tempo:</span>
                    {[0.5, 1, 1.5, 2, 4].map((rate) => (
                      <button
                        key={rate}
                        onClick={() => setSpeed(rate)}
                        className={`rounded px-2 py-1 font-mono text-[11px] transition-all ${
                          playbackRate === rate
                            ? "bg-amber-500 text-slate-950 font-bold shadow-sm"
                            : "border border-slate-800 bg-slate-900 text-slate-300 hover:text-white"
                        }`}
                      >
                        {rate}x
                      </button>
                    ))}
                  </div>
                </div>

              </div>
            </div>
              ) : null}
          </div>
        </div>
      </div>
    </div>
    )}

      {/* Modern High-Precision Timeline */}
      <div className="rounded-2xl border border-slate-800/90 bg-gradient-to-b from-slate-900/95 to-slate-950 p-4 sm:p-5 mb-6 shadow-2xl backdrop-blur-md">
        {/* Timeline Header & Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400">
              <Clock className="h-4 w-4" />
            </div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-white tracking-wide">
                Zeitleiste
              </h2>
              <span className="rounded-full bg-slate-800/90 border border-slate-700/80 px-2 py-0.5 text-[11px] font-mono text-slate-300">
                {selectedDate ? formatGermanDate(selectedDate) : "Alle Tage"}
              </span>
              {motionEvents.length > 0 && (
                <button
                  onClick={jumpToMotionCluster}
                  className="rounded-full bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 px-2.5 py-0.5 text-[11px] font-medium flex items-center gap-1 transition active:scale-95"
                  title="Fokus auf erste Bewegung"
                >
                  <Zap className="h-3 w-3 fill-amber-400 text-amber-400" />
                  <span>{motionEvents.length} {motionEvents.length === 1 ? "Bewegung" : "Bewegungen"}</span>
                </button>
              )}
            </div>
          </div>

          {/* Zoom Buttons & Timeline Navigation */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Pan Controls if zoomed */}
            {timelineWindowMinutes < 1440 && (
              <div className="flex items-center gap-1 bg-slate-950/80 border border-slate-800 rounded-lg p-0.5">
                <button
                  onClick={() => panTimeline(-timelinePanStepMinutes)}
                  disabled={timelineStartMin <= 0}
                  className="px-2 py-1 text-slate-400 hover:text-white disabled:opacity-30 disabled:pointer-events-none text-xs rounded hover:bg-slate-800 transition"
                  title={`${timelinePanLabel} zurückrollen`}
                >
                  ◄ -{timelinePanLabel}
                </button>
                <button
                  onClick={() => panTimeline(timelinePanStepMinutes)}
                  disabled={timelineStartMin + timelineWindowMinutes >= 1440}
                  className="px-2 py-1 text-slate-400 hover:text-white disabled:opacity-30 disabled:pointer-events-none text-xs rounded hover:bg-slate-800 transition"
                  title={`${timelinePanLabel} vorrollen`}
                >
                  +{timelinePanLabel} ►
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                if (selectedDate !== getTodayStr()) {
                  selectRecordingDate(getTodayStr());
                }
                goToNow();
              }}
              className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 transition"
              title="Zeitleiste auf die aktuelle Uhrzeit setzen"
            >
              Jetzt
            </button>

            {/* Zoom-Stufen */}
            <div className="flex flex-wrap items-center rounded-lg border border-slate-800 bg-slate-950/90 p-0.5 text-xs font-medium">
              <span className="text-[11px] text-slate-400 px-2 hidden md:inline">Zoom:</span>
              {TIMELINE_WINDOWS.map((option) => (
                <button
                  key={option.minutes}
                  onClick={() => zoomToWindow(option.minutes)}
                  className={`px-2 py-1 sm:px-2.5 rounded-md font-mono transition-all ${
                    timelineWindowMinutes === option.minutes
                      ? "bg-amber-500 text-slate-950 font-bold shadow-sm"
                      : "text-slate-400 hover:text-white"
                  }`}
                  title={`${option.label} Zeitbereich anzeigen`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {/* Visual Legend & Spur-Schalter */}
            <div className="flex items-center gap-1.5 text-[11px] font-medium bg-slate-950/70 border border-slate-800 p-0.5 rounded-lg">
              <button
                type="button"
                onClick={() => setShowVideoTrack(!showVideoTrack)}
                className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-xs transition ${
                  showVideoTrack
                    ? "text-sky-300 bg-sky-500/20 border border-sky-500/40 font-semibold"
                    : "text-slate-500 hover:text-slate-300 border border-transparent opacity-60"
                }`}
                title="Blaue Video-Spur ein- oder ausblenden"
              >
                <span className={`h-1.5 w-2 rounded-sm ${showVideoTrack ? "bg-sky-400 shadow-[0_0_6px_#38bdf8]" : "bg-slate-600"}`} />
                <span>Video-Spur</span>
              </button>
              <span className="flex items-center gap-1 px-1.5 py-0.5 text-amber-300 font-semibold">
                <span className="h-2 w-2 rounded-full bg-amber-400 shadow-[0_0_6px_#f59e0b]" />
                <span>Bewegung</span>
              </span>
            </div>
          </div>
        </div>

        {/* Timeline Bar Track */}
        <div
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const clickX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
            const pct = clickX / rect.width;
            const spanMin = timelineWindowMinutes;
            const clickSeconds = (timelineStartMin + pct * spanMin) * 60;
            const totalMinutes = Math.floor(clickSeconds / 60);
            const hour = Math.floor(totalMinutes / 60) % 24;
            const minute = totalMinutes % 60;
            const timeStr = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} Uhr`;

            const nearbyClip = timelineClips.find((c) => {
              const clipStartSec = parseTimeToSeconds(c.timeStr);
              const cam = cameras.find((cm) => cm.id === c.cameraId);
              const segSec = (cam?.recordSegmentMinutes || 15) * 60;
              return clickSeconds >= clipStartSec && clickSeconds <= clipStartSec + segSec + 15;
            }) || timelineClips.find((c) => {
              const clipStartSec = parseTimeToSeconds(c.timeStr);
              return Math.abs(clickSeconds - clipStartSec) <= 16 * 60;
            });

            const hasMotion = motionEvents.some(
              (ev) => Math.abs(ev.totalMinutes - totalMinutes) <= (timelineWindowMinutes <= 15 ? 0.25 : timelineWindowMinutes <= 120 ? 1 : 4)
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
            const spanMin = timelineWindowMinutes;
            const clickSeconds = (timelineStartMin + pct * spanMin) * 60;
            const totalMinutes = Math.floor(clickSeconds / 60);

            // Find matching clip at this time (exact second accuracy + duration tolerance)
            const matchingClip = timelineClips.find((c) => {
              const clipStartSec = parseTimeToSeconds(c.timeStr);
              const cam = cameras.find((cm) => cm.id === c.cameraId);
              const segSec = (cam?.recordSegmentMinutes || 15) * 60;
              return clickSeconds >= clipStartSec && clickSeconds <= clipStartSec + segSec + 15;
            }) || timelineClips.find((c) => {
              const clipStartSec = parseTimeToSeconds(c.timeStr);
              return Math.abs(clickSeconds - clipStartSec) <= 16 * 60;
            });

            if (matchingClip) {
              const clipStartSec = parseTimeToSeconds(matchingClip.timeStr);
              const offset = Math.max(0, Math.floor(clickSeconds - clipStartSec));
              openClipWithOffset(matchingClip, offset);
            } else {
              // Check if a motion event is near this point on the timeline
              const nearbyEvent = motionEvents.find((ev) => Math.abs(ev.totalMinutes - totalMinutes) <= 2);
              if (nearbyEvent) {
                void playEvent(nearbyEvent);
                return;
              }
              const hour = Math.floor(totalMinutes / 60) % 24;
              const minute = totalMinutes % 60;
              const timeFormatted = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} Uhr`;
              toast.info(`Keine Aufnahme für ${timeFormatted} vorhanden.`);
            }
          }}
          className="relative h-14 sm:h-16 w-full rounded-xl bg-slate-950 border border-slate-800/90 shadow-inner overflow-hidden cursor-crosshair select-none group"
          title="Klicke auf die Zeitleiste zum Abspielen oder Vorfall-Prüfen"
        >
          {/* Subtle background hour/slot grid stripes */}
          <div className="absolute inset-0 flex pointer-events-none opacity-20">
            {timelineTicks.map((_, i) => (
              <div
                key={i}
                className={`flex-1 h-full border-r border-slate-700/60 ${
                  i % 2 === 0 ? "bg-slate-800/25" : ""
                }`}
              />
            ))}
          </div>

          {/* Active Time Window Highlight if timeFrom / timeTo are set */}
          {timeFrom && (
            (() => {
              const spanMin = timelineWindowMinutes;
              const vStart = timelineStartMin;
              const vEnd = timelineStartMin + spanMin;
              const [fH, fM] = timeFrom.split(":").map(Number);
              const [tH, tM] = (timeTo || "24:00").split(":").map(Number);
              const startMin = (isNaN(fH) ? 0 : fH) * 60 + (isNaN(fM) ? 0 : fM);
              const endMin = (isNaN(tH) ? 24 : tH) * 60 + (isNaN(tM) ? 0 : tM);

              if (endMin < vStart || startMin > vEnd) return null;
              const rStart = Math.max(vStart, startMin);
              const rEnd = Math.min(vEnd, endMin);
              const leftPct = ((rStart - vStart) / spanMin) * 100;
              const widthPct = Math.max(0.5, ((rEnd - rStart) / spanMin) * 100);

              return (
                <div
                  className="absolute top-0 bottom-0 bg-amber-500/15 border-x border-amber-500/50 pointer-events-none z-0"
                  style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                />
              );
            })()
          )}

          {/* Recorded Clips as a sleek modern slim baseline track */}
          {showVideoTrack &&
            timelineClips.map((clip) => {
              const spanMin = timelineWindowMinutes;
              const vStart = timelineStartMin;
              const vEnd = timelineStartMin + spanMin;
              const timeParts = clip.timeStr.split(":").map(Number);
              const hh = isNaN(timeParts[0]) ? 0 : timeParts[0];
              const mm = isNaN(timeParts[1]) ? 0 : timeParts[1];
              const ss = isNaN(timeParts[2]) ? 0 : timeParts[2];
              const clipStartMin = hh * 60 + mm + ss / 60;
              const camInfo = cameras.find((c) => c.id === clip.cameraId);
              const clipDurationMin = camInfo?.recordSegmentMinutes || 15;
              const clipEndMin = clipStartMin + clipDurationMin;

              if (clipEndMin < vStart || clipStartMin > vEnd) return null;

              const rStart = Math.max(vStart, clipStartMin);
              const rEnd = Math.min(vEnd, clipEndMin);
              const leftPct = ((rStart - vStart) / spanMin) * 100;
              const widthPct = Math.max(0.4, ((rEnd - rStart) / spanMin) * 100);
              const isCurrentPlaying = activeClip?.id === clip.id;

              return (
                <div
                  key={clip.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    const clipRect = e.currentTarget.getBoundingClientRect();
                    const innerPct = Math.max(0, Math.min(1, (e.clientX - clipRect.left) / clipRect.width));
                    const cam = cameras.find((cm) => cm.id === clip.cameraId);
                    const segSec = (cam?.recordSegmentMinutes || 15) * 60;
                    const offset = Math.floor(innerPct * segSec);
                    openClipWithOffset(clip, offset);
                  }}
                  className={`absolute top-2 bottom-2 rounded-lg transition-all cursor-pointer z-10 ${
                    isCurrentPlaying
                      ? "bg-sky-500/50 border-2 border-cyan-300 shadow-lg shadow-cyan-500/40 z-20"
                      : "bg-sky-500/25 hover:bg-sky-400/50 border border-sky-400/35 hover:border-sky-300 shadow-sm"
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

          {/* Motion Event Markers Layer */}
          {motionEvents.map((ev) => {
            const spanMin = timelineWindowMinutes;
            const vStart = timelineStartMin;
            const vEnd = timelineStartMin + spanMin;
            const evMin = ev.totalMinutes;

            if (evMin < vStart || evMin > vEnd) return null;
            const leftPct = ((evMin - vStart) / spanMin) * 100;
            const isHighZoom = timelineWindowMinutes <= 120;

            return (
              <div
                key={ev.id}
                onClick={(e) => {
                  e.stopPropagation();
                  playEvent(ev);
                }}
                className={`group/ev absolute top-1 bottom-3 z-25 cursor-pointer flex flex-col items-center justify-between pointer-events-auto transition-transform ${
                  isHighZoom ? "w-4 -ml-2 hover:scale-125" : "w-2.5 -ml-[5px] hover:scale-110"
                }`}
                style={{ left: `${leftPct}%` }}
                title={`⚡ ${ev.timeStr} Uhr: ${ev.message} (${ev.cameraName}) - Klick zum Abspielen`}
              >
                <div
                  className={`rounded-full bg-amber-400 border border-white shadow-[0_0_10px_#f59e0b] group-hover/ev:scale-125 transition-transform flex items-center justify-center ${
                    isHighZoom ? "h-3.5 w-3.5" : "h-2 w-2"
                  }`}
                >
                  {isHighZoom && <Zap className="h-2 w-2 text-slate-950 fill-slate-950" />}
                </div>
                <div
                  className={`flex-1 bg-amber-400/80 shadow-[0_0_6px_#f59e0b] ${
                    isHighZoom ? "w-[2px] bg-amber-300" : "w-[1px]"
                  }`}
                />
                <div
                  className={`rounded-full bg-amber-400 ${
                    isHighZoom ? "h-2 w-2" : "h-1.5 w-1.5"
                  }`}
                />
              </div>
            );
          })}

          {/* Indicator for currently playing clip */}
          {activeClip && (
            (() => {
              const spanMin = timelineWindowMinutes;
              const vStart = timelineStartMin;
              const vEnd = timelineStartMin + spanMin;
              const timeParts = activeClip.timeStr.split(":").map(Number);
              const hh = isNaN(timeParts[0]) ? 0 : timeParts[0];
              const mm = isNaN(timeParts[1]) ? 0 : timeParts[1];
              const ss = isNaN(timeParts[2]) ? 0 : timeParts[2];
              const startMin = hh * 60 + mm + ss / 60;
              const currentMin = startMin + (videoCurrentTime / 60);

              if (currentMin < vStart || currentMin > vEnd) return null;
              const leftPct = ((currentMin - vStart) / spanMin) * 100;

              return (
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-cyan-300 z-30 pointer-events-none shadow-[0_0_12px_#38bdf8]"
                  style={{ left: `${leftPct}%` }}
                >
                  <div className="absolute -top-1.5 -left-2 h-4 w-4 rounded-full bg-cyan-400 border-2 border-white shadow-lg animate-pulse" />
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

        {/* Dynamic Zoom Ruler Axis with German time formatting */}
        <div className="relative mt-2 h-4 select-none">
          {timelineTicks.map((tick, idx) => (
            <span
              key={idx}
              className="absolute text-[10px] font-mono text-slate-400 -translate-x-1/2 hover:text-white transition-colors"
              style={{
                left: `${Math.max(1.5, Math.min(98.5, tick.pct))}%`,
              }}
            >
              {tick.label}
            </span>
          ))}
        </div>

        {/* Mini-Map Overview when zoomed in */}
        {timelineWindowMinutes < 1440 && (
          <div className="mt-3 pt-2 border-t border-slate-800/60 flex items-center gap-3">
            <span className="text-[10px] text-slate-500 font-mono shrink-0">24h Übersicht:</span>
            <div
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const clickX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
                const pct = clickX / rect.width;
                const clickMin = Math.floor(pct * 1440);
                zoomToWindow(timelineWindowMinutes, clickMin);
              }}
              className="relative h-2.5 flex-1 rounded bg-slate-950 border border-slate-800 overflow-hidden cursor-pointer"
              title="Klicke auf die 24h-Leiste, um das Zoom-Fenster zu verschieben"
            >
              {/* Highlight window */}
              <div
                className="absolute top-0 bottom-0 bg-amber-500/40 border border-amber-400 rounded-sm"
                style={{
                  left: `${(timelineStartMin / 1440) * 100}%`,
                  width: `${(timelineWindowMinutes / 1440) * 100}%`,
                  minWidth: "3px",
                }}
              />
            </div>
            <span className="text-[10px] text-slate-400 font-mono shrink-0">
              {formatMinutesToTime(timelineStartMin)} - {formatMinutesToTime(timelineStartMin + timelineWindowMinutes)}
            </span>
          </div>
        )}

        {/* Ereignis-Chronik (Detaillierter Bewegungs-Inspektor) */}
        <div className="mt-4 pt-3.5 border-t border-slate-800/80">
          <div className="flex flex-wrap items-center justify-between gap-2.5 mb-2.5">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowEventLog(!showEventLog)}
                className="flex items-center gap-2 text-xs font-bold text-white hover:text-amber-400 transition"
              >
                <div className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                <span>Ereignis-Chronik für {formatGermanDate(selectedDate)}</span>
                <span className="rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-0.2 text-[10px] font-mono">
                  {motionEvents.length} {motionEvents.length === 1 ? "Ereignis" : "Ereignisse"}
                </span>
                <span className="text-slate-400 text-xs">
                  {showEventLog ? "▲" : "▼"}
                </span>
              </button>
            </div>

            {showEventLog && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {/* Search */}
                <input
                  type="text"
                  placeholder="Filter (z.B. 11:25)..."
                  value={eventLogSearch}
                  onChange={(e) => setEventLogSearch(e.target.value)}
                  className="rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                />

                {/* Tageszeit Dropdown Filter */}
                <select
                  value={eventLogTimeOfDay}
                  onChange={(e) => setEventLogTimeOfDay(e.target.value as any)}
                  className="rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1 text-xs text-white focus:outline-none cursor-pointer"
                >
                  <option value="all">Alle Tageszeiten</option>
                  <option value="morning">🌅 Vormittag (06–12 Uhr)</option>
                  <option value="afternoon">☀️ Nachmittag (12–18 Uhr)</option>
                  <option value="evening">🌙 Abend (18–24 Uhr)</option>
                  <option value="night">🌌 Nacht (00–06 Uhr)</option>
                </select>
              </div>
            )}
          </div>

          {showEventLog && (
            <div className="space-y-2">
              {filteredMotionEvents.length === 0 ? (
                <div className="p-4 rounded-xl border border-slate-800/80 bg-slate-950/40 text-center text-xs text-slate-400">
                  {motionEvents.length === 0
                    ? `Keine Bewegungsereignisse für ${formatGermanDate(selectedDate)} erfasst.`
                    : "Keine Ereignisse für den gewählten Filter gefunden."}
                </div>
              ) : (
                <div className="max-h-72 overflow-y-auto pr-1 space-y-1.5 scrollbar-thin">
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                    {filteredMotionEvents.map((ev) => (
                      <div
                        key={ev.id}
                        className="flex items-center justify-between gap-2 p-2.5 rounded-xl border border-slate-800 bg-slate-950/80 hover:border-amber-500/50 hover:bg-slate-900 transition-all shadow-sm group"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <Zap className="h-3 w-3 text-amber-400 fill-amber-400 shrink-0" />
                            <span className="text-xs font-mono font-bold text-white">
                              {ev.timeStr} Uhr
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-400 truncate mt-0.5">
                            {ev.cameraName} · {ev.message}
                          </p>
                          {ev.objectDetections && ev.objectDetections.length > 0 ? (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {ev.objectDetections.map((detection, index) => (
                                <span key={`${detection.className || detection.group}-${index}`} className="rounded bg-cyan-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-cyan-300">
                                  {objectClassLabels[detection.className || ""] || detection.className || detection.group || "Objekt"}
                                  {typeof detection.score === "number" ? ` ${Math.round(detection.score * 100)} %` : ""}
                                </span>
                              ))}
                            </div>
                          ) : ev.objectClasses && ev.objectClasses.length > 0 ? (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {ev.objectClasses.map((group) => (
                                <span key={group} className="rounded bg-cyan-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-cyan-300">
                                  {group === "person" ? "Person" : group === "vehicle" ? "Fahrzeug" : group === "animal" ? "Tier" : group}
                                </span>
                              ))}
                            </div>
                          ) : null}
                          {ev.motionRecordingStatus && !["ready", "continuous"].includes(ev.motionRecordingStatus) && (
                            <p className={`mt-0.5 text-[9px] ${["failed", "disabled"].includes(ev.motionRecordingStatus) ? "text-rose-400" : "text-amber-400"}`} title={ev.motionRecordingError || undefined}>
                              {ev.motionRecordingStatus === "failed"
                                ? "Clip konnte nicht erstellt werden"
                                : ev.motionRecordingStatus === "disabled"
                                  ? "Bewegungsaufnahme war nicht aktiv"
                                  : "Clip wird erstellt …"}
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {ev.imageUrl && (
                            <button
                              onClick={() => setSelectedSnapshot({ url: ev.imageUrl!, title: `${ev.cameraName} (${ev.timeStr} Uhr) · ${ev.message}` })}
                              className="rounded p-1 text-slate-400 hover:text-red-400 hover:bg-slate-800 transition"
                              title="Schnappschuss mit rotem Erkennungsrahmen ansehen"
                            >
                              <ImageIcon className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button
                            onClick={() => focusEventOnTimeline(ev)}
                            className="rounded p-1 text-slate-400 hover:text-white hover:bg-slate-800 transition"
                            title="Zeitleiste auf diese Minute zoomen"
                          >
                            <Search className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => playEvent(ev)}
                            className="inline-flex items-center gap-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-2 py-1 text-[11px] shadow-sm transition active:scale-95"
                            title={`Abspielen ab ${ev.timeStr} Uhr`}
                          >
                            <Play className="h-3 w-3 fill-current" />
                            Play
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
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
                    <button
                      type="button"
                      onClick={() => toggleTableSort("motion-least", "motion-most")}
                      className="inline-flex items-center gap-1 hover:text-white"
                      title="Nach Anzahl der Bewegungen sortieren"
                    >
                      Bewegung <span aria-hidden="true">{sortIndicator("motion-least", "motion-most")}</span>
                    </button>
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

                      {/* Play Button & Thumbnail */}
                      <td className="py-2 px-3">
                        <div className="relative h-12 w-20 bg-slate-900 rounded overflow-hidden group/thumb flex items-center justify-center shrink-0 border border-slate-700/50">
                          <LazyVideoThumb
                            src={`${clip.streamUrl}#t=0.1`}
                            className="absolute inset-0 w-full h-full object-cover opacity-60 group-hover/thumb:opacity-100 transition-opacity"
                          />
                          <button
                            onClick={() =>
                              clipMotions.length > 0
                                ? openClipWithOffset(clip, clipMotions[0].offsetSec)
                                : openClip(clip)
                            }
                            className="relative z-10 inline-flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/90 text-slate-950 hover:bg-amber-400 hover:scale-105 active:scale-95 transition-all shadow-sm font-bold opacity-0 group-hover/thumb:opacity-100"
                            title={
                              clipMotions.length > 0
                                ? `Abspielen ab 1. Bewegung (${clipMotions[0].timeStr} Uhr)`
                                : "Abspielen"
                            }
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
                          <button
                            onClick={() => openClip(clip)}
                            className="inline-flex items-center gap-1 rounded-md bg-sky-500/10 border border-sky-500/30 px-2 py-0.5 text-[11px] font-semibold text-sky-300 hover:bg-sky-500/20 transition-colors group/d w-fit cursor-pointer"
                            title="Klick zum Abspielen dieser Daueraufnahme"
                          >
                            <Film className="h-3 w-3 text-sky-400 group-hover/d:scale-110 transition-transform" />
                            <span>Daueraufnahme (15m)</span>
                          </button>
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
                      <td className="sticky right-0 z-10 bg-slate-900/95 py-2 px-2 text-right shadow-[-8px_0_12px_rgba(2,6,23,0.65)] backdrop-blur-sm sm:px-3">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            onClick={() =>
                              clipMotions.length > 0
                                ? openClipWithOffset(clip, clipMotions[0].offsetSec)
                                : openClip(clip)
                            }
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
            const clipMotions = clipMotionMap.get(clip.id) || [];
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
                      onClick={() =>
                        clipMotions.length > 0
                          ? openClipWithOffset(clip, clipMotions[0].offsetSec)
                          : openClip(clip)
                      }
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
                    <button
                      onClick={() => openClip(clip)}
                      className="w-full flex items-center justify-between text-[10px] text-sky-300 bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/25 rounded px-2 py-1 mt-1.5 text-left transition-colors cursor-pointer group/d"
                      title="Klick zum Abspielen dieser Daueraufnahme"
                    >
                      <span className="flex items-center gap-1 font-semibold">
                        <Film className="h-2.5 w-2.5 text-sky-400 group-hover/d:scale-110 transition-transform shrink-0" />
                        Daueraufnahme
                      </span>
                      <span className="text-slate-400 font-mono">15 Min.</span>
                    </button>
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

      {cameraPickerOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-end overscroll-none bg-black/70 backdrop-blur-sm sm:hidden"
          role="presentation"
          onClick={() => setCameraPickerOpen(false)}
        >
          <div
            className="flex h-[72dvh] max-h-[calc(100dvh-env(safe-area-inset-top)-1rem)] w-full min-h-0 flex-col overflow-hidden rounded-t-2xl border-x border-t border-slate-700 bg-slate-950 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="camera-picker-title"
            onClick={(event) => event.stopPropagation()}
            data-pull-to-refresh-ignore="true"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-slate-800 px-4 py-3">
              <div>
                <h2 id="camera-picker-title" className="font-semibold text-white">Kamera auswählen</h2>
                <p className="mt-0.5 text-xs text-slate-400">Aufnahmen nach Kamera filtern</p>
              </div>
              <button
                type="button"
                onClick={() => setCameraPickerOpen(false)}
                className="touch-manipulation rounded-lg border border-slate-700 bg-slate-900 p-2 text-slate-300 active:bg-slate-800"
                aria-label="Kamera-Auswahl schließen"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div
              className="min-h-0 flex-1 touch-pan-y space-y-1 overflow-y-scroll overscroll-contain p-3 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
              style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}
              onTouchMove={(event) => event.stopPropagation()}
              data-pull-to-refresh-ignore="true"
            >
              <button
                type="button"
                onClick={() => selectCameraFilter("")}
                className={`flex min-h-12 w-full touch-manipulation items-center justify-between rounded-xl border px-3 py-2.5 text-left text-sm ${
                  !selectedCameraId
                    ? "border-amber-400/60 bg-amber-500/15 text-amber-100"
                    : "border-slate-800 bg-slate-900 text-slate-200 active:bg-slate-800"
                }`}
              >
                <span className="font-medium">Alle Kameras</span>
                {!selectedCameraId && <span className="text-amber-300">✓</span>}
              </button>
              {cameras.map((camera) => (
                <button
                  key={camera.id}
                  type="button"
                  onClick={() => selectCameraFilter(camera.id)}
                  className={`flex min-h-12 w-full touch-manipulation items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left text-sm ${
                    selectedCameraId === camera.id
                      ? "border-sky-400/60 bg-sky-500/15 text-sky-100"
                      : "border-slate-800 bg-slate-900 text-slate-200 active:bg-slate-800"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{camera.name}</span>
                    <span className="block truncate text-xs text-slate-500">{camera.ip}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {camera.recordEnabled && <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-rose-300">● REC</span>}
                    {selectedCameraId === camera.id && <span className="text-sky-300">✓</span>}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {selectedSnapshot && (
        <SnapshotLightboxModal
          snapshot={selectedSnapshot}
          onClose={() => setSelectedSnapshot(null)}
        />
      )}
    </div>
  );
}
