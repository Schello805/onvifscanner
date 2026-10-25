"use client";
/* eslint-disable @next/next/no-img-element */

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  X,
  Minimize2,
  Tv,
  Clock,
  Sliders,
  Radio,
  ExternalLink,
} from "lucide-react";
import type { WallCamera } from "@/lib/cameraWall";
import { useLanguage } from "../LanguageProvider";
import { WebRtcPlayer } from "@/components/WebRtcPlayer";

export type CameraImageState = {
  src?: string;
  sourceUri?: string;
  state: "idle" | "loading" | "ok" | "error";
  message?: string;
  updatedAt?: Date;
};

type KioskSettings = {
  popupDurationSeconds: number;
  dimMinutes: number;
  autoPopupEnabled: boolean;
  dimmingEnabled: boolean;
};

const DEFAULT_SETTINGS: KioskSettings = {
  popupDurationSeconds: 25,
  dimMinutes: 3,
  autoPopupEnabled: true,
  dimmingEnabled: true,
};

export function KioskMode({
  isOpen,
  onClose,
  cameras,
  images = {},
  liveCameras = new Set(),
  liveWhepUrls = {},
  livePlaybackUrls = {},
  liveLoading = new Set(),
  onToggleLive,
  onOpenExpanded,
}: {
  isOpen: boolean;
  onClose: () => void;
  cameras: WallCamera[];
  images?: Record<string, CameraImageState>;
  liveCameras?: Set<string>;
  liveWhepUrls?: Record<string, string>;
  livePlaybackUrls?: Record<string, string>;
  liveLoading?: Set<string>;
  onToggleLive?: (cameraId: string) => void | Promise<boolean | void>;
  onOpenExpanded?: (cameraId: string) => void;
}) {
  const { t } = useLanguage();

  const [settings, setSettings] = useState<KioskSettings>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("onvifscanner:kiosk-settings");
        if (saved) return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
      } catch {}
    }
    return DEFAULT_SETTINGS;
  });

  const [showSettings, setShowSettings] = useState(false);
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [focusedCameraId, setFocusedCameraId] = useState<string | null>(null);
  const [isAutoMotionPopup, setIsAutoMotionPopup] = useState(false);
  const [popupTimeRemaining, setPopupTimeRemaining] = useState<number>(0);
  const [isDimmed, setIsDimmed] = useState(false);
  const [lastMotionTime, setLastMotionTime] = useState<number>(Date.now());
  const [currentTime, setCurrentTime] = useState(new Date());

  const lastSeenEventIdRef = useRef<string | null>(null);
  const wakeLockRef = useRef<any>(null);
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Save settings to localStorage
  const updateSettings = (partial: Partial<KioskSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...partial };
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem("onvifscanner:kiosk-settings", JSON.stringify(next));
        } catch {}
      }
      return next;
    });
  };

  // 1. Clock interval
  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, [isOpen]);

  // 2. Escape key to close focused camera or kiosk mode
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (focusedCameraId) {
          setFocusedCameraId(null);
          setIsAutoMotionPopup(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, focusedCameraId, onClose]);

  // 3. Wake Lock API (keeps tablet screen awake)
  const requestWakeLock = useCallback(async () => {
    if (typeof window === "undefined" || !("wakeLock" in navigator)) return;
    try {
      wakeLockRef.current = await (navigator as any).wakeLock.request("screen");
      setWakeLockActive(true);
      wakeLockRef.current.addEventListener("release", () => {
        setWakeLockActive(false);
      });
    } catch (err) {
      console.warn("[Kiosk] Wake Lock could not be acquired:", err);
      setWakeLockActive(false);
    }
  }, []);

  const releaseWakeLock = useCallback(() => {
    if (wakeLockRef.current) {
      try {
        wakeLockRef.current.release();
      } catch {}
      wakeLockRef.current = null;
      setWakeLockActive(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      void requestWakeLock();
      const onVisibilityChange = () => {
        if (document.visibilityState === "visible") {
          void requestWakeLock();
        }
      };
      document.addEventListener("visibilitychange", onVisibilityChange);
      return () => {
        document.removeEventListener("visibilitychange", onVisibilityChange);
        releaseWakeLock();
      };
    } else {
      releaseWakeLock();
    }
  }, [isOpen, requestWakeLock, releaseWakeLock]);

  // 4. Fullscreen Management
  useEffect(() => {
    if (isOpen) {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {});
      }
    } else {
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
    }
  }, [isOpen]);

  // 5. Motion Event Polling & Auto-Popup (if enabled)
  useEffect(() => {
    if (!isOpen || !settings.autoPopupEnabled) return;

    let mounted = true;
    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch("/api/activity-log?limit=3&type=motion", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        const events = data.events || [];
        if (!events.length) return;

        const latestMotion = events.find((e: any) => e.type === "motion");
        if (!latestMotion) return;

        if (lastSeenEventIdRef.current === null) {
          lastSeenEventIdRef.current = latestMotion.id;
          return;
        }

        if (latestMotion.id !== lastSeenEventIdRef.current) {
          lastSeenEventIdRef.current = latestMotion.id;
          const matchedCam = cameras.find(
            (c) => c.id === latestMotion.cameraId || c.ip === latestMotion.cameraIp
          );

          if (matchedCam && mounted) {
            setFocusedCameraId(matchedCam.id);
            setIsAutoMotionPopup(true);
            setPopupTimeRemaining(settings.popupDurationSeconds);
            setLastMotionTime(Date.now());
            setIsDimmed(false);
          }
        }
      } catch {}
    }, 4000);

    return () => {
      mounted = false;
      clearInterval(pollInterval);
    };
  }, [isOpen, settings.autoPopupEnabled, settings.popupDurationSeconds, cameras]);

  // 6. Popup Countdown Timer (Only active for auto-motion popup)
  useEffect(() => {
    if (!focusedCameraId || !isAutoMotionPopup || popupTimeRemaining <= 0) {
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
      if (focusedCameraId && isAutoMotionPopup && popupTimeRemaining <= 0) {
        setFocusedCameraId(null);
        setIsAutoMotionPopup(false);
      }
      return;
    }

    countdownIntervalRef.current = setInterval(() => {
      setPopupTimeRemaining((prev) => {
        if (prev <= 1) {
          setFocusedCameraId(null);
          setIsAutoMotionPopup(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    };
  }, [focusedCameraId, isAutoMotionPopup, popupTimeRemaining]);

  // 7. Inactivity Screen Dimming
  useEffect(() => {
    if (!isOpen || !settings.dimmingEnabled) {
      setIsDimmed(false);
      return;
    }

    const checkDimInterval = setInterval(() => {
      const idleMs = Date.now() - lastMotionTime;
      const thresholdMs = settings.dimMinutes * 60 * 1000;
      if (idleMs >= thresholdMs && !focusedCameraId && !isDimmed) {
        setIsDimmed(true);
      }
    }, 5000);

    return () => clearInterval(checkDimInterval);
  }, [isOpen, settings.dimmingEnabled, settings.dimMinutes, lastMotionTime, focusedCameraId, isDimmed]);

  const handleUserActivity = () => {
    if (isDimmed) {
      setIsDimmed(false);
      setLastMotionTime(Date.now());
    }
  };

  if (!isOpen) return null;

  const focusedCamera = cameras.find((c) => c.id === focusedCameraId);
  const focusedIsLive = Boolean(focusedCamera && liveCameras.has(focusedCamera.id) && liveWhepUrls[focusedCamera.id]);
  const focusedImgData = focusedCamera ? images[focusedCamera.id] : undefined;

  return (
    <div
      onClick={handleUserActivity}
      className="fixed inset-0 z-[100050] flex flex-col select-none overflow-hidden bg-slate-950 text-slate-100"
    >
      {/* ─── AMBIENT SCREEN-DIMMER / SCREENSAVER OVERLAY ─── */}
      {isDimmed && (
        <div className="absolute inset-0 z-50 flex cursor-pointer flex-col items-center justify-center bg-slate-950/95 p-6 text-center backdrop-blur-2xl animate-in fade-in duration-500">
          <div className="space-y-3">
            <span className="font-mono text-7xl font-light tracking-tight text-slate-400 sm:text-9xl">
              {currentTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
            <p className="text-lg font-medium text-slate-500 sm:text-xl">
              {currentTime.toLocaleDateString([], {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </p>
            <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900/60 px-4 py-1.5 text-xs text-slate-400 shadow-sm">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
              <span>{t("Wand-Tablet aktiv • Tippen zum Aufwecken", "Wall Tablet Active • Tap to wake")}</span>
            </div>
          </div>
        </div>
      )}

      {/* ─── TOP KIOSK STATUS BAR (Safe-area compliant) ─── */}
      <div className="z-20 flex shrink-0 items-center justify-between border-b border-slate-800/80 bg-slate-950/90 px-4 py-2.5 pt-[max(2.75rem,calc(env(safe-area-inset-top,0px)+0.5rem))] backdrop-blur-md sm:pt-2.5">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-indigo-500" />
            <span className="flex items-center gap-1.5 text-xs font-bold tracking-tight text-white">
              <Tv className="h-4 w-4 text-indigo-400" />
              {t("Kiosk- & Wandmodus", "Kiosk & Wall Mode")}
            </span>
          </div>

          <span className="hidden text-slate-600 sm:inline-block">|</span>

          <span className="hidden items-center gap-1 text-[11px] text-slate-400 sm:inline-flex">
            <Clock className="h-3.5 w-3.5 text-slate-500" />
            {currentTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>

          {wakeLockActive && (
            <span className="hidden rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300 md:inline-flex">
              {t("Display aktiv", "Always-On")}
            </span>
          )}
        </div>

        {/* Right Action Buttons */}
        <div className="flex items-center gap-2">
          {/* Settings Toggle */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowSettings((prev) => !prev);
            }}
            className={`btn btn-xs rounded-xl border border-slate-800 transition-colors ${
              showSettings ? "bg-indigo-600 text-white" : "bg-slate-900 text-slate-400 hover:text-white"
            }`}
            title={t("Kiosk-Einstellungen", "Kiosk Settings")}
          >
            <Sliders className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t("Optionen", "Options")}</span>
          </button>

          {/* Exit Kiosk Button */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl border border-rose-500/40 bg-rose-600/90 px-3.5 py-1.5 text-xs font-bold text-white shadow-lg transition hover:bg-rose-500 active:scale-95"
            aria-label="Kiosk-Modus beenden"
          >
            <Minimize2 className="h-4 w-4" />
            <span>{t("Beenden", "Exit")}</span>
          </button>
        </div>
      </div>

      {/* ─── KIOSK SETTINGS POP-DOWN ─── */}
      {showSettings && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute top-16 right-4 z-40 w-80 space-y-3.5 rounded-2xl border border-slate-800 bg-slate-900/95 p-4 shadow-2xl backdrop-blur-xl animate-in slide-in-from-top-2"
        >
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="text-xs font-bold text-slate-200">
              {t("Wand-Tablet Einstellungen", "Wall Tablet Settings")}
            </span>
            <button
              onClick={() => setShowSettings(false)}
              className="text-slate-400 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Auto Popup Toggle */}
          <label className="flex cursor-pointer items-start justify-between gap-3">
            <div>
              <span className="block text-xs font-semibold text-slate-200">
                {t("Auto-Fokus bei Bewegung", "Auto-Focus on Motion")}
              </span>
              <span className="block text-[11px] text-slate-400">
                {t(
                  "Zoomt Kamera bei Bewegung automatisch ins Großbild",
                  "Auto-zooms camera to large view on motion"
                )}
              </span>
            </div>
            <input
              type="checkbox"
              className="toggle toggle-primary toggle-xs mt-0.5"
              checked={settings.autoPopupEnabled}
              onChange={(e) => updateSettings({ autoPopupEnabled: e.target.checked })}
            />
          </label>

          {/* Duration Selector */}
          {settings.autoPopupEnabled && (
            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-slate-400">
                {t("Verweildauer im Großbild", "Focus Duration")}
              </label>
              <div className="grid grid-cols-4 gap-1.5">
                {[15, 25, 45, 60].map((sec) => (
                  <button
                    key={sec}
                    type="button"
                    onClick={() => updateSettings({ popupDurationSeconds: sec })}
                    className={`rounded-lg border py-1 text-xs font-semibold transition-all ${
                      settings.popupDurationSeconds === sec
                        ? "border-indigo-500 bg-indigo-600 text-white shadow-sm"
                        : "border-slate-800 bg-slate-950/60 text-slate-400 hover:text-white"
                    }`}
                  >
                    {sec}s
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Dimming Toggle */}
          <div className="space-y-2 border-t border-slate-800 pt-2">
            <label className="flex cursor-pointer items-start justify-between gap-3">
              <div>
                <span className="block text-xs font-semibold text-slate-200">
                  {t("Display abdunkeln bei Inaktivität", "Dim Display on Inactivity")}
                </span>
                <span className="block text-[11px] text-slate-400">
                  {t(
                    "Schont das Display bei längerer Ruhezeit",
                    "Protects screen during long idle periods"
                  )}
                </span>
              </div>
              <input
                type="checkbox"
                className="toggle toggle-info toggle-xs mt-0.5"
                checked={settings.dimmingEnabled}
                onChange={(e) => updateSettings({ dimmingEnabled: e.target.checked })}
              />
            </label>

            {settings.dimmingEnabled && (
              <div className="space-y-1 pt-1">
                <label className="block text-[11px] font-medium text-slate-400">
                  {t("Abdunkeln nach", "Dim After")}
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  {[2, 3, 5].map((min) => (
                    <button
                      key={min}
                      type="button"
                      onClick={() => updateSettings({ dimMinutes: min })}
                      className={`rounded-lg border py-1 text-xs font-semibold transition-all ${
                        settings.dimMinutes === min
                          ? "border-sky-500 bg-sky-600 text-white shadow-sm"
                          : "border-slate-800 bg-slate-950/60 text-slate-400 hover:text-white"
                      }`}
                    >
                      {min} Min
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── MAIN CONTENT VIEW ─── */}
      <div className="relative flex-1 overflow-hidden bg-slate-950 p-2 sm:p-3">
        {/* CASE A: A CAMERA IS FOCUSED */}
        {focusedCamera ? (
          <div className="absolute inset-2 z-30 flex flex-col overflow-hidden rounded-2xl border border-indigo-500/50 bg-slate-900 shadow-2xl animate-in zoom-in-95 duration-200 sm:inset-3">
            {/* Header Overlay */}
            <div className="flex items-center justify-between border-b border-white/10 bg-slate-950/90 px-4 py-2.5">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className={`h-2.5 w-2.5 rounded-full ${isAutoMotionPopup ? "animate-ping bg-rose-500" : "bg-emerald-400"}`} />
                <span className="truncate text-sm font-bold text-white">
                  {focusedCamera.name}
                </span>
                <span className="hidden font-mono text-xs text-slate-400 sm:inline">
                  {focusedCamera.ip}
                </span>
                {isAutoMotionPopup ? (
                  <span className="rounded-full border border-rose-500/30 bg-rose-500/20 px-2 py-0.5 text-[10px] font-semibold text-rose-300">
                    {t("BEWEGUNG", "MOTION")}
                  </span>
                ) : (
                  <span className="rounded-full border border-indigo-500/30 bg-indigo-500/20 px-2 py-0.5 text-[10px] font-semibold text-indigo-300">
                    {t("Fokus-Ansicht", "Focus View")}
                  </span>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {/* Live stream toggle */}
                {onToggleLive && (
                  <button
                    type="button"
                    disabled={liveLoading.has(focusedCamera.id)}
                    onClick={() => void onToggleLive(focusedCamera.id)}
                    className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition active:scale-95 ${
                      focusedIsLive
                        ? "border-sky-500/50 bg-sky-600 text-white"
                        : "border-white/15 bg-white/10 text-slate-200 hover:bg-white/20"
                    }`}
                  >
                    <Radio className={`h-3.5 w-3.5 ${focusedIsLive ? "animate-pulse" : ""}`} />
                    <span>{liveLoading.has(focusedCamera.id) ? "…" : focusedIsLive ? "Live ■" : "Live ▶"}</span>
                  </button>
                )}

                {/* Open expanded in main app */}
                {onOpenExpanded && (
                  <button
                    type="button"
                    onClick={() => {
                      onOpenExpanded(focusedCamera.id);
                      onClose();
                    }}
                    className="hidden items-center gap-1.5 rounded-xl border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-white/20 sm:inline-flex"
                    title={t("In Hauptansicht öffnen", "Open in main view")}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span>{t("Details", "Details")}</span>
                  </button>
                )}

                {/* Countdown Timer for auto popup */}
                {isAutoMotionPopup && popupTimeRemaining > 0 && (
                  <div className="flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-950/80 px-2.5 py-1 font-mono text-xs font-bold text-rose-300">
                    <Clock className="h-3.5 w-3.5 text-rose-400" />
                    <span>{popupTimeRemaining}s</span>
                  </div>
                )}

                {/* Close focused view */}
                <button
                  type="button"
                  onClick={() => {
                    setFocusedCameraId(null);
                    setIsAutoMotionPopup(false);
                  }}
                  className="inline-flex items-center gap-1 rounded-xl border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-white/20 active:scale-95"
                >
                  <X className="h-4 w-4" />
                  <span>{t("Übersicht", "Overview")}</span>
                </button>
              </div>
            </div>

            {/* Video / Snapshot Area */}
            <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-black">
              {focusedIsLive ? (
                <WebRtcPlayer
                  whepUrl={liveWhepUrls[focusedCamera.id]}
                  playbackUrl={livePlaybackUrls[focusedCamera.id] || ""}
                  title={focusedCamera.name}
                  className="h-full w-full object-contain"
                />
              ) : focusedImgData?.src ? (
                <img
                  src={focusedImgData.src}
                  alt=""
                  className="h-full w-full object-contain"
                />
              ) : (
                <div className="flex flex-col items-center justify-center gap-2 text-slate-400">
                  <span className="text-3xl">◉</span>
                  <span className="text-sm font-medium">
                    {focusedImgData?.message || t("Kein Kamerabild verfügbar", "No camera image available")}
                  </span>
                </div>
              )}

              {/* Progress bar ticking down if auto motion */}
              {isAutoMotionPopup && (
                <div className="absolute inset-x-0 bottom-0 h-1.5 bg-slate-800">
                  <div
                    className="h-full bg-rose-500 transition-all duration-1000 ease-linear"
                    style={{
                      width: `${Math.max(0, (popupTimeRemaining / settings.popupDurationSeconds) * 100)}%`,
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        ) : null}

        {/* CASE B: NORMAL CAMERA GRID */}
        <div
          className={`grid h-full w-full gap-2 sm:gap-3 ${
            cameras.length <= 1
              ? "grid-cols-1"
              : cameras.length === 2
              ? "grid-cols-1 sm:grid-cols-2"
              : cameras.length <= 4
              ? "grid-cols-2"
              : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4"
          }`}
        >
          {cameras.map((camera) => {
            const isLive = Boolean(liveCameras.has(camera.id) && liveWhepUrls[camera.id]);
            const imgData = images[camera.id];

            return (
              <div
                key={camera.id}
                onClick={() => {
                  setFocusedCameraId(camera.id);
                  setIsAutoMotionPopup(false);
                }}
                className="group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border border-slate-800/90 bg-slate-900 shadow-sm transition-all hover:border-indigo-500/50"
              >
                <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-black">
                  {isLive ? (
                    <WebRtcPlayer
                      whepUrl={liveWhepUrls[camera.id]}
                      playbackUrl={livePlaybackUrls[camera.id] || ""}
                      title={camera.name}
                      className="pointer-events-none h-full w-full object-cover"
                    />
                  ) : imgData?.src ? (
                    <img
                      src={imgData.src}
                      alt=""
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-102"
                    />
                  ) : (
                    <div className="flex aspect-video w-full flex-col items-center justify-center gap-1.5 p-2 text-center text-slate-500">
                      <span className={imgData?.state === "loading" ? "animate-pulse text-xl text-sky-400" : "text-xl"}>
                        {imgData?.state === "error" ? "⚠️" : "◉"}
                      </span>
                      <span className="max-w-full truncate text-[11px] font-medium text-slate-400">
                        {imgData?.state === "loading"
                          ? t("Lädt…", "Loading…")
                          : imgData?.message || t("Kein Bild", "No image")}
                      </span>
                    </div>
                  )}

                  {/* Overlay Name & Badges */}
                  <div className="absolute top-2 left-2 flex max-w-[85%] items-center gap-1.5 truncate rounded-lg border border-white/10 bg-black/75 px-2 py-0.5 text-xs font-semibold text-white backdrop-blur-md">
                    {isLive && <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-sky-400" />}
                    <span className="truncate">{camera.name}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── MOBILE BOTTOM EXIT BAR ─── */}
      <div className="z-20 flex shrink-0 items-center justify-between border-t border-slate-800/80 bg-slate-950/95 px-4 py-2 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] sm:hidden">
        <span className="text-[11px] text-slate-400">
          {cameras.length} {t("Kameras im Wandmodus", "cameras in wall mode")}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/40 bg-rose-600/90 px-3.5 py-1.5 text-xs font-bold text-white shadow transition hover:bg-rose-500 active:scale-95"
        >
          <Minimize2 className="h-3.5 w-3.5" />
          <span>{t("Kiosk beenden", "Exit Kiosk")}</span>
        </button>
      </div>
    </div>
  );
}
