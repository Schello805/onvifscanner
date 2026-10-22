"use client";

import { useEffect, useState, useRef, useMemo, useCallback, type PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import { Search, Video } from "lucide-react";
import { useToast } from "@/components/ToastProvider";
import { useBodyScrollLock } from "@/lib/useBodyScrollLock";
import { type ActivityStatsResponse, type CameraSimple, type RecordingClip, type RecordingCalendarDay, type ClipSortBy, type ClipSizeFilter, type TimelineWindowMinutes, cameraNameCollator, type MotionEvent, type DailySummary, type ClipMotionEvent } from "@/components/playback/playbackTypes";
import { parseTimeToSeconds, getMotionEventsForClip, getTodayStr } from "@/components/playback/playbackUtils";
import { chronologicalCameraClips, recordingAt, recordingStart, recordingDayPosition } from "./playbackTiming";

export function usePlaybackPage() {
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
  const [jumpTimeInput, setJumpTimeInput] = useState<string>(() => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  });

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
  const [playbackOffset, setPlaybackOffset] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const playbackIntentRef = useRef(true);
  const scrubbingRef = useRef(false);
  const resumeAfterScrubRef = useRef(true);
  const suppressPlayerScrollRef = useRef(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [playerFullscreen, setPlayerFullscreen] = useState(false);
  const [autoPlayNext, setAutoPlayNext] = useState(true);
  const [videoDuration, setVideoDuration] = useState<number>(0);
  const [videoCurrentTime, setVideoCurrentTime] = useState<number>(0);
  const [liveTranscode, setLiveTranscode] = useState(false);
  const [playerPreparing, setPlayerPreparing] = useState(false);
  const [playerError, setPlayerError] = useState("");
  const [playerNeedsStart, setPlayerNeedsStart] = useState(false);
  const [playbackAttempt, setPlaybackAttempt] = useState(0);
  const [seekFeedback, setSeekFeedback] = useState("");
  const [playerOptionsOpen, setPlayerOptionsOpen] = useState(false);
  const pendingSeekRef = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
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
    setActiveClip(null);
    setIsPlaying(false);
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
  const playRequestedVideo = useCallback(() => {
    const video = videoRef.current;
    if (!video || !playbackIntentRef.current) return;
    void video.play().catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (videoRef.current === video && playbackIntentRef.current) setPlayerNeedsStart(true);
    });
  }, []);

  const seekToOffset = useCallback((seconds: number) => {
    let target = Math.max(0, seconds);
    const video = videoRef.current;
    if (video && Number.isFinite(video.duration)) {
      target = Math.min(target, Math.max(0, video.duration - 0.001));
    }
    pendingSeekRef.current = target;
    playbackIntentRef.current = !scrubbingRef.current;
    if (video && video.readyState >= 1) {
      video.currentTime = target;
      pendingSeekRef.current = null;
      if (playbackIntentRef.current) playRequestedVideo();
      else video.pause();
    }
    setVideoCurrentTime(target);
    setPlayerError("");
    setIsPlaying(playbackIntentRef.current);
  }, [playRequestedVideo]);

  const beginScrubbing = useCallback(() => {
    if (scrubbingRef.current) return;
    resumeAfterScrubRef.current = activeClip ? playbackIntentRef.current : true;
    scrubbingRef.current = true;
    playbackIntentRef.current = false;
    videoRef.current?.pause();
    setIsPlaying(false);
    setIsScrubbing(true);
  }, [activeClip]);

  const endScrubbing = useCallback((resume = true) => {
    if (!scrubbingRef.current) return;
    scrubbingRef.current = false;
    playbackIntentRef.current = resume && resumeAfterScrubRef.current;
    setIsScrubbing(false);
    setIsPlaying(playbackIntentRef.current);
    if (playbackIntentRef.current) playRequestedVideo();
    else videoRef.current?.pause();
  }, [playRequestedVideo]);

  const openClip = (clip: RecordingClip) => {
    suppressPlayerScrollRef.current = false;
    playbackIntentRef.current = true;
    setVideoDuration(0);
    setVideoCurrentTime(0);
    setPlaybackOffset(0);
    pendingSeekRef.current = null;
    setLiveTranscode(false);
    setPlayerPreparing(false);
    setPlayerError("");
    setPlayerNeedsStart(false);
    setPlaybackAttempt(0);
    setPlayerOptionsOpen(false);
    setActiveClip(clip);
    setIsPlaying(true);
  };

  const openClipWithOffset = useCallback((clip: RecordingClip, offsetSec = 0) => {
    const target = Math.max(0, offsetSec);
    if (activeClip?.id === clip.id) {
      seekToOffset(target);
      return;
    }
    suppressPlayerScrollRef.current = Boolean(activeClip?.id) && scrubbingRef.current;
    playbackIntentRef.current = !scrubbingRef.current;
    setPlaybackOffset(0);
    setVideoDuration(0);
    setVideoCurrentTime(0);
    pendingSeekRef.current = target;
    setLiveTranscode(false);
    setPlayerPreparing(false);
    setPlayerError("");
    setPlayerNeedsStart(false);
    setPlayerOptionsOpen(false);
    setActiveClip(clip);
    setPlaybackAttempt((attempt) => attempt + 1);
    setIsPlaying(playbackIntentRef.current);
  }, [activeClip?.id, seekToOffset]);

  useEffect(() => {
    if (activeClip?.timeStr) {
      setJumpTimeInput(activeClip.timeStr.slice(0, 5));
    }
  }, [activeClip?.id, activeClip?.timeStr]);

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
  const showSeekFeedback = useCallback((label: string) => {
    if (seekFeedbackTimerRef.current !== null) window.clearTimeout(seekFeedbackTimerRef.current);
    setSeekFeedback(label);
    seekFeedbackTimerRef.current = window.setTimeout(() => {
      setSeekFeedback("");
      seekFeedbackTimerRef.current = null;
    }, 700);
  }, []);

  const togglePlay = useCallback(() => {
    if (videoRef.current) {
      if (videoRef.current.paused) {
        playbackIntentRef.current = true;
        playRequestedVideo();
        setIsPlaying(true);
      } else {
        playbackIntentRef.current = false;
        videoRef.current.pause();
        setIsPlaying(false);
      }
    }
  }, [playRequestedVideo]);

  const seekRelative = useCallback((seconds: number) => {
    if (!activeClip) return;
    const cam = cameras.find((c) => c.id === activeClip.cameraId);
    const configuredSegSec = (cam?.recordSegmentMinutes || 15) * 60;
    const segSec = videoRef.current && Number.isFinite(videoRef.current.duration) && videoRef.current.duration > 0
      ? videoRef.current.duration
      : typeof activeClip.durationSeconds === "number" && activeClip.durationSeconds > 0
      ? activeClip.durationSeconds
      : configuredSegSec;
    const currentPos = pendingSeekRef.current ?? videoRef.current?.currentTime ?? videoCurrentTime;
    const newTarget = currentPos + seconds;

    // Inside current clip bounds
    if (newTarget >= 0 && newTarget < segSec) {
      seekToOffset(newTarget);
      showSeekFeedback(seconds < 0 ? `${seconds}s` : `+${seconds}s`);
      return;
    }

    // Crossing clip boundary:
    const sameCameraClips = chronologicalCameraClips(clips, activeClip.cameraId);

    const targetTimestamp = recordingStart(activeClip) + newTarget;
    const matchingClip = recordingAt(sameCameraClips, targetTimestamp, configuredSegSec);
    if (matchingClip && matchingClip.id !== activeClip.id) {
      openClipWithOffset(matchingClip, targetTimestamp - recordingStart(matchingClip));
      showSeekFeedback(`${seconds > 0 ? "+" : ""}${seconds}s`);
      return;
    }

    const currentIndex = sameCameraClips.findIndex((c) => c.id === activeClip.id);

    if (newTarget < 0) {
      if (currentIndex > 0) {
        const prevClip = sameCameraClips[currentIndex - 1];
        const previousDuration = prevClip.durationSeconds || configuredSegSec;
        const targetOffset = Math.max(0, previousDuration - 0.001);
        openClipWithOffset(prevClip, targetOffset);
        showSeekFeedback(seconds < 0 ? `${seconds}s (Vorheriger Clip)` : `Clip gewechselt`);
        return;
      } else {
        seekToOffset(0);
        showSeekFeedback("Anfang der Aufnahmen");
        return;
      }
    }

    if (newTarget >= segSec) {
      if (currentIndex >= 0 && currentIndex < sameCameraClips.length - 1) {
        const nextClip = sameCameraClips[currentIndex + 1];
        const targetOffset = 0;
        openClipWithOffset(nextClip, targetOffset);
        showSeekFeedback(`+${seconds}s (Nächster Clip)`);
        return;
      } else {
        seekToOffset(Math.max(0, segSec - 5));
        showSeekFeedback("Ende der Aufnahmen");
        return;
      }
    }
  }, [activeClip, clips, cameras, videoCurrentTime, seekToOffset, openClipWithOffset, showSeekFeedback]);

  const jumpToTime = useCallback(async (timeStr: string) => {
    if (!timeStr) {
      toast.warning("Bitte eine Uhrzeit angeben (z.B. 14:30)");
      return;
    }
    const targetSec = parseTimeToSeconds(timeStr);
    const camId = selectedCameraId || (cameras.length > 0 ? cameras[0].id : "");
    if (!camId) {
      toast.warning("Bitte zuerst eine Kamera auswählen");
      return;
    }
    if (!selectedCameraId && camId) {
      setSelectedCameraId(camId);
    }
    const dateStr = selectedDate || getTodayStr();

    let camClips = clips.filter((c) => c.cameraId === camId);

    if (camClips.length === 0) {
      try {
        const res = await fetch(`/api/nvr/recordings?cameraId=${encodeURIComponent(camId)}&date=${encodeURIComponent(dateStr)}`);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.clips) && data.clips.length > 0) {
            camClips = data.clips;
            setClips((prev) => {
              const prevIds = new Set(prev.map(c => c.id));
              const newOnes = data.clips.filter((c: RecordingClip) => !prevIds.has(c.id));
              return newOnes.length > 0 ? [...newOnes, ...prev] : prev;
            });
          }
        }
      } catch {}
    }

    if (camClips.length === 0) {
      toast.warning(`Keine Aufnahmen für ${selectedCamera?.name || "diese Kamera"} am ${selectedDate || "heutigen Tag"} vorhanden.`);
      return;
    }

    const cam = cameras.find((c) => c.id === camId);
    const configuredSegSec = (cam?.recordSegmentMinutes || 15) * 60;

    // 1. Exact clip that contains targetSec
    const matchingClip = camClips.find((c) => {
      const clipStart = recordingDayPosition(c, dateStr);
      const clipDur = typeof c.durationSeconds === "number" && c.durationSeconds > 0
        ? c.durationSeconds
        : configuredSegSec;
      const offset = targetSec - clipStart;
      return offset >= 0 && offset < clipDur;
    });

    if (matchingClip) {
      const clipStart = recordingDayPosition(matchingClip, dateStr);
      const offset = Math.max(0, targetSec - clipStart);
      openClipWithOffset(matchingClip, offset);
      toast.success(`Video gestartet um ${timeStr} Uhr (${matchingClip.cameraName})`);
      return;
    }

    toast.info(`Keine Aufnahme für ${timeStr} Uhr vorhanden.`);
  }, [clips, selectedCameraId, selectedDate, cameras, selectedCamera, openClipWithOffset, toast]);

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

  const jumpToNextMotion = useCallback(() => {
    if (!activeClipMotionEvents.length) return;
    const curr = (playbackOffset || 0) + (videoCurrentTime || 0);
    const next = activeClipMotionEvents.find((m) => m.offsetSec > curr + 1.5);
    if (next) {
      seekToOffset(next.offsetSec);
    } else {
      seekToOffset(activeClipMotionEvents[0].offsetSec);
    }
  }, [activeClipMotionEvents, playbackOffset, videoCurrentTime, seekToOffset]);

  const jumpToPrevMotion = useCallback(() => {
    if (!activeClipMotionEvents.length) return;
    const curr = (playbackOffset || 0) + (videoCurrentTime || 0);
    const prev = [...activeClipMotionEvents].reverse().find((m) => m.offsetSec < curr - 1.5);
    if (prev) {
      seekToOffset(prev.offsetSec);
    } else {
      seekToOffset(activeClipMotionEvents[activeClipMotionEvents.length - 1].offsetSec);
    }
  }, [activeClipMotionEvents, playbackOffset, videoCurrentTime, seekToOffset]);

  const setSpeed = (rate: number) => {
    const speed = Number.isFinite(rate) ? Math.min(2, Math.max(0.5, rate)) : 1;
    setPlaybackRate(speed);
    if (videoRef.current) {
      videoRef.current.playbackRate = speed;
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

  const activePlaybackUrl = useMemo(() => {
    if (!activeClip) return "";
    return `/api/nvr/recordings/hls?clipId=${encodeURIComponent(activeClip.id)}`;
  }, [activeClip]);

  const nextPlaybackUrl = useMemo(() => {
    if (!activeClip || !autoPlayNext || isScrubbing) return "";
    if (videoDuration <= 0 || videoDuration - videoCurrentTime > 30 * Math.max(1, playbackRate)) return "";
    const next = chronologicalCameraClips(clips, activeClip.cameraId)
      .find((clip) => recordingStart(clip) > recordingStart(activeClip));
    return next ? `/api/nvr/recordings/hls?clipId=${encodeURIComponent(next.id)}` : "";
  }, [activeClip, autoPlayNext, clips, videoDuration, videoCurrentTime, playbackRate, isScrubbing]);

  const playPreviousClip = () => {
    if (!activeClip) return;
    const previous = chronologicalCameraClips(clips, activeClip.cameraId)
      .filter((clip) => recordingStart(clip) < recordingStart(activeClip)).pop();
    if (previous) openClipWithOffset(previous, 0);
  };

  const playNextClip = () => {
    if (!activeClip) return;
    const next = chronologicalCameraClips(clips, activeClip.cameraId)
      .find((clip) => recordingStart(clip) > recordingStart(activeClip));
    if (next) openClipWithOffset(next, 0);
  };

  const toggleFullscreen = useCallback(() => {
    if (!playerContainerRef.current) return;
    if (!document.fullscreenElement) {
      void playerContainerRef.current.requestFullscreen().then(() => setPlayerFullscreen(true)).catch(() => null);
    } else {
      void document.exitFullscreen().then(() => setPlayerFullscreen(false)).catch(() => null);
    }
  }, []);

  // Keyboard Shortcuts for Video Player
  useEffect(() => {
    if (!activeClip) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input
      if (e.defaultPrevented || ["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }
      if (e.key === " " || e.key === "k") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        seekRelative(e.shiftKey ? -60 : -10);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        seekRelative(e.shiftKey ? 60 : 10);
      } else if (e.key === "j") {
        e.preventDefault();
        seekRelative(-60);
      } else if (e.key === "l") {
        e.preventDefault();
        seekRelative(60);
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
  }, [activeClip, togglePlay, seekRelative, jumpToNextMotion, jumpToPrevMotion, toggleFullscreen]);

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

  useEffect(() => {
    if (activeClip && !playerFullscreen && !scrubbingRef.current && !suppressPlayerScrollRef.current) {
      playerContainerRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [activeClip, playerFullscreen]);

  return {
    toast,
    cameras,
    setCameras,
    clips,
    setClips,
    loadingClips,
    setLoadingClips,
    refreshing,
    setRefreshing,
    clipsRequestIdRef,
    clipRequestsInFlightRef,
    clipsQueryKeyRef,
    calendarRequestIdRef,
    selectedCameraId,
    setSelectedCameraId,
    selectedDate,
    setSelectedDate,
    calendarMonth,
    setCalendarMonth,
    calendarDays,
    setCalendarDays,
    loadingCalendar,
    setLoadingCalendar,
    timeFrom,
    setTimeFrom,
    timeTo,
    setTimeTo,
    timePreset,
    setTimePreset,
    searchQuery,
    setSearchQuery,
    sortBy,
    setSortBy,
    storageFilter,
    setStorageFilter,
    sizeFilter,
    setSizeFilter,
    viewMode,
    setViewMode,
    filterMotionOnly,
    setFilterMotionOnly,
    objectFilter,
    setObjectFilter,
    cameraPickerOpen,
    setCameraPickerOpen,
    mobileCalendarOpen,
    setMobileCalendarOpen,
    mobileFiltersOpen,
    setMobileFiltersOpen,
    jumpTimeInput,
    setJumpTimeInput,
    jumpToTime,
    togglePlay,
    timelineWindowMinutes,
    setTimelineWindowMinutes,
    timelineStartMin,
    setTimelineStartMin,
    showEventLog,
    setShowEventLog,
    eventLogSearch,
    setEventLogSearch,
    eventLogTimeOfDay,
    setEventLogTimeOfDay,
    showVideoTrack,
    setShowVideoTrack,
    selectedClipIds,
    setSelectedClipIds,
    deletingBatch,
    setDeletingBatch,
    pageSize,
    setPageSize,
    currentPage,
    setCurrentPage,
    motionEvents,
    setMotionEvents,
    dailySummary,
    setDailySummary,
    hoverScrubber,
    setHoverScrubber,
    sharingClip,
    setSharingClip,
    handleShareClip,
    activeClip,
    setActiveClip,
    isPlaying,
    setIsPlaying,
    playbackIntentRef,
    isScrubbing,
    scrubbingRef,
    beginScrubbing,
    endScrubbing,
    isMuted,
    setIsMuted,
    playbackRate,
    setPlaybackRate,
    playerFullscreen,
    setPlayerFullscreen,
    autoPlayNext,
    setAutoPlayNext,
    videoDuration,
    setVideoDuration,
    videoCurrentTime,
    setVideoCurrentTime,
    liveTranscode,
    setLiveTranscode,
    playerPreparing,
    setPlayerPreparing,
    playerError,
    setPlayerError,
    playerNeedsStart,
    setPlayerNeedsStart,
    playbackAttempt,
    setPlaybackAttempt,
    seekFeedback,
    setSeekFeedback,
    playerOptionsOpen,
    setPlayerOptionsOpen,
    pendingSeekRef,
    videoRef,
    playerContainerRef,
    seekFeedbackTimerRef,
    lastPlayerTapRef,
    playerGestureRef,
    showStatsModal,
    setShowStatsModal,
    statsPeriod,
    setStatsPeriod,
    activityStats,
    setActivityStats,
    loadingStats,
    setLoadingStats,
    selectedSnapshot,
    setSelectedSnapshot,
    fetchActivityStats,
    handleTimePresetChange,
    fetchCameras,
    fetchClips,
    fetchCalendar,
    selectCameraFilter,
    selectRecordingDate,
    showAllRecordingDays,
    calendarCells,
    selectedCalendarDay,
    selectedCamera,
    activeAdvancedFilterCount,
    calendarMonthClipCount,
    clipMotionMap,
    rawClipEventsMap,
    motionClipsCount,
    availableStorageTargets,
    toggleTableSort,
    sortIndicator,
    filteredClips,
    timelineClips,
    totalPages,
    currentPageClips,
    activeClipMotionEvents,
    openClip,
    openClipWithOffset,
    handleDeleteClip,
    handleDeleteBatch,
    toggleSelectClip,
    toggleSelectAllVisible,
    seekRelative,
    showSeekFeedback,
    clearPlayerGesture,
    handlePlayerPointerDown,
    handlePlayerPointerEnd,
    seekToOffset,
    jumpToNextMotion,
    jumpToPrevMotion,
    setSpeed,
    zoomToWindow,
    goToNow,
    panTimeline,
    jumpToMotionCluster,
    playEvent,
    focusEventOnTimeline,
    timelineTicks,
    timelinePanStepMinutes,
    timelinePanLabel,
    filteredMotionEvents,
    activeClipIndex,
    activePlaybackUrl,
    nextPlaybackUrl,
    playbackOffset,
    playPreviousClip,
    playNextClip,
    toggleFullscreen,
  };
}

export type PlaybackState = ReturnType<typeof usePlaybackPage>;
