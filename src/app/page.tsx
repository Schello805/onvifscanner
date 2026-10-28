"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { loadWallData, saveWallData, type MotionRegion, type WallCamera } from "@/lib/cameraWall";
import { useToast } from "@/components/ToastProvider";
import { WebRtcPlayer } from "@/components/WebRtcPlayer";
import { PtzControlPad } from "@/components/camera/PtzControlPad";
import { CameraEditModal, type CameraEditDraft } from "@/components/camera/CameraEditModal";
import { SnapshotLightboxModal } from "@/components/SnapshotLightboxModal";
import { Pencil, Film, Trash2, Square, CircleDot, X, Maximize2, Image as ImageIcon, Play } from "lucide-react";
import { useBodyScrollLock } from "@/lib/useBodyScrollLock";
import {
  RECORDING_MODE_OPTIONS,
  effectiveRecordingMode,
  normalizeRecordingMode,
  recordingModeUsesContinuous,
  recordingModeUsesMotion,
  recordingModeUsesSchedule,
  type RecordingMode,
} from "@/lib/recordingPolicy";

type CameraImageState = {
  src?: string;
  sourceUri?: string;
  state: "idle" | "loading" | "ok" | "error";
  message?: string;
  updatedAt?: Date;
};

type MediaPoint = { x: number; y: number };

type MediaGesture = {
  startScale: number;
  startX: number;
  startY: number;
  startCenterX: number;
  startCenterY: number;
  startDistance: number;
  prevCenterX: number;
  prevCenterY: number;
  prevDistance: number;
  lastPointCount: number;
  wasMultiTouch: boolean;
  moved: boolean;
};

type LicensePlateItem = string | { plate: string; knownName?: string | null; category?: string };

type ActivityEvent = {
  id: string;
  type: "motion" | "online" | "offline";
  cameraId: string;
  cameraName: string;
  cameraIp: string;
  timestamp: string;
  message: string;
  imageUrl?: string | null;
  objectDetections?: Array<{ className?: string; group?: string; score?: number }>;
  licensePlates?: LicensePlateItem[];
};

function createCameraEditDraft(camera: WallCamera): CameraEditDraft {
  const recordMode = normalizeRecordingMode(camera);
  return {
    name: camera.name,
    snapshotUris: camera.snapshotUris.join("\n"),
    streamUris: camera.streamUris.join("\n"),
    username: camera.credentials?.username ?? "",
    password: camera.credentials?.password ?? "",
    group: camera.group ?? "",
    overlayPosition: camera.overlayPosition ?? "top-left",
    recordEnabled: Boolean(camera.recordEnabled),
    recordMode,
    recordSegmentMinutes: camera.recordSegmentMinutes || 15,
    motionPreRollSeconds: camera.motionPreRollSeconds ?? 10,
    motionPostRollSeconds: camera.motionPostRollSeconds ?? 30,
    alarmCooldownSeconds: camera.alarmCooldownSeconds ?? 30,
    motionMinAreaPercent: camera.motionMinAreaPercent ?? null,
    motionSensitivity: camera.motionSensitivity ?? 80,
    motionIgnoreRegions: camera.motionIgnoreRegions ?? [],
    objectDetectionEnabled: Boolean(camera.objectDetectionEnabled),
    objectDetectionClasses: camera.objectDetectionClasses ?? ["person", "vehicle", "animal"],
    objectMinConfidence: camera.objectMinConfidence ?? 55,
    licensePlateRecognitionEnabled: Boolean(camera.licensePlateRecognitionEnabled),
    motionScheduleEnabled: recordingModeUsesSchedule(recordMode),
    motionScheduleStart: camera.motionScheduleStart ?? "22:00",
    motionScheduleEnd: camera.motionScheduleEnd ?? "06:00",
    motionScheduleDays: camera.motionScheduleDays ?? [0, 1, 2, 3, 4, 5, 6],
    motionScheduleSensitivity: camera.motionScheduleSensitivity ?? 90,
    notificationsEnabled: Boolean(camera.notificationsEnabled),
    storageTargetId: camera.storageTargetId || "",
  };
}

function apiUrl(path: string): string {
  return new URL(path, window.location.origin).toString();
}

export default function CameraWallPage() {
  const { toast } = useToast();
  const [cameras, setCameras] = useState<WallCamera[]>([]);
  const [images, setImages] = useState<Record<string, CameraImageState>>({});
  const [columns, setColumns] = useState(3);
  const [mobileColumns, setMobileColumns] = useState(2);
  const [expandedCameraId, setExpandedCameraId] = useState<string | null>(null);
  const [refreshSeconds, setRefreshSeconds] = useState(10);
  const [editingCameraId, setEditingCameraId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<CameraEditDraft | null>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [mobileFocusMode, setMobileFocusMode] = useState(false);
  const [activeCameraControlsId, setActiveCameraControlsId] = useState<string | null>(null);
  const [cameraMenuId, setCameraMenuId] = useState<string | null>(null);
  const [mediaTransform, setMediaTransform] = useState({ scale: 1, x: 0, y: 0 });
  const [liveCameras, setLiveCameras] = useState<Set<string>>(new Set());
  const [livePlaybackUrls, setLivePlaybackUrls] = useState<Record<string, string>>({});
  const [liveWhepUrls, setLiveWhepUrls] = useState<Record<string, string>>({});
  const [liveQualities, setLiveQualities] = useState<Record<string, "main" | "sub">>({});
  const [liveErrors, setLiveErrors] = useState<Record<string, string>>({});
  const [liveLoading, setLiveLoading] = useState<Set<string>>(new Set());
  const [ptzPadOpen, setPtzPadOpen] = useState(false);
  const [ptzBusy, setPtzBusy] = useState(false);
  const [recordLoading, setRecordLoading] = useState<Set<string>>(new Set());
  const [batchRecordLoading, setBatchRecordLoading] = useState(false);
  const [storageTargets, setStorageTargets] = useState<Array<{ id: string; name: string; path: string; isDefault: boolean }>>([]);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [activityLogOpen, setActivityLogOpen] = useState(false);
  const [activityEvents, setActivityEvents] = useState<ActivityEvent[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityType, setActivityType] = useState<"all" | "motion" | "online" | "offline">("all");
  const [activityCameraId, setActivityCameraId] = useState("");
  const [selectedSnapshot, setSelectedSnapshot] = useState<{ url: string; title: string } | null>(null);
  const [mounted, setMounted] = useState(false);
  const [groupModal, setGroupModal] = useState<{
    type: "rename" | "delete";
    groupName: string;
  } | null>(null);
  const [groupNewName, setGroupNewName] = useState("");
  useBodyScrollLock(Boolean(editingCameraId || expandedCameraId || mobileFocusMode || activityLogOpen || cameraMenuId || groupModal || selectedSnapshot));

  const existingGroups = useMemo(() => {
    const map = new Map<string, { name: string; count: number }>();
    for (const c of cameras) {
      const trimmed = c.group?.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      const existing = map.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(key, { name: trimmed, count: 1 });
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      a.name.localeCompare(b.name, "de", { sensitivity: "base" })
    );
  }, [cameras]);

  useEffect(() => {
    setMounted(true);
    fetch("/api/nvr/storage", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (data.targets && Array.isArray(data.targets)) {
          setStorageTargets(data.targets);
        }
      })
      .catch(() => {});
  }, []);

  const loadActivityLog = useCallback(async () => {
    setActivityLoading(true);
    try {
      const params = new URLSearchParams({ type: activityType, limit: "250" });
      if (activityCameraId) params.set("cameraId", activityCameraId);
      const response = await fetch(`/api/activity-log?${params.toString()}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Aktivitätsprotokoll konnte nicht geladen werden.");
      setActivityEvents(Array.isArray(data.events) ? data.events : []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Aktivitätsprotokoll konnte nicht geladen werden.");
    } finally {
      setActivityLoading(false);
    }
  }, [activityCameraId, activityType, toast]);

  useEffect(() => {
    if (!activityLogOpen) return;
    void loadActivityLog();
    const timer = window.setInterval(() => void loadActivityLog(), 30_000);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActivityLogOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [activityLogOpen, loadActivityLog]);
  const wallRef = useRef<HTMLDivElement>(null);
  const objectUrlsRef = useRef<Record<string, string>>({});
  const runningRef = useRef<Set<string>>(new Set());
  const refreshRunningRef = useRef(false);
  const liveCamerasRef = useRef<Set<string>>(new Set());
  const expandedCameraIdRef = useRef<string | null>(null);
  const prevExpandedCameraIdRef = useRef<string | null>(null);
  const initialRefreshDoneRef = useRef(false);
  const lastClickRef = useRef<{ id: string, time: number }>({ id: "", time: 0 });
  const lastGestureTimeRef = useRef(0);
  const mediaTransformRef = useRef(mediaTransform);
  const mediaViewportRef = useRef<HTMLDivElement | null>(null);
  const mediaSurfaceRef = useRef<HTMLDivElement | null>(null);
  const mediaPointersRef = useRef(new Map<number, MediaPoint>());
  const mediaTouchCountRef = useRef(0);
  const updateMediaGestureRef = useRef<(points: MediaPoint[], element: HTMLElement) => void>(() => undefined);
  const mediaGestureRef = useRef<MediaGesture>({
    startScale: 1,
    startX: 0,
    startY: 0,
    startCenterX: 0,
    startCenterY: 0,
    startDistance: 0,
    prevCenterX: 0,
    prevCenterY: 0,
    prevDistance: 0,
    lastPointCount: 0,
    wasMultiTouch: false,
    moved: false,
  });
  const cameraControlsTimerRef = useRef<number | null>(null);
  const singleClickTimerRef = useRef<number | null>(null);

  const revealCameraControls = useCallback((cameraId: string) => {
    if (cameraControlsTimerRef.current !== null) window.clearTimeout(cameraControlsTimerRef.current);
    setActiveCameraControlsId(cameraId);
    cameraControlsTimerRef.current = window.setTimeout(() => {
      setActiveCameraControlsId((current) => current === cameraId ? null : current);
      cameraControlsTimerRef.current = null;
    }, 3000);
  }, []);

  useEffect(() => () => {
    if (cameraControlsTimerRef.current !== null) window.clearTimeout(cameraControlsTimerRef.current);
    if (singleClickTimerRef.current !== null) window.clearTimeout(singleClickTimerRef.current);
  }, []);

  useEffect(() => {
    liveCamerasRef.current = liveCameras;
  }, [liveCameras]);

  useEffect(() => {
    mediaTransformRef.current = mediaTransform;
  }, [mediaTransform]);

  useEffect(() => {
    expandedCameraIdRef.current = expandedCameraId;
    setPtzPadOpen(false);
    mediaPointersRef.current.clear();
    mediaGestureRef.current = {
      startScale: 1,
      startX: 0,
      startY: 0,
      startCenterX: 0,
      startCenterY: 0,
      startDistance: 0,
      prevCenterX: 0,
      prevCenterY: 0,
      prevDistance: 0,
      lastPointCount: 0,
      wasMultiTouch: false,
      moved: false,
    };
    mediaTransformRef.current = { scale: 1, x: 0, y: 0 };
    setMediaTransform({ scale: 1, x: 0, y: 0 });
  }, [expandedCameraId]);

  useEffect(() => {
    if (!expandedCameraId) return;
    const viewport = mediaViewportRef.current;
    if (!viewport) return;

    const previousHtmlTouchAction = document.documentElement.style.touchAction;
    const previousBodyTouchAction = document.body.style.touchAction;
    const previousHtmlOverscroll = document.documentElement.style.overscrollBehavior;
    const previousBodyOverscroll = document.body.style.overscrollBehavior;
    document.documentElement.style.touchAction = "none";
    document.body.style.touchAction = "none";
    document.documentElement.style.overscrollBehavior = "none";
    document.body.style.overscrollBehavior = "none";

    const isInteractiveControl = (target: EventTarget | null) =>
      target instanceof Element && Boolean(target.closest("button, a"));

    const eventBelongsToViewport = (event: Event) => {
      const target = event.target;
      return target instanceof Node && viewport.contains(target);
    };
    const preventGesture = (event: Event) => {
      if (!eventBelongsToViewport(event)) return;
      event.preventDefault();
    };
    const preventNativeTouch = (event: TouchEvent) => {
      if (!eventBelongsToViewport(event) || isInteractiveControl(event.target)) return;
      if (event.type === "touchmove" || event.touches.length > 1 || mediaTransformRef.current.scale > 1) {
        if (event.cancelable) event.preventDefault();
      }
    };
    const listenerOptions: AddEventListenerOptions = { passive: false, capture: true };
    const touchPoints = (touches: TouchList): MediaPoint[] => Array.from(touches, (touch) => ({
      x: touch.clientX,
      y: touch.clientY,
    }));
    const handleTouchStart = (event: TouchEvent) => {
      if (isInteractiveControl(event.target)) return;
      const points = touchPoints(event.touches);
      const preserveMoved = mediaTouchCountRef.current > 0 && mediaGestureRef.current.moved;
      const preserveMulti = (mediaTouchCountRef.current > 0 && mediaGestureRef.current.wasMultiTouch) || points.length >= 2;
      mediaTouchCountRef.current = points.length;
      if (points.length > 1) {
        lastGestureTimeRef.current = Date.now();
        if (event.cancelable) event.preventDefault();
      }
      resetMediaGesture(points, preserveMoved, preserveMulti);
    };
    const handleTouchMove = (event: TouchEvent) => {
      if (isInteractiveControl(event.target)) return;
      if (event.cancelable) event.preventDefault();
      const points = touchPoints(event.touches);
      mediaTouchCountRef.current = points.length;
      if (points.length > 1) {
        lastGestureTimeRef.current = Date.now();
      }
      updateMediaGestureRef.current(points, viewport);
    };
    const handleTouchEnd = (event: TouchEvent) => {
      if (isInteractiveControl(event.target)) return;
      const moved = mediaGestureRef.current.moved;
      const wasMulti = mediaGestureRef.current.wasMultiTouch;
      if (moved || wasMulti) {
        lastGestureTimeRef.current = Date.now();
      }
      const remaining = touchPoints(event.touches);
      mediaTouchCountRef.current = remaining.length;
      if (remaining.length === 0) {
        resetMediaGesture([], false, false);
        setMediaTransform({ ...mediaTransformRef.current });
      } else {
        resetMediaGesture(remaining, moved, wasMulti);
      }
    };
    const handleWheel = (event: WheelEvent) => {
      if (isInteractiveControl(event.target)) return;
      event.preventDefault();
      lastGestureTimeRef.current = Date.now();
      const current = mediaTransformRef.current;
      const zoomIntensity = event.ctrlKey ? 0.015 : 0.0025;
      const factor = Math.exp(-event.deltaY * zoomIntensity);
      const nextScale = Math.min(4, Math.max(1, current.scale * factor));
      if (Math.abs(nextScale - current.scale) < 0.001) return;
      const rect = viewport.getBoundingClientRect();
      const originX = rect.left + rect.width / 2;
      const originY = rect.top + rect.height / 2;
      const ratio = nextScale / current.scale;
      const nextX = (event.clientX - originX) * (1 - ratio) + current.x * ratio;
      const nextY = (event.clientY - originY) * (1 - ratio) + current.y * ratio;
      applyMediaTransform({ scale: nextScale, x: nextX, y: nextY }, viewport, true);
    };
    document.addEventListener("gesturestart", preventGesture, listenerOptions);
    document.addEventListener("gesturechange", preventGesture, listenerOptions);
    document.addEventListener("gestureend", preventGesture, listenerOptions);
    document.addEventListener("touchstart", preventNativeTouch, listenerOptions);
    document.addEventListener("touchmove", preventNativeTouch, listenerOptions);
    viewport.addEventListener("touchstart", handleTouchStart, { passive: false });
    viewport.addEventListener("touchmove", handleTouchMove, { passive: false });
    viewport.addEventListener("touchend", handleTouchEnd, { passive: false });
    viewport.addEventListener("touchcancel", handleTouchEnd, { passive: false });
    viewport.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      document.removeEventListener("gesturestart", preventGesture, true);
      document.removeEventListener("gesturechange", preventGesture, true);
      document.removeEventListener("gestureend", preventGesture, true);
      document.removeEventListener("touchstart", preventNativeTouch, true);
      document.removeEventListener("touchmove", preventNativeTouch, true);
      viewport.removeEventListener("touchstart", handleTouchStart);
      viewport.removeEventListener("touchmove", handleTouchMove);
      viewport.removeEventListener("touchend", handleTouchEnd);
      viewport.removeEventListener("touchcancel", handleTouchEnd);
      viewport.removeEventListener("wheel", handleWheel);
      mediaTouchCountRef.current = 0;
      document.documentElement.style.touchAction = previousHtmlTouchAction;
      document.body.style.touchAction = previousBodyTouchAction;
      document.documentElement.style.overscrollBehavior = previousHtmlOverscroll;
      document.body.style.overscrollBehavior = previousBodyOverscroll;
    };
  }, [expandedCameraId]);

  useEffect(() => {
    const objectUrls = objectUrlsRef.current;
    
    loadWallData().then((data) => {
      setCameras(data.cameras);
      if (data.columns !== null && data.columns >= 1 && data.columns <= 6) setColumns(data.columns);
      if (data.refresh !== null && [0, 5, 10, 30, 60].includes(data.refresh)) setRefreshSeconds(data.refresh);
    });
    
    if (typeof window !== "undefined") {
      const storedMobileCol = localStorage.getItem("wall_mobile_columns");
      if (storedMobileCol) setMobileColumns(Number(storedMobileCol));
    }

    const sync = () => {
      loadWallData().then(data => {
        setCameras(data.cameras);
      });
    };
    window.addEventListener("onvifscanner:wall-updated", sync);
    return () => {
      window.removeEventListener("onvifscanner:wall-updated", sync);
      for (const src of Object.values(objectUrls)) URL.revokeObjectURL(src);
    };
  }, []);

  useEffect(() => {
    if (!cameras.length || editingCameraId || typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const cameraId = url.searchParams.get("editCamera");
    if (!cameraId) return;

    url.searchParams.delete("editCamera");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);

    const camera = cameras.find((entry) => entry.id === cameraId);
    if (!camera) {
      toast.error("Die ausgewählte Kamera ist nicht mehr vorhanden.");
      return;
    }
    setEditingCameraId(camera.id);
    setEditDraft(createCameraEditDraft(camera));
  }, [cameras, editingCameraId, toast]);

  useEffect(() => {
    const onFullscreenChange = () => {
      const fullscreen = Boolean(document.fullscreenElement);
      setIsFullscreen(fullscreen);
      if (!fullscreen) setControlsVisible(true);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const openExpanded = useCallback((id: string) => {
    if (singleClickTimerRef.current !== null) {
      window.clearTimeout(singleClickTimerRef.current);
      singleClickTimerRef.current = null;
    }
    if (typeof window !== "undefined") {
      window.history.pushState({ modal: "camera-fullscreen", id }, "");
    }
    setExpandedCameraId(id);
  }, []);

  const closeExpanded = useCallback(() => {
    if (singleClickTimerRef.current !== null) {
      window.clearTimeout(singleClickTimerRef.current);
      singleClickTimerRef.current = null;
    }
    if (typeof window !== "undefined" && window.history.state?.modal === "camera-fullscreen") {
      window.history.back();
    } else {
      setExpandedCameraId(null);
    }
  }, []);

  useEffect(() => {
    const onPopState = () => {
      setExpandedCameraId(null);
      setEditingCameraId(null);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const leaveFullscreen = useCallback(async () => {
    if (mobileFocusMode) {
      setMobileFocusMode(false);
      setControlsVisible(true);
      return;
    }
    if (document.fullscreenElement) await document.exitFullscreen();
  }, [mobileFocusMode]);

  useEffect(() => {
    if (!editingCameraId && !expandedCameraId && !mobileFocusMode) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (editingCameraId) closeEditor();
        if (expandedCameraId) closeExpanded();
        if (mobileFocusMode) void leaveFullscreen();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [editingCameraId, expandedCameraId, mobileFocusMode, closeExpanded, leaveFullscreen]);

  // Keep screen awake (Wake Lock) when Vollbild / Monitormodus is active
  useEffect(() => {
    const isVollbildActive = isFullscreen || mobileFocusMode;
    if (!isVollbildActive || typeof window === "undefined" || !("wakeLock" in navigator)) return;

    let wakeLockSentinel: any = null;
    let released = false;

    const requestWakeLock = async () => {
      try {
        if (!released && !wakeLockSentinel && "wakeLock" in navigator) {
          wakeLockSentinel = await (navigator as any).wakeLock.request("screen");
          wakeLockSentinel.addEventListener("release", () => {
            wakeLockSentinel = null;
          });
        }
      } catch {
        // quiet fallback
      }
    };

    void requestWakeLock();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void requestWakeLock();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      released = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (wakeLockSentinel) {
        try {
          wakeLockSentinel.release();
        } catch {}
        wakeLockSentinel = null;
      }
    };
  }, [isFullscreen, mobileFocusMode]);

  const loadCamera = useCallback(async (camera: WallCamera, fresh = false, forceHighRes = false) => {
    if (!camera.snapshotUris.length && !camera.streamUris.length) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden" && !forceHighRes) return;
    if (runningRef.current.has(camera.id) && !forceHighRes) return;
    
    // Don't hammer the API if the background ping detected it as offline
    if (camera.status?.isOnline === false) {
       setImages((current) => ({
         ...current,
         [camera.id]: { ...current[camera.id], state: "error", message: "Kamera ist offline" }
       }));
       return;
    }

    const isHighRes = forceHighRes || expandedCameraIdRef.current === camera.id;
    runningRef.current.add(camera.id);
    setImages((current) => ({ ...current, [camera.id]: { ...current[camera.id], state: "loading" } }));

    try {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 25000);
      const urls = [...camera.snapshotUris, ...camera.streamUris].filter(Boolean).slice(0, 4);
      const response = await fetch(apiUrl("/api/thumbnail"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cameraId: camera.id,
          urls,
          size: isHighRes ? 1920 : 512,
          quality: isHighRes ? 85 : 68,
          timeoutMs: isHighRes ? 4500 : 3000,
          fastAuth: true,
          fresh: fresh || isHighRes,
          credentials: camera.credentials
        }),
        signal: controller.signal
      }).finally(() => window.clearTimeout(timer));

      const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
      if (!response.ok || contentType.includes("application/json")) {
        const detail = await response.json().catch(() => null);
        const isAuthError = detail?.log?.some((line: string) => 
          line.includes("Status: 401") || 
          line.includes("Hinweis: Authentifizierung") || 
          line.includes("Hinweis: Digest auth nötig")
        );
        if (isAuthError) {
          throw new Error("AUTH_REQUIRED");
        }
        throw new Error(detail?.error ?? `Bild nicht verfügbar (HTTP ${response.status})`);
      }

      const blob = await response.blob();
      const src = URL.createObjectURL(blob);
      const previous = objectUrlsRef.current[camera.id];
      if (previous) URL.revokeObjectURL(previous);
      objectUrlsRef.current[camera.id] = src;
      const sourceUri = response.headers.get("x-thumbnail-source") ?? camera.snapshotUris[0];
      setImages((current) => ({
        ...current,
        [camera.id]: { src, sourceUri, state: "ok", updatedAt: new Date() }
      }));
    } catch (error) {
      const message = error instanceof DOMException && error.name === "AbortError"
        ? "Zeitüberschreitung"
        : error instanceof Error ? error.message : "Bild nicht verfügbar";
      setImages((current) => ({
        ...current,
        [camera.id]: { ...current[camera.id], state: "error", message }
      }));
    } finally {
      runningRef.current.delete(camera.id);
    }
  }, []);

  const refreshCameraList = useCallback(async (cameraList: WallCamera[], fresh = false) => {
    if (refreshRunningRef.current) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    refreshRunningRef.current = true;
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(2, cameraList.length) }, async () => {
      while (nextIndex < cameraList.length) {
        const camera = cameraList[nextIndex++];
        if (!liveCamerasRef.current.has(camera.id)) await loadCamera(camera, fresh);
      }
    });
    try {
      await Promise.all(workers);
    } finally {
      refreshRunningRef.current = false;
    }
  }, [loadCamera]);

  const refreshAll = useCallback(async (fresh = false) => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden" && !fresh) return;
    try {
      const data = await loadWallData();
      setCameras(data.cameras);
      await refreshCameraList(data.cameras, fresh);
    } catch (e) {
      console.error("Failed to refresh wall data", e);
    }
  }, [refreshCameraList]);

  useEffect(() => {
    if (!cameras.length || initialRefreshDoneRef.current) return;
    initialRefreshDoneRef.current = true;
    void refreshCameraList(cameras);
  }, [cameras, refreshCameraList]);

  useEffect(() => {
    if (refreshSeconds <= 0 || !cameras.length) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refreshAll(false);
      }
    }, refreshSeconds * 1000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshAll(false);
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [cameras.length, refreshAll, refreshSeconds]);

  function persist(next: WallCamera[]) {
    setCameras(next);
    saveWallData({ cameras: next, columns, refresh: refreshSeconds });
  }

  function handleRenameGroup(oldName: string, newName: string) {
    const trimmed = newName.trim();
    if (!trimmed || trimmed.toLowerCase() === "ungruppiert" || trimmed.toLowerCase() === oldName.trim().toLowerCase()) {
      setGroupModal(null);
      return;
    }
    const next = cameras.map((c) => {
      if (c.group?.trim().toLowerCase() === oldName.trim().toLowerCase()) {
        return { ...c, group: trimmed };
      }
      return c;
    });
    persist(next);
    setEditDraft((prev) => (prev && prev.group?.trim().toLowerCase() === oldName.trim().toLowerCase() ? { ...prev, group: trimmed } : prev));
    toast.success(`Gruppe „${oldName}“ in „${trimmed}“ umbenannt.`);
    setGroupModal(null);
  }

  function handleDeleteGroup(groupName: string) {
    const next = cameras.map((c) => {
      if (c.group?.trim().toLowerCase() === groupName.trim().toLowerCase()) {
        return { ...c, group: undefined };
      }
      return c;
    });
    persist(next);
    setEditDraft((prev) => (prev && prev.group?.trim().toLowerCase() === groupName.trim().toLowerCase() ? { ...prev, group: "" } : prev));
    toast.info(`Gruppe „${groupName}“ gelöscht. Kameras wurden auf „Ungruppiert“ gesetzt.`);
    setGroupModal(null);
  }

  function changeColumns(value: number) {
    setColumns(value);
    saveWallData({ cameras, columns: value, refresh: refreshSeconds });
  }

  function changeRefresh(value: number) {
    setRefreshSeconds(value);
    saveWallData({ cameras, columns, refresh: value });
  }

  function changeMobileColumns(value: number) {
    setMobileColumns(value);
    if (typeof window !== "undefined") {
      localStorage.setItem("wall_mobile_columns", value.toString());
    }
  }

  function moveCamera(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= cameras.length) return;
    const next = [...cameras];
    [next[index], next[target]] = [next[target], next[index]];
    persist(next);
  }

  function openEditor(camera: WallCamera) {
    setEditingCameraId(camera.id);
    setEditDraft(createCameraEditDraft(camera));
  }

  function closeEditor() {
    setEditingCameraId(null);
    setEditDraft(null);
  }

  async function toggleRecord(camera: WallCamera) {
    const nextMode: NonNullable<WallCamera["recordMode"]> = camera.recordMode === "off" || !camera.recordEnabled ? "continuous" : "off";
    setRecordLoading((prev) => new Set(prev).add(camera.id));
    try {
      const res = await fetch("/api/nvr/cameras", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: camera.id, recordMode: nextMode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Fehler beim Ändern der Aufnahme");

      const next = cameras.map((c) => (c.id === camera.id ? { ...c, recordEnabled: nextMode !== "off", recordMode: nextMode } : c));
      persist(next);
      toast.success(
        nextMode !== "off"
          ? `Daueraufnahme für "${camera.name}" gestartet.`
          : `Aufnahme für "${camera.name}" beendet.`
      );
    } catch (err: any) {
      toast.error(err.message || "Fehler beim Ändern der Aufnahme.");
    } finally {
      setRecordLoading((prev) => {
        const copy = new Set(prev);
        copy.delete(camera.id);
        return copy;
      });
    }
  }

  async function toggleAllRecord(enable: boolean) {
    if (enable && cameras.length === 0) return;
    if (!enable && !confirm("Möchtest du wirklich alle laufenden Aufnahmen beenden?")) {
      return;
    }
    setBatchRecordLoading(true);
    try {
      const res = await fetch("/api/nvr/cameras", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true, recordMode: enable ? "continuous" : "off" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Fehler bei der Aufnahmesteuerung");

      const next = cameras.map((c) => ({ ...c, recordEnabled: enable, recordMode: enable ? "continuous" as const : "off" as const }));
      persist(next);
      toast.success(
        enable
          ? `Daueraufnahme für alle ${cameras.length} Kameras gestartet.`
          : `Alle Kamera-Aufnahmen beendet.`
      );
    } catch (err: any) {
      toast.error(err.message || "Fehler bei der Aufnahmesteuerung.");
    } finally {
      setBatchRecordLoading(false);
    }
  }

  function removeCamera(id: string) {
    const cam = cameras.find((item) => item.id === id);
    const next = cameras.filter((item) => item.id !== id);
    if (expandedCameraId === id) closeExpanded();
    if (liveCameras.has(id)) {
      setLiveCameras((prev) => {
        const nextLive = new Set(prev);
        nextLive.delete(id);
        return nextLive;
      });
    }
    const previousSrc = objectUrlsRef.current[id];
    if (previousSrc) URL.revokeObjectURL(previousSrc);
    delete objectUrlsRef.current[id];
    setImages((current) => {
      const updated = { ...current };
      delete updated[id];
      return updated;
    });
    persist(next);
    toast.success(`Kamera "${cam?.name || id}" von den Monitoren entfernt.`);
  }

  function saveCameraDetails() {
    if (!editingCameraId || !editDraft) return;
    const lines = (value: string) => Array.from(new Set(value.split("\n").map((line) => line.trim()).filter(Boolean)));
    const currentCam = cameras.find((camera) => camera.id === editingCameraId);
    const motionScheduleEnabled = recordingModeUsesSchedule(editDraft.recordMode);
    const next = cameras.map((camera) => camera.id === editingCameraId ? {
      ...camera,
      name: editDraft.name.trim() || `Kamera ${camera.ip}`,
      snapshotUris: lines(editDraft.snapshotUris),
      streamUris: lines(editDraft.streamUris),
      credentials: editDraft.username.trim()
        ? { username: editDraft.username.trim(), password: editDraft.password }
        : undefined,
      group: editDraft.group.trim() || undefined,
      overlayPosition: editDraft.overlayPosition,
      recordEnabled: editDraft.recordEnabled,
      recordMode: editDraft.recordMode,
      recordSegmentMinutes: editDraft.recordSegmentMinutes,
      motionPreRollSeconds: editDraft.motionPreRollSeconds,
      motionPostRollSeconds: editDraft.motionPostRollSeconds,
      alarmCooldownSeconds: editDraft.alarmCooldownSeconds,
      motionMinAreaPercent: editDraft.motionMinAreaPercent,
      motionSensitivity: editDraft.motionSensitivity,
      motionIgnoreRegions: editDraft.motionIgnoreRegions,
      objectDetectionEnabled: editDraft.objectDetectionEnabled,
      objectDetectionClasses: editDraft.objectDetectionClasses,
      objectMinConfidence: editDraft.objectMinConfidence,
      licensePlateRecognitionEnabled: editDraft.licensePlateRecognitionEnabled,
      motionScheduleEnabled,
      motionScheduleStart: editDraft.motionScheduleStart,
      motionScheduleEnd: editDraft.motionScheduleEnd,
      motionScheduleDays: editDraft.motionScheduleDays,
      motionScheduleSensitivity: editDraft.motionScheduleSensitivity,
      notificationsEnabled: editDraft.notificationsEnabled,
      storageTargetId: editDraft.storageTargetId || null,
    } : camera);

    void fetch("/api/nvr/cameras", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: editingCameraId,
        recordEnabled: editDraft.recordEnabled,
        recordMode: editDraft.recordMode,
        recordSegmentMinutes: editDraft.recordSegmentMinutes,
        motionPreRollSeconds: editDraft.motionPreRollSeconds,
        motionPostRollSeconds: editDraft.motionPostRollSeconds,
        alarmCooldownSeconds: editDraft.alarmCooldownSeconds,
      motionMinAreaPercent: editDraft.motionMinAreaPercent,
        motionSensitivity: editDraft.motionSensitivity,
        motionIgnoreRegions: editDraft.motionIgnoreRegions,
        objectDetectionEnabled: editDraft.objectDetectionEnabled,
        objectDetectionClasses: editDraft.objectDetectionClasses,
        objectMinConfidence: editDraft.objectMinConfidence,
        licensePlateRecognitionEnabled: editDraft.licensePlateRecognitionEnabled,
        motionScheduleEnabled,
        motionScheduleStart: editDraft.motionScheduleStart,
        motionScheduleEnd: editDraft.motionScheduleEnd,
        motionScheduleDays: editDraft.motionScheduleDays,
        motionScheduleSensitivity: editDraft.motionScheduleSensitivity,
        notificationsEnabled: editDraft.notificationsEnabled,
        storageTargetId: editDraft.storageTargetId || null,
      })
    });

    const previousSrc = objectUrlsRef.current[editingCameraId];
    if (previousSrc) URL.revokeObjectURL(previousSrc);
    delete objectUrlsRef.current[editingCameraId];
    setImages((current) => {
      const updated = { ...current };
      delete updated[editingCameraId];
      return updated;
    });
    persist(next);
    closeEditor();
    toast.success(`Kamera "${editDraft.name.trim() || currentCam?.name}" gespeichert.`);
  }

  async function enterMonitorMode() {
    if (window.matchMedia("(max-width: 639px)").matches) {
      setControlsVisible(false);
      setMobileFocusMode(true);
      return;
    }
    setControlsVisible(false);
    await wallRef.current?.requestFullscreen();
  }

  const prepareLiveStream = useCallback(async (cameraId: string, quality: "main" | "sub") => {
    const response = await fetch(apiUrl("/api/stream/prepare"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cameraId, quality })
    });
    const result = (await response.json().catch(() => null)) as {
      playbackUrl?: string;
      whepUrl?: string;
      quality?: "main" | "sub";
      error?: string;
      code?: string;
    } | null;
    if (!response.ok || !result?.playbackUrl) {
      throw new Error(result?.error ?? `Live-Stream konnte nicht gestartet werden (HTTP ${response.status}).`);
    }
    setLivePlaybackUrls((current) => ({ ...current, [cameraId]: result.playbackUrl! }));
    if (result.whepUrl) {
      setLiveWhepUrls((current) => ({ ...current, [cameraId]: result.whepUrl! }));
    }
    setLiveQualities((current) => ({ ...current, [cameraId]: result.quality ?? quality }));
    return result;
  }, []);

  useEffect(() => {
    const previousId = prevExpandedCameraIdRef.current;
    prevExpandedCameraIdRef.current = expandedCameraId;

    // When leaving fullscreen for a camera that is still live, switch it back to lightweight sub-stream
    if (previousId && previousId !== expandedCameraId && liveCamerasRef.current.has(previousId)) {
      if (liveQualities[previousId] === "main") {
        void prepareLiveStream(previousId, "sub").catch(() => {});
      }
    }

    if (!expandedCameraId) return;
    const cam = cameras.find((c) => c.id === expandedCameraId);
    if (!cam) return;

    if (liveCamerasRef.current.has(expandedCameraId)) {
      if (liveQualities[expandedCameraId] !== "main") {
        void prepareLiveStream(expandedCameraId, "main").catch(() => {});
      }
    } else {
      void loadCamera(cam, true, true);
    }
  }, [expandedCameraId, cameras, liveQualities, loadCamera, prepareLiveStream]);

  async function sendPtzCommand(
    cameraId: string,
    action: "move" | "stop",
    x = 0,
    y = 0,
    zoom = 0
  ) {
    setPtzBusy(action === "move");
    try {
      const res = await fetch(apiUrl("/api/ptz"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cameraId, action, x, y, zoom })
      });
      if (!res.ok && action === "move") {
        const data = await res.json().catch(() => null);
        toast.error(data?.error || "PTZ wird von dieser Kamera nicht unterstützt.");
      } else if (action === "stop" && !liveCamerasRef.current.has(cameraId)) {
        const cam = cameras.find((c) => c.id === cameraId);
        if (cam) {
          window.setTimeout(() => void loadCamera(cam, true, true), 450);
        }
      }
    } catch {
      if (action === "move") {
        toast.error("PTZ-Befehl fehlgeschlagen.");
      }
    } finally {
      if (action === "stop") setPtzBusy(false);
    }
  }

  async function toggleLive(cameraId: string, quiet = false): Promise<boolean> {
    const cam = cameras.find((c) => c.id === cameraId);
    if (liveCameras.has(cameraId)) {
      setLiveCameras((current) => {
        const next = new Set(current);
        next.delete(cameraId);
        liveCamerasRef.current = next;
        return next;
      });
      if (!quiet) toast.info(`Live-Stream für "${cam?.name || cameraId}" gestoppt.`);
      return true;
    }

    const isMobile = window.matchMedia("(max-width: 639px)").matches;
    if (isMobile && liveCamerasRef.current.size >= 4) {
      if (!quiet) toast.info("Auf Smartphones sind maximal vier parallele Live-Streams möglich. Weitere Kameras bleiben in der Snapshot-Ansicht.");
      return false;
    }

    setLiveErrors((current) => ({ ...current, [cameraId]: "" }));
    setLiveLoading((current) => new Set(current).add(cameraId));
    try {
      const preferredQuality = expandedCameraIdRef.current === cameraId ? "main" : "sub";
      await prepareLiveStream(cameraId, preferredQuality);
      setLiveCameras((current) => {
        const next = new Set(current).add(cameraId);
        liveCamerasRef.current = next;
        return next;
      });
      if (!quiet) toast.success(`Live-Stream für "${cam?.name || cameraId}" aktiv.`);
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Live-Stream konnte nicht gestartet werden.";
      setLiveErrors((current) => ({
        ...current,
        [cameraId]: msg
      }));
      if (!quiet) toast.error(msg);
      return false;
    } finally {
      setLiveLoading((current) => {
        const next = new Set(current);
        next.delete(cameraId);
        return next;
      });
    }
  }

  async function toggleAllLive() {
    const allIds = cameras.map(c => c.id);
    const anyNotLive = allIds.some(id => !liveCameras.has(id));
    
    if (anyNotLive) {
      const isMobile = window.matchMedia("(max-width: 639px)").matches;
      if (isMobile) {
        const maximum = 4;
        for (const id of allIds) {
          if (liveCamerasRef.current.size >= maximum) break;
          if (!liveCamerasRef.current.has(id) && !liveLoading.has(id)) await toggleLive(id, true);
        }
        toast.info(
          liveCamerasRef.current.size > 0
            ? `${liveCamerasRef.current.size} Live-Streams aktiv. Weitere Kameras nutzen ressourcenschonende Snapshots.`
            : "Kein kompatibler Live-Stream verfügbar. Die Snapshot-Ansicht bleibt aktiv."
        );
        return;
      }

      toast.info("Starte alle Live-Streams...");
      for (const id of allIds) {
        if (!liveCameras.has(id) && !liveLoading.has(id)) void toggleLive(id, true);
      }
    } else {
      setLiveCameras(new Set());
      liveCamerasRef.current = new Set();
      toast.info("Alle Live-Streams gestoppt.");
    }
  }

  function applyMediaTransform(
    next: { scale: number; x: number; y: number },
    element?: HTMLElement,
    commit = true,
  ) {
    const scale = Math.min(4, Math.max(1, next.scale));
    const rect = element?.getBoundingClientRect();
    const maxX = rect ? (rect.width * (scale - 1)) / 2 : Number.POSITIVE_INFINITY;
    const maxY = rect ? (rect.height * (scale - 1)) / 2 : Number.POSITIVE_INFINITY;
    const transform = {
      scale,
      x: scale === 1 ? 0 : Math.min(maxX, Math.max(-maxX, next.x)),
      y: scale === 1 ? 0 : Math.min(maxY, Math.max(-maxY, next.y)),
    };
    mediaTransformRef.current = transform;
    if (mediaSurfaceRef.current) {
      mediaSurfaceRef.current.style.transform = `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`;
    }
    if (commit) setMediaTransform(transform);
  }

  function toggleMediaZoom() {
    const nextScale = mediaTransformRef.current.scale > 1 ? 1 : 2;
    applyMediaTransform({ scale: nextScale, x: 0, y: 0 });
  }

  function resetMediaGesture(points: MediaPoint[], moved = false, wasMultiTouch = false) {
    const current = mediaTransformRef.current;
    const [first, second] = points;
    const centerX = second ? (first.x + second.x) / 2 : first?.x ?? 0;
    const centerY = second ? (first.y + second.y) / 2 : first?.y ?? 0;
    const dist = second ? Math.hypot(second.x - first.x, second.y - first.y) : 0;
    mediaGestureRef.current = {
      startScale: current.scale,
      startX: current.x,
      startY: current.y,
      startCenterX: centerX,
      startCenterY: centerY,
      startDistance: dist,
      prevCenterX: centerX,
      prevCenterY: centerY,
      prevDistance: dist,
      lastPointCount: points.length,
      wasMultiTouch: wasMultiTouch || points.length >= 2,
      moved,
    };
  }

  function handleMediaPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!expandedCameraId || event.pointerType === "touch" || (event.target as HTMLElement).closest("button, a")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const preserveMoved = mediaPointersRef.current.size > 0 && mediaGestureRef.current.moved;
    const preserveMulti = mediaPointersRef.current.size > 0 && mediaGestureRef.current.wasMultiTouch;
    mediaPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const pts = [...mediaPointersRef.current.values()];
    resetMediaGesture(pts, preserveMoved, preserveMulti || pts.length >= 2);
  }

  function handleMediaPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!expandedCameraId || event.pointerType === "touch" || !mediaPointersRef.current.has(event.pointerId)) return;
    event.preventDefault();
    mediaPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    updateMediaGesture([...mediaPointersRef.current.values()], event.currentTarget);
  }

  function updateMediaGesture(points: MediaPoint[], element: HTMLElement) {
    if (points.length === 0) return;
    const gesture = mediaGestureRef.current;

    if (points.length >= 2) {
      const [first, second] = points;
      const distance = Math.hypot(second.x - first.x, second.y - first.y);
      const centerX = (first.x + second.x) / 2;
      const centerY = (first.y + second.y) / 2;
      gesture.wasMultiTouch = true;

      // Sync anchor on transition into 2-finger mode to prevent any initial jump
      if (gesture.lastPointCount !== points.length || gesture.prevDistance <= 0) {
        gesture.startScale = mediaTransformRef.current.scale;
        gesture.startX = mediaTransformRef.current.x;
        gesture.startY = mediaTransformRef.current.y;
        gesture.startCenterX = centerX;
        gesture.startCenterY = centerY;
        gesture.startDistance = distance;
        gesture.prevCenterX = centerX;
        gesture.prevCenterY = centerY;
        gesture.prevDistance = distance;
        gesture.lastPointCount = points.length;
        return;
      }

      const current = mediaTransformRef.current;
      const stepRatio = distance > 0 && gesture.prevDistance > 0 ? distance / gesture.prevDistance : 1;
      const nextScale = Math.min(4, Math.max(1, current.scale * stepRatio));
      const effectiveRatio = current.scale > 0 ? nextScale / current.scale : 1;

      const rect = element.getBoundingClientRect();
      const originX = rect.left + rect.width / 2;
      const originY = rect.top + rect.height / 2;

      const nextX = centerX - originX - (gesture.prevCenterX - originX - current.x) * effectiveRatio;
      const nextY = centerY - originY - (gesture.prevCenterY - originY - current.y) * effectiveRatio;

      applyMediaTransform({ scale: nextScale, x: nextX, y: nextY }, element, false);

      gesture.prevCenterX = centerX;
      gesture.prevCenterY = centerY;
      gesture.prevDistance = distance;
      gesture.lastPointCount = points.length;

      if (
        Math.abs(distance - gesture.startDistance) > 2
        || Math.hypot(centerX - gesture.startCenterX, centerY - gesture.startCenterY) > 2
      ) {
        gesture.moved = true;
      }
      return;
    }

    // Ignore 1-finger trailing movement when lifting fingers after a multi-touch pinch
    if (gesture.wasMultiTouch) {
      gesture.lastPointCount = points.length;
      return;
    }

    const point = points[0];
    if (gesture.lastPointCount !== 1) {
      gesture.prevCenterX = point.x;
      gesture.prevCenterY = point.y;
      gesture.startCenterX = point.x;
      gesture.startCenterY = point.y;
      gesture.lastPointCount = 1;
      return;
    }

    const totalDeltaX = point.x - gesture.startCenterX;
    const totalDeltaY = point.y - gesture.startCenterY;
    const stepX = point.x - gesture.prevCenterX;
    const stepY = point.y - gesture.prevCenterY;

    if (mediaTransformRef.current.scale > 1 && (gesture.moved || Math.hypot(totalDeltaX, totalDeltaY) > 3)) {
      const current = mediaTransformRef.current;
      applyMediaTransform({
        scale: current.scale,
        x: current.x + stepX,
        y: current.y + stepY,
      }, element, false);
      gesture.prevCenterX = point.x;
      gesture.prevCenterY = point.y;
      gesture.moved = true;
      lastGestureTimeRef.current = Date.now();
    }
  }

  updateMediaGestureRef.current = updateMediaGesture;

  function handleMediaPointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "touch") return;
    const moved = mediaGestureRef.current.moved;
    const wasMulti = mediaGestureRef.current.wasMultiTouch;
    if (moved || wasMulti) {
      lastGestureTimeRef.current = Date.now();
    }
    mediaPointersRef.current.delete(event.pointerId);
    const remaining = [...mediaPointersRef.current.values()];
    if (remaining.length === 0) {
      resetMediaGesture([], false, false);
      setMediaTransform({ ...mediaTransformRef.current });
    } else {
      resetMediaGesture(remaining, moved, wasMulti);
    }
  }

  return (
    <div
      ref={wallRef}
      className={`camera-wall min-h-[70vh] rounded-2xl bg-slate-950 p-2 sm:p-4 ${mobileFocusMode ? "mobile-monitor-mode" : ""}`}
    >
      <div className={`camera-wall-toolbar mb-2.5 sm:mb-3.5 ${(isFullscreen && !controlsVisible) || mobileFocusMode ? "hidden" : "block"}`}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-2.5">
          <div className="flex items-center gap-2 sm:gap-2.5 flex-wrap min-w-0">
            <h1 className="text-lg sm:text-xl font-bold text-white tracking-tight whitespace-nowrap">Monitore</h1>
            <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-300 whitespace-nowrap">
              {cameras.length} {cameras.length === 1 ? "Kamera" : "Kameras"}
            </span>
            {cameras.filter((camera) => effectiveRecordingMode(camera) !== "off").length > 0 ? (
              <div className="inline-flex items-center gap-1.5 sm:gap-2 rounded-full border border-rose-500/50 bg-rose-500/15 px-2.5 py-0.5 text-xs font-bold text-rose-300 shadow-sm whitespace-nowrap">
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
                </span>
                <span className="whitespace-nowrap">
                  {cameras.filter((camera) => effectiveRecordingMode(camera) !== "off").length} REC aktiv
                </span>
                <button
                  type="button"
                  disabled={batchRecordLoading}
                  onClick={() => void toggleAllRecord(false)}
                  className="rounded bg-rose-950/80 px-2 py-0.5 text-[10px] font-semibold text-rose-200 border border-rose-500/40 hover:bg-rose-900 transition disabled:opacity-50 whitespace-nowrap shrink-0"
                  title="Alle laufenden Aufnahmen beenden"
                >
                  Alle stoppen
                </button>
              </div>
            ) : cameras.length > 0 ? (
              <button
                type="button"
                disabled={batchRecordLoading}
                onClick={() => void toggleAllRecord(true)}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 hover:bg-rose-500/20 hover:border-rose-500/40 hover:text-rose-200 px-2.5 py-0.5 text-xs font-semibold text-slate-300 transition shadow-sm disabled:opacity-50 whitespace-nowrap"
                title="Bewegungsaufnahme für alle Kameras starten"
              >
                <span className="text-rose-400">⏺</span>
                <span className="whitespace-nowrap">Alle bei Bewegung</span>
              </button>
            ) : null}
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
            <div className="hidden sm:inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-300 whitespace-nowrap">
              <span className="text-slate-400 text-[11px]">Raster:</span>
              <select
                aria-label="Anzahl der Spalten"
                value={columns}
                onChange={(event) => changeColumns(Number(event.target.value))}
                className="bg-transparent text-white font-semibold outline-none cursor-pointer"
              >
                {[1, 2, 3, 4, 5, 6].map((value) => (
                  <option key={value} value={value} className="bg-slate-900">
                    {value} Spalten
                  </option>
                ))}
              </select>
            </div>

            <div className="hidden sm:inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-300 whitespace-nowrap">
              <span className="text-slate-400 text-[11px]">Intervall:</span>
              <select
                aria-label="Aktualisierungsintervall"
                value={refreshSeconds}
                onChange={(event) => changeRefresh(Number(event.target.value))}
                className="bg-transparent text-white font-semibold outline-none cursor-pointer"
              >
                <option value={0} className="bg-slate-900">Manuell</option>
                <option value={5} className="bg-slate-900">5s</option>
                <option value={10} className="bg-slate-900">10s</option>
                <option value={30} className="bg-slate-900">30s</option>
                <option value={60} className="bg-slate-900">60s</option>
              </select>
            </div>

            <button
              type="button"
              onClick={() => void refreshAll(true)}
              className="touch-manipulation inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-white/10 transition whitespace-nowrap shrink-0"
              title="Alle Kamerabilder jetzt aktualisieren"
            >
              <span>↻</span>
              <span className="hidden sm:inline">Refresh</span>
            </button>

            <button
              type="button"
              onClick={() => void toggleAllLive()}
              disabled={cameras.length === 0}
              className={`touch-manipulation inline-flex items-center gap-1.5 rounded-lg px-2.5 sm:px-3 py-1 text-xs font-semibold transition whitespace-nowrap shrink-0 ${
                cameras.length > 0 && cameras.every(c => liveCameras.has(c.id))
                  ? "border border-amber-500/50 bg-amber-500/15 text-amber-200"
                  : "border border-sky-500/50 bg-sky-500/15 text-sky-200 hover:bg-sky-500/25"
              }`}
            >
              {cameras.length > 0 && cameras.every(c => liveCameras.has(c.id)) ? (
                <>■ <span className="whitespace-nowrap">Live stoppen</span></>
              ) : (
                <>
                  ▶ <span className="hidden sm:inline whitespace-nowrap">Alle Live</span>
                  <span className="sm:hidden whitespace-nowrap">{liveCameras.size > 0 ? `Live ${liveCameras.size}/4` : "Live"}</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActivityLogOpen(true)}
              className="touch-manipulation inline-flex items-center gap-1 rounded-lg border border-violet-500/35 bg-violet-500/10 px-2.5 py-1 text-xs font-semibold text-violet-200 transition hover:bg-violet-500/20 whitespace-nowrap shrink-0"
              title="Bewegungen und Online-/Offline-Wechsel anzeigen"
            >
              <span>◷</span>
              <span className="hidden sm:inline whitespace-nowrap">Protokoll</span>
              <span className="sm:hidden whitespace-nowrap">Log</span>
            </button>

            <div className="flex sm:hidden items-center gap-1 rounded-lg border border-white/10 bg-white/5 p-0.5 text-xs text-slate-300">
              <button
                type="button"
                onClick={() => changeMobileColumns(mobileColumns === 1 ? 2 : 1)}
                className="touch-manipulation rounded px-1.5 py-0.5 font-semibold hover:bg-white/10"
                title="Raster zwischen einer und zwei Spalten wechseln"
                aria-label={`Aktuell ${mobileColumns} Spalten. Raster wechseln.`}
              >
                {mobileColumns === 1 ? "▭" : "▦"}
              </button>
            </div>

            {isFullscreen ? (
              <button
                type="button"
                onClick={leaveFullscreen}
                className="touch-manipulation rounded-lg bg-indigo-600 px-2.5 sm:px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-500 transition whitespace-nowrap shrink-0"
              >
                Vollbild beenden
              </button>
            ) : (
              <button
                type="button"
                onClick={enterMonitorMode}
                className="touch-manipulation inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 sm:px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-500 transition whitespace-nowrap shrink-0 shadow-sm"
                title="Vollbild-Überwachungsmodus (Display bleibt dauerhaft aktiv)"
              >
                <span className="whitespace-nowrap">▣ Vollbild</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {isFullscreen || mobileFocusMode ? (
        <div className="fixed right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-[10000] flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setControlsVisible((value) => !value)}
            className="rounded-full border border-white/15 bg-black/55 px-3 py-2 text-xs font-semibold text-white shadow-lg backdrop-blur-md"
            aria-pressed={controlsVisible}
            title={controlsVisible ? "Kamera-Bedienung ausblenden" : "Kamera-Bedienung einblenden"}
          >
            {controlsVisible ? "◉ Bedienung" : "◎ Bedienung"}
          </button>
          <button
            type="button"
            onClick={() => void leaveFullscreen()}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/55 text-lg text-white shadow-lg backdrop-blur-md"
            aria-label="Vollbild schließen"
            title="Vollbild schließen"
          >
            ×
          </button>
        </div>
      ) : null}

      {!cameras.length ? (
        <div className="flex min-h-[55vh] flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.02] px-6 text-center">
          <div className="mb-4 text-5xl">▦</div>
          <h2 className="text-xl font-semibold text-white">Noch keine Kamera gespeichert</h2>
          <p className="mt-2 max-w-md text-sm text-slate-400">Starte einen Scan und speichere einzelne Kameras oder die gesamte Ergebnisliste für die Monitore.</p>
          <Link href="/" className="mt-5 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500">Scanner öffnen</Link>
        </div>
      ) : (
        <div className="flex flex-col gap-3.5 sm:gap-6">
          {Object.entries(
            cameras.reduce((acc, camera) => {
              const g = camera.group?.trim() || "Ungruppiert";
              if (!acc[g]) acc[g] = [];
              acc[g].push(camera);
              return acc;
            }, {} as Record<string, WallCamera[]>)
          ).sort((a, b) => a[0] === "Ungruppiert" ? 1 : b[0] === "Ungruppiert" ? -1 : a[0].localeCompare(b[0])).map(([groupName, groupCameras]) => (
            <div key={groupName} className="camera-group flex flex-col gap-1 sm:gap-2">
              {groupName !== "Ungruppiert" && (
                <div className="flex items-center justify-between px-1.5 pt-0.5 pb-0.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <div className="w-2 h-2 rounded-full bg-indigo-500 shadow-sm shadow-indigo-500/50 shrink-0"></div>
                    <span className="text-sm sm:text-base font-semibold text-white/90 truncate">
                      {groupName}
                    </span>
                    <span className="text-[11px] font-normal text-slate-400 shrink-0">
                      ({groupCameras.length})
                    </span>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setGroupNewName(groupName);
                        setGroupModal({ type: "rename", groupName });
                      }}
                      className="inline-flex items-center gap-1 p-1 sm:px-2 sm:py-0.5 rounded-md text-slate-400 hover:text-cyan-300 hover:bg-white/10 transition-colors active:scale-95"
                      title={`Gruppe „${groupName}“ umbenennen`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline text-[11px] font-medium">Umbenennen</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setGroupModal({ type: "delete", groupName });
                      }}
                      className="inline-flex items-center gap-1 p-1 sm:px-2 sm:py-0.5 rounded-md text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors active:scale-95"
                      title={`Gruppe „${groupName}“ löschen`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline text-[11px] font-medium">Löschen</span>
                    </button>
                  </div>
                </div>
              )}
              <div className="wall-grid" style={{ "--wall-columns": columns, "--wall-columns-mobile": mobileColumns } as CSSProperties}>
                {groupCameras.map((camera) => {
                  const index = cameras.findIndex(c => c.id === camera.id);
            const image = images[camera.id];
            const isLive = liveCameras.has(camera.id);
            const isOffline = camera.status && camera.status.isOnline === false;
            const effectiveRecordMode = effectiveRecordingMode(camera);
            const isRecordingNow = effectiveRecordMode !== "off";
            return (
              <article 
                key={camera.id} 
                draggable={!isFullscreen}
                onDragStart={(e) => {
                  setDraggedIndex(index);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (draggedIndex === null || draggedIndex === index) return;
                  setDragOverIndex(index);
                }}
                onDragLeave={() => {
                  if (dragOverIndex === index) setDragOverIndex(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOverIndex(null);
                  if (draggedIndex === null || draggedIndex === index) return;
                  const next = [...cameras];
                  const [moved] = next.splice(draggedIndex, 1);
                  next.splice(index, 0, moved);
                  persist(next);
                  setDraggedIndex(null);
                }}
                onDragEnd={() => {
                  setDraggedIndex(null);
                  setDragOverIndex(null);
                }}
                data-pull-to-refresh-ignore={expandedCameraId === camera.id ? "true" : undefined}
                className={`camera-card group overflow-hidden flex flex-col justify-center ${
                  expandedCameraId === camera.id 
                    ? 'fixed inset-0 z-[99999] bg-black' 
                    : `relative rounded-xl sm:rounded-2xl border bg-black shadow-2xl transition-all ${
                        cameraMenuId === camera.id
                          ? 'z-40 ring-2 ring-indigo-500/80 shadow-[0_0_25px_rgba(99,102,241,0.35)]'
                          : isRecordingNow
                          ? 'border-rose-500/80 ring-1 ring-rose-500/45 shadow-[0_0_10px_rgba(244,63,94,0.18)]'
                          : isOffline
                          ? 'border-red-500 ring-2 ring-red-500/50 shadow-[0_0_15px_rgba(239,68,68,0.3)]'
                          : isLive
                          ? 'border-sky-500 ring-2 ring-sky-500/50 shadow-[0_0_15px_rgba(14,165,233,0.3)]'
                          : 'border-white/10'
                      } ${dragOverIndex === index ? 'opacity-50 scale-105 border-indigo-500' : ''}`
                }`}
              >
                <div 
                  ref={expandedCameraId === camera.id ? mediaViewportRef : undefined}
                  data-pull-to-refresh-ignore={expandedCameraId === camera.id ? "true" : undefined}
                  onPointerDown={handleMediaPointerDown}
                  onPointerMove={handleMediaPointerMove}
                  onPointerUp={handleMediaPointerEnd}
                  onPointerCancel={handleMediaPointerEnd}
                  onClick={() => {
                    const now = Date.now();
                    if (
                      mediaGestureRef.current.moved ||
                      mediaGestureRef.current.wasMultiTouch ||
                      now - lastGestureTimeRef.current < 350
                    ) {
                      mediaGestureRef.current.moved = false;
                      lastClickRef.current = { id: "", time: 0 };
                      return;
                    }
                    if (expandedCameraId === camera.id) {
                      const last = lastClickRef.current;
                      if (last.id === camera.id && now - last.time < 350) {
                        toggleMediaZoom();
                        lastClickRef.current = { id: "", time: 0 };
                      } else {
                        lastClickRef.current = { id: camera.id, time: now };
                      }
                      return;
                    }

                    const last = lastClickRef.current;
                    if (last.id === camera.id && now - last.time < 350) {
                      if (singleClickTimerRef.current !== null) {
                        window.clearTimeout(singleClickTimerRef.current);
                        singleClickTimerRef.current = null;
                      }
                      openExpanded(camera.id);
                      setCameraMenuId(null);
                      lastClickRef.current = { id: "", time: 0 };
                      return;
                    }

                    lastClickRef.current = { id: camera.id, time: now };
                    if (singleClickTimerRef.current !== null) {
                      window.clearTimeout(singleClickTimerRef.current);
                    }
                    singleClickTimerRef.current = window.setTimeout(() => {
                      singleClickTimerRef.current = null;
                      setCameraMenuId((prev) => (prev === camera.id ? null : camera.id));
                      setActiveCameraControlsId(camera.id);
                    }, 240);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    if (singleClickTimerRef.current !== null) {
                      window.clearTimeout(singleClickTimerRef.current);
                      singleClickTimerRef.current = null;
                    }
                    lastClickRef.current = { id: "", time: 0 };
                    if (expandedCameraId === camera.id) {
                      toggleMediaZoom();
                    } else {
                      setCameraMenuId(null);
                      openExpanded(camera.id);
                    }
                  }}
                  className={`flex flex-col justify-center overflow-hidden bg-slate-900 relative cursor-grab active:cursor-grabbing ${expandedCameraId === camera.id ? 'camera-fullscreen-viewport w-full h-full touch-none overscroll-none select-none' : 'flex-1 w-full min-h-[125px] sm:min-h-0 aspect-[16/10] sm:aspect-video touch-manipulation'}`}
                >
                  {expandedCameraId === camera.id ? (
                    <>
                    <div className="fixed right-[max(8px,env(safe-area-inset-right))] top-[max(8px,env(safe-area-inset-top))] z-[100000] flex items-center gap-2">
                      <button
                        type="button"
                        disabled={liveLoading.has(camera.id)}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          void toggleLive(camera.id);
                        }}
                        className={`flex h-11 touch-manipulation items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-white shadow-lg backdrop-blur-md transition-colors disabled:opacity-60 ${
                          isLive ? "bg-sky-600/90 active:bg-sky-500" : "bg-black/65 active:bg-black/90"
                        }`}
                        title={isLive ? "Live-Stream beenden" : "Live-Stream starten"}
                        aria-label={isLive ? "Live-Stream beenden" : "Live-Stream starten"}
                      >
                        <span>{liveLoading.has(camera.id) ? "…" : isLive ? "■" : "▶"}</span>
                        <span>{liveLoading.has(camera.id) ? "Laden" : isLive ? "Live" : "Live"}</span>
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setPtzPadOpen((v) => !v);
                        }}
                        className={`flex h-11 min-w-11 touch-manipulation items-center justify-center gap-1 rounded-lg px-2.5 text-xs font-semibold text-white shadow-lg backdrop-blur-md transition-colors ${
                          ptzPadOpen ? "bg-emerald-600/90 active:bg-emerald-500" : "bg-black/65 active:bg-black/90"
                        }`}
                        title="PTZ-Kamerasteuerung (Schwenken/Neigen/Zoomen)"
                        aria-label="PTZ-Kamerasteuerung"
                      >
                        <span>✥</span>
                        <span className="hidden sm:inline">PTZ</span>
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          toggleMediaZoom();
                        }}
                        className={`flex h-11 min-w-11 touch-manipulation items-center justify-center rounded-lg px-2 text-xs font-semibold text-white shadow-lg backdrop-blur-md transition-colors ${
                          mediaTransform.scale > 1 ? "bg-indigo-600/90 active:bg-indigo-500" : "bg-black/65 active:bg-black/90"
                        }`}
                        title={mediaTransform.scale > 1 ? "Zoom zurücksetzen" : "Zweifach vergrößern"}
                        aria-label={mediaTransform.scale > 1 ? "Zoom zurücksetzen" : "Zweifach vergrößern"}
                      >
                        {mediaTransform.scale > 1 ? `${mediaTransform.scale.toFixed(1)}×` : "2×"}
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          openEditor(camera);
                        }}
                        className="flex h-11 w-11 touch-manipulation items-center justify-center rounded-lg bg-black/65 text-white shadow-lg backdrop-blur-md transition-colors active:bg-black/90"
                        title="Kameraname und Einstellungen bearbeiten"
                        aria-label="Kamera bearbeiten"
                      >
                        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16.862 3.487a2.25 2.25 0 0 1 3.182 3.182L8.25 18.463 3.75 19.5l1.037-4.5L16.862 3.487Z" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          closeExpanded();
                        }}
                        className="flex h-11 w-11 touch-manipulation items-center justify-center rounded-lg bg-black/65 text-white shadow-lg backdrop-blur-md transition-colors active:bg-black/90"
                        title="Vollbild schließen"
                        aria-label="Vollbild schließen"
                      >
                        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 4v3a2 2 0 0 1-2 2H4m16 0h-3a2 2 0 0 1-2-2V4M4 15h3a2 2 0 0 1 2 2v3m6 0v-3a2 2 0 0 1 2-2h3" />
                        </svg>
                      </button>
                    </div>
                    <PtzControlPad
                      isOpen={ptzPadOpen}
                      isBusy={ptzBusy}
                      cameraId={camera.id}
                      onSendCommand={sendPtzCommand}
                    />
                    </>
                  ) : null}
                  <div
                    ref={expandedCameraId === camera.id ? mediaSurfaceRef : undefined}
                    className="h-full w-full will-change-transform"
                    style={
                      expandedCameraId === camera.id
                        ? {
                            transform: `translate3d(${mediaTransformRef.current.x}px, ${mediaTransformRef.current.y}px, 0) scale(${mediaTransformRef.current.scale})`,
                            transformOrigin: "center center",
                            transition: "none",
                          }
                        : undefined
                    }
                  >
                  {isLive ? (
                     <WebRtcPlayer
                        whepUrl={liveWhepUrls[camera.id]}
                        playbackUrl={livePlaybackUrls[camera.id]}
                        title={`Live-Stream ${camera.name}`}
                        className={`w-full h-full border-0 pointer-events-none ${expandedCameraId === camera.id ? 'object-contain' : 'object-cover'}`}
                     />
                  ) : image?.src ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={image.src}
                        alt={camera.name}
                        className={`w-full h-full block transition-opacity duration-300 ${expandedCameraId === camera.id ? 'object-contain' : 'object-cover'} ${
                          image.state === "error" ? "opacity-30 grayscale" : 
                          (image.state === "loading" && !isLive) ? "opacity-60 contrast-75 saturate-50" : ""
                        }`}
                      />
                      {image.state === "error" && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 pointer-events-none">
                           {image.message === "AUTH_REQUIRED" ? (
                             <>
                               <span className="text-4xl">🔒</span>
                               <span className="text-xs font-semibold text-white bg-black/60 px-3 py-1.5 rounded-full backdrop-blur-md border border-white/10">Zugangsdaten benötigt</span>
                             </>
                           ) : (
                             <>
                               <span className="text-4xl text-amber-500 drop-shadow-md">⚠️</span>
                               <span className="text-xs font-semibold text-white bg-black/60 px-3 py-1.5 rounded-full backdrop-blur-md border border-white/10">Verbindung verloren</span>
                             </>
                           )}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 text-slate-500">
                      {image?.message === "AUTH_REQUIRED" ? (
                        <>
                          <span className="text-4xl">🔒</span>
                          <span className="px-4 text-center text-xs font-semibold">Zugangsdaten benötigt</span>
                        </>
                      ) : (
                        <>
                          <span className={image?.state === "loading" ? "animate-pulse text-2xl" : "text-2xl"}>
                            {image?.state === "error" ? "⚠️" : "◉"}
                          </span>
                          <span className="px-4 text-center text-xs">{image?.state === "loading" ? "Bild wird geladen…" : image?.state === "error" ? (image?.message || "Verbindung fehlgeschlagen") : ((camera.snapshotUris.length || camera.streamUris.length) ? "Noch kein Bild" : "Keine Bild- oder Stream-URL vorhanden")}</span>
                        </>
                      )}
                    </div>
                  )}
                  </div>

                  {image?.src && camera.overlayPosition && (
                    <div className={`camera-card-overlay absolute m-1 sm:m-1.5 px-1.5 sm:px-2 py-0.5 text-[11px] sm:text-xs font-medium text-white bg-black/75 rounded backdrop-blur-md border border-white/10 shadow-md inline-flex items-center gap-1 sm:gap-1.5 pointer-events-none select-none max-w-[90%] truncate
                      ${camera.overlayPosition === "top-left" ? "top-0 left-0" : ""}
                      ${camera.overlayPosition === "top-right" ? "top-0 right-0" : ""}
                      ${camera.overlayPosition === "bottom-left" ? "bottom-0 left-0" : ""}
                      ${camera.overlayPosition === "bottom-right" ? "bottom-0 right-0" : ""}
                    `}>
                      <span className="truncate">{camera.name}</span>
                      {isRecordingNow && (
                        <span className="shrink-0 inline-flex items-center gap-1 rounded bg-rose-500/25 text-rose-300 border border-rose-500/40 px-1.5 py-0.5 text-[9px] font-bold leading-tight">
                          <span className="relative flex h-1.5 w-1.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-rose-500"></span>
                          </span>
                          REC
                        </span>
                      )}
                      {isOffline ? <span className="shrink-0 rounded bg-red-500 px-1 text-[9px] uppercase tracking-wider font-bold leading-tight">Offline</span> : null}
                      {isLive && !isOffline ? <span className="shrink-0 w-2 h-2 rounded-full bg-sky-400 animate-pulse"></span> : null}
                    </div>
                  )}
                </div>

                {expandedCameraId !== camera.id ? (
                  <div
                    className={`camera-card-actions absolute bottom-1 right-1 z-30 flex items-center gap-1 ${activeCameraControlsId === camera.id || cameraMenuId === camera.id ? "is-visible" : ""}`}
                    onClick={(event) => event.stopPropagation()}
                  >
                    {liveErrors[camera.id] ? (
                      <span className="rounded-md bg-red-950/90 px-2 py-1 text-[10px] font-semibold text-red-200" title={liveErrors[camera.id]}>Live-Fehler</span>
                    ) : null}
                    <button
                      type="button"
                      disabled={liveLoading.has(camera.id)}
                      onClick={() => {
                        revealCameraControls(camera.id);
                        void toggleLive(camera.id);
                      }}
                      className={`flex h-9 touch-manipulation items-center gap-1 rounded-md border px-2 text-[11px] font-semibold text-white shadow-lg backdrop-blur-md disabled:opacity-60 ${isLive ? "border-sky-400/60 bg-sky-600/90" : "border-white/15 bg-black/75"}`}
                      title={isLive ? "Live-Stream stoppen" : "Live-Stream starten"}
                    >
                      <span>{liveLoading.has(camera.id) ? "…" : isLive ? "■" : "▶"}</span>
                      <span>{liveLoading.has(camera.id) ? "Lädt" : "Live"}</span>
                    </button>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          const closing = cameraMenuId === camera.id;
                          if (cameraControlsTimerRef.current !== null) window.clearTimeout(cameraControlsTimerRef.current);
                          setCameraMenuId(closing ? null : camera.id);
                          setActiveCameraControlsId(camera.id);
                          if (closing) revealCameraControls(camera.id);
                        }}
                        className={`flex h-11 w-11 touch-manipulation items-center justify-center rounded-lg border text-xl font-bold text-white shadow-lg backdrop-blur-md transition-all sm:h-9 sm:w-9 sm:rounded-md sm:text-lg ${
                          cameraMenuId === camera.id
                            ? "border-indigo-400 bg-indigo-600/90 ring-2 ring-indigo-400/50"
                            : "border-white/20 bg-black/80 hover:bg-white/10 active:scale-95"
                        }`}
                        aria-label={`Aktionen für ${camera.name}`}
                        aria-expanded={cameraMenuId === camera.id}
                      >
                        ⋯
                      </button>
                    </div>
                  </div>
                ) : null}

                {/* In-Camera Quick Actions Overlay */}
                {cameraMenuId === camera.id ? (
                  <div
                    data-pull-to-refresh-ignore="true"
                    className="absolute inset-0 z-40 flex flex-col justify-between p-1.5 sm:p-3 rounded-xl sm:rounded-2xl bg-slate-950/92 backdrop-blur-md border border-indigo-500/50 shadow-2xl animate-in fade-in zoom-in-95 duration-150"
                    onClick={(e) => {
                      e.stopPropagation();
                      if ((e.target as HTMLElement).closest("button, a")) return;
                      const now = Date.now();
                      const last = lastClickRef.current;
                      if (last.id === camera.id && now - last.time < 350) {
                        if (singleClickTimerRef.current !== null) {
                          window.clearTimeout(singleClickTimerRef.current);
                          singleClickTimerRef.current = null;
                        }
                        lastClickRef.current = { id: "", time: 0 };
                        setCameraMenuId(null);
                        openExpanded(camera.id);
                        return;
                      }
                      lastClickRef.current = { id: camera.id, time: now };
                      if (singleClickTimerRef.current !== null) {
                        window.clearTimeout(singleClickTimerRef.current);
                      }
                      singleClickTimerRef.current = window.setTimeout(() => {
                        singleClickTimerRef.current = null;
                        setCameraMenuId(null);
                        setActiveCameraControlsId(null);
                      }, 240);
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      if ((e.target as HTMLElement).closest("button, a")) return;
                      if (singleClickTimerRef.current !== null) {
                        window.clearTimeout(singleClickTimerRef.current);
                        singleClickTimerRef.current = null;
                      }
                      lastClickRef.current = { id: "", time: 0 };
                      setCameraMenuId(null);
                      openExpanded(camera.id);
                    }}
                  >
                    {/* Header: Camera Name + Fullscreen + Close */}
                    <div className="flex items-center justify-between gap-1 border-b border-white/10 pb-1 px-0.5">
                      <div className="min-w-0 flex items-center gap-1">
                        <span className="truncate font-bold text-white text-[11px] sm:text-sm">{camera.name}</span>
                        <span className="hidden sm:inline font-mono text-[10px] text-slate-400">{camera.ip}</span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setCameraMenuId(null);
                            openExpanded(camera.id);
                          }}
                          className="flex h-5 w-5 sm:h-6 sm:w-6 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/5 text-slate-400 hover:text-white hover:bg-white/10 active:scale-95 transition-all"
                          title="Vollbild"
                          aria-label="Vollbild"
                        >
                          <Maximize2 className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setCameraMenuId(null);
                            setActiveCameraControlsId(null);
                          }}
                          className="flex h-5 w-5 sm:h-6 sm:w-6 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/5 text-slate-400 hover:text-white hover:bg-white/10 active:scale-95 transition-all"
                          aria-label="Schließen"
                        >
                          <X className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Action Icons Row: Live, Aufnahmen, Bearbeiten, Aufnahme, Löschen */}
                    <div className="flex flex-wrap items-center justify-center gap-1.5 sm:gap-2.5 my-auto px-0.5">
                      {/* 1. Live streamen / stoppen */}
                      <button
                        type="button"
                        disabled={liveLoading.has(camera.id)}
                        onClick={(e) => {
                          e.stopPropagation();
                          setCameraMenuId(null);
                          setActiveCameraControlsId(null);
                          void toggleLive(camera.id);
                        }}
                        className={`flex h-8 w-8 sm:h-11 sm:w-11 items-center justify-center rounded-lg sm:rounded-xl border transition-all active:scale-95 disabled:opacity-50 shadow-md ${
                          isLive
                            ? "border-sky-400 bg-sky-600 text-white hover:bg-sky-500 shadow-sky-600/40"
                            : "border-sky-500/50 bg-sky-950/80 text-sky-300 hover:bg-sky-900 active:bg-sky-800 shadow-black/40"
                        }`}
                        title={isLive ? "Live-Stream stoppen" : "Live-Stream starten"}
                        aria-label={isLive ? "Live-Stream stoppen" : "Live-Stream starten"}
                      >
                        {liveLoading.has(camera.id) ? (
                          <span className="loading loading-spinner loading-xs text-white" />
                        ) : isLive ? (
                          <Square className="w-3 h-3 sm:w-4 sm:h-4 fill-white text-white" />
                        ) : (
                          <Play className="w-3.5 h-3.5 sm:w-5 sm:h-5 fill-current text-sky-400" />
                        )}
                      </button>

                      {/* 2. Aufnahmen öffnen (Videos schauen) */}
                      {camera.recordEnabled ? (
                        <Link
                          href={`/wiedergabe?cameraId=${encodeURIComponent(camera.id)}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setCameraMenuId(null);
                            setActiveCameraControlsId(null);
                          }}
                          className="flex h-8 w-8 sm:h-11 sm:w-11 items-center justify-center rounded-lg sm:rounded-xl border border-amber-400/50 bg-amber-600 text-white hover:bg-amber-500 active:scale-95 transition-all shadow-md shadow-amber-600/40"
                          title="Aufnahmen öffnen"
                          aria-label="Aufnahmen öffnen"
                        >
                          <Film className="w-3.5 h-3.5 sm:w-5 sm:h-5 text-white" />
                        </Link>
                      ) : null}

                      {/* 3. Stift bearbeiten */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCameraMenuId(null);
                          setActiveCameraControlsId(null);
                          openEditor(camera);
                        }}
                        className="flex h-8 w-8 sm:h-11 sm:w-11 items-center justify-center rounded-lg sm:rounded-xl border border-indigo-400/50 bg-indigo-600 text-white hover:bg-indigo-500 active:scale-95 transition-all shadow-md shadow-indigo-600/40"
                        title="Kamera bearbeiten"
                        aria-label="Kamera bearbeiten"
                      >
                        <Pencil className="w-3.5 h-3.5 sm:w-5 sm:h-5" />
                      </button>

                      {/* 4. Aufnahme starten / stoppen */}
                      <button
                        type="button"
                        disabled={recordLoading.has(camera.id)}
                        onClick={(e) => {
                          e.stopPropagation();
                          setCameraMenuId(null);
                          setActiveCameraControlsId(null);
                          void toggleRecord(camera);
                        }}
                        className={`flex h-8 w-8 sm:h-11 sm:w-11 items-center justify-center rounded-lg sm:rounded-xl border transition-all active:scale-95 disabled:opacity-50 shadow-md ${
                          camera.recordEnabled
                            ? "border-rose-400 bg-rose-600 text-white hover:bg-rose-500 shadow-rose-600/40"
                            : "border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700 shadow-black/40"
                        }`}
                        title={camera.recordEnabled ? "Aufnahme stoppen" : "Aufnahme starten"}
                        aria-label={camera.recordEnabled ? "Aufnahme stoppen" : "Aufnahme starten"}
                      >
                        {camera.recordEnabled ? (
                          <Square className="w-3 h-3 sm:w-4 sm:h-4 fill-white text-white" />
                        ) : (
                          <CircleDot className="w-3.5 h-3.5 sm:w-5 sm:h-5 text-rose-400" />
                        )}
                      </button>

                      {/* 5. Mülleimer (Entfernen / Löschen) */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCameraMenuId(null);
                          setActiveCameraControlsId(null);
                          if (confirm(`Möchtest du "${camera.name}" wirklich von den Monitoren entfernen?`)) {
                            removeCamera(camera.id);
                          }
                        }}
                        className="flex h-8 w-8 sm:h-11 sm:w-11 items-center justify-center rounded-lg sm:rounded-xl border border-red-500/50 bg-red-600 text-white hover:bg-red-500 active:scale-95 transition-all shadow-md shadow-red-600/40"
                        title="Von Monitoren entfernen"
                        aria-label="Von Monitoren entfernen"
                      >
                        <Trash2 className="w-3.5 h-3.5 sm:w-5 sm:h-5 text-white" />
                      </button>
                    </div>
                  </div>
                ) : null}
              </article>
                );
              })}
              </div>
            </div>
          ))}
        </div>
      )}

      {activityLogOpen && mounted ? createPortal(
        <div
          data-pull-to-refresh-ignore="true"
          className="fixed inset-0 z-[100010] flex items-center justify-center bg-black/80 px-3 pt-[max(3.5rem,calc(env(safe-area-inset-top,0px)+1rem))] pb-[max(1rem,calc(env(safe-area-inset-bottom,0px)+0.75rem))] backdrop-blur-md sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="activity-log-title"
          onClick={(event) => {
            if (event.target === event.currentTarget) setActivityLogOpen(false);
          }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setActivityLogOpen(false);
          }}
        >
          <section className="flex max-h-[82dvh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-slate-950 shadow-2xl sm:max-h-[calc(100dvh-3rem)]">
            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 bg-slate-900/90 px-4 py-3.5 sm:px-5">
              <div>
                <h2 id="activity-log-title" className="text-base font-bold text-white sm:text-lg">Kamera-Protokoll</h2>
                <p className="text-[11px] text-slate-400">Online- und Offline-Wechsel der Kameras</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setActivityLogOpen(false)}
                  className="inline-flex min-h-9 min-w-9 items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/20 active:scale-95"
                  aria-label="Protokoll schließen"
                >
                  <span>✕</span>
                  <span>Schließen</span>
                </button>
              </div>
            </header>

            <div className="grid shrink-0 grid-cols-1 gap-2 border-b border-white/10 px-4 py-3 sm:grid-cols-[1fr_1fr_auto] sm:px-5">
              <select
                value={activityCameraId}
                onChange={(event) => setActivityCameraId(event.target.value)}
                className="glass-input rounded-lg bg-slate-900 px-3 py-2 text-xs text-white"
                aria-label="Kamera im Protokoll filtern"
              >
                <option value="">Alle Kameras</option>
                {[...cameras].sort((left, right) => left.name.localeCompare(right.name, "de", { numeric: true })).map((camera) => (
                  <option key={camera.id} value={camera.id}>{camera.name} · {camera.ip}</option>
                ))}
              </select>
              <select
                value={activityType}
                onChange={(event) => setActivityType(event.target.value as typeof activityType)}
                className="glass-input rounded-lg bg-slate-900 px-3 py-2 text-xs text-white"
                aria-label="Status im Protokoll filtern"
              >
                <option value="all">Alle Ereignisse (Bewegung & Status)</option>
                <option value="motion">⚡ Nur Bewegungen</option>
                <option value="offline">Nur Offline</option>
                <option value="online">Nur Online</option>
              </select>
              <button type="button" onClick={() => void loadActivityLog()} disabled={activityLoading} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10 disabled:opacity-50">
                {activityLoading ? "Lädt…" : "↻ Aktualisieren"}
              </button>
            </div>

            <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain p-3 sm:p-5">
              {activityEvents.length === 0 && !activityLoading ? (
                <div className="rounded-xl border border-dashed border-white/15 px-5 py-10 text-center text-sm text-slate-400">
                  Für diesen Filter sind noch keine Einträge gespeichert.
                </div>
              ) : (
                <div className="space-y-2">
                  {activityEvents.map((event) => {
                    const appearance = event.type === "motion"
                      ? { icon: "⚡", label: "Bewegung", color: "border-amber-500/35 bg-amber-500/15 text-amber-300" }
                      : event.type === "offline"
                        ? { icon: "●", label: "Offline", color: "border-rose-500/25 bg-rose-500/10 text-rose-300" }
                        : { icon: "●", label: "Online", color: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300" };
                    return (
                      <article key={event.id} className="grid gap-2.5 rounded-xl border border-white/10 bg-white/[0.025] p-3 sm:grid-cols-[auto_1fr_auto_auto] sm:items-center">
                        <span className={`inline-flex w-fit items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-bold ${appearance.color}`}>
                          {appearance.icon} {appearance.label}
                        </span>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-white">{event.cameraName}</div>
                          <div className="truncate text-[11px] text-slate-400">{event.cameraIp} · {event.message}</div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {event.imageUrl ? (
                            <button
                              type="button"
                              onClick={() => setSelectedSnapshot({ url: event.imageUrl!, title: `${event.cameraName} · ${event.message}` })}
                              className="group relative h-11 w-16 shrink-0 overflow-hidden rounded-lg border border-slate-700/80 bg-black/60 shadow transition hover:border-red-500"
                              title="Schnappschuss vergrößern"
                            >
                              <img
                                src={event.imageUrl}
                                alt="Schnappschuss"
                                className="h-full w-full object-cover transition duration-150 group-hover:scale-105"
                              />
                              <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition">
                                <Maximize2 className="h-3.5 w-3.5 text-white drop-shadow" />
                              </div>
                            </button>
                          ) : null}
                          {event.type === "motion" && (
                            <Link
                              href={`/wiedergabe?cameraId=${encodeURIComponent(event.cameraId)}`}
                              onClick={() => setActivityLogOpen(false)}
                              className="inline-flex items-center gap-1 rounded-lg border border-amber-500/35 bg-amber-500/15 px-2.5 py-1.5 text-[11px] font-semibold text-amber-200 hover:bg-amber-500/25 transition"
                              title="Zur Wiedergabe dieser Kamera springen"
                            >
                              ▶ Video
                            </Link>
                          )}
                        </div>
                        <time className="whitespace-nowrap font-mono text-[11px] text-slate-400" dateTime={event.timestamp}>
                          {new Date(event.timestamp).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "medium" })}
                        </time>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>

            <footer className="shrink-0 border-t border-white/10 bg-slate-900/90 p-3 sm:hidden">
              <button
                type="button"
                onClick={() => setActivityLogOpen(false)}
                className="w-full rounded-xl border border-white/15 bg-white/10 py-2.5 text-xs font-bold text-white transition hover:bg-white/20 active:scale-[0.99]"
              >
                Protokoll schließen
              </button>
            </footer>
          </section>
        </div>,
        document.body
      ) : null}

      {/* Dim backdrop when any camera menu is open */}
      {cameraMenuId && mounted ? (
        createPortal(
          <div
            className="fixed inset-0 z-30 bg-black/40 backdrop-blur-[1px] transition-opacity animate-in fade-in duration-100"
            onClick={() => {
              setCameraMenuId(null);
              setActiveCameraControlsId(null);
            }}
            aria-label="Kameraaktionen schließen"
          />,
          document.body
        )
      ) : null}

      {editingCameraId && editDraft && mounted && cameras.find((c) => c.id === editingCameraId) ? (
        <CameraEditModal
          camera={cameras.find((c) => c.id === editingCameraId)!}
          editDraft={editDraft}
          existingGroups={existingGroups}
          storageTargets={storageTargets}
          activeSourceUri={images[editingCameraId]?.sourceUri}
          previewImageSrc={images[editingCameraId]?.src}
          onUpdateDraft={setEditDraft}
          onSave={saveCameraDetails}
          onClose={closeEditor}
          onRemove={removeCamera}
          onTriggerRenameGroup={(name) => {
            setGroupNewName(name);
            setGroupModal({ type: "rename", groupName: name });
          }}
          onTriggerDeleteGroup={(name) => {
            setGroupModal({ type: "delete", groupName: name });
          }}
        />
      ) : null}

      {mounted && (
        <>
          {groupModal && typeof document !== "undefined" && createPortal(
            <div
              className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150"
              onClick={() => setGroupModal(null)}
            >
              <div
                className="relative w-full max-w-md rounded-2xl border border-white/20 bg-slate-900 p-6 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={() => setGroupModal(null)}
                  className="absolute right-4 top-4 rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
                  aria-label="Schließen"
                >
                  <X className="h-5 w-5" />
                </button>

                {groupModal.type === "rename" ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleRenameGroup(groupModal.groupName, groupNewName);
                    }}
                    className="space-y-4"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/20 text-cyan-400">
                        <Pencil className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="text-base font-semibold text-white">Gruppe umbenennen</h3>
                        <p className="text-xs text-slate-400">Aktueller Name: „{groupModal.groupName}“</p>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="group-new-name" className="text-xs font-medium text-slate-300">
                        Neuer Gruppenname
                      </label>
                      <input
                        id="group-new-name"
                        type="text"
                        autoFocus
                        value={groupNewName}
                        onChange={(e) => setGroupNewName(e.target.value)}
                        className="glass-input w-full rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 outline-none focus:ring-2 focus:ring-cyan-500/50"
                        placeholder="z. B. Garten & Terrasse"
                      />
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setGroupModal(null)}
                        className="rounded-lg px-4 py-2 text-xs font-medium text-slate-300 hover:bg-white/10 transition-colors"
                      >
                        Abbrechen
                      </button>
                      <button
                        type="submit"
                        disabled={
                          !groupNewName.trim() ||
                          groupNewName.trim().toLowerCase() === "ungruppiert" ||
                          groupNewName.trim().toLowerCase() === groupModal.groupName.toLowerCase()
                        }
                        className="rounded-lg bg-cyan-600 px-4 py-2 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-md shadow-cyan-600/30"
                      >
                        Speichern
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/20 text-rose-400">
                        <Trash2 className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="text-base font-semibold text-white">Gruppe löschen?</h3>
                        <p className="text-xs text-slate-400">Gruppe: „{groupModal.groupName}“</p>
                      </div>
                    </div>

                    <p className="text-sm text-slate-300">
                      Möchtest du die Gruppe <span className="font-semibold text-white">„{groupModal.groupName}“</span> wirklich auflösen? Die Kameras bleiben erhalten und werden als <span className="font-semibold text-white">„Ungruppiert“</span> angezeigt.
                    </p>

                    <div className="flex items-center justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setGroupModal(null)}
                        className="rounded-lg px-4 py-2 text-xs font-medium text-slate-300 hover:bg-white/10 transition-colors"
                      >
                        Abbrechen
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteGroup(groupModal.groupName)}
                        className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-500 transition-all shadow-md shadow-rose-600/30"
                      >
                        Gruppe löschen
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>,
            document.body
          )}

          {selectedSnapshot && (
            <SnapshotLightboxModal
              snapshot={selectedSnapshot}
              onClose={() => setSelectedSnapshot(null)}
            />
          )}
        </>
      )}
    </div>
  );
}
