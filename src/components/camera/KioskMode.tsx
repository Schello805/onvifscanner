"use client";
/* eslint-disable @next/next/no-img-element */

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  X,
  Maximize2,
  Minimize2,
  Tv,
  Clock,
  Sparkles,
  AlertTriangle,
  Play,
  RotateCcw,
  Sliders,
  Check,
  ChevronRight,
  Shield,
  Eye,
} from "lucide-react";
import type { WallCamera } from "@/lib/cameraWall";
import { useLanguage } from "../LanguageProvider";

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
}: {
  isOpen: boolean;
  onClose: () => void;
  cameras: WallCamera[];
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

  // 2. Wake Lock API (keeps tablet screen awake)
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

  // 3. Fullscreen Management
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

  // 4. Motion Event Polling & Auto-Popup
  useEffect(() => {
    if (!isOpen || !settings.autoPopupEnabled) return;

    let mounted = true;
    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch("/api/activity-log?limit=3", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        const events = data.events || [];
        if (!events.length) return;

        const latestMotion = events.find((e: any) => e.type === "motion");
        if (!latestMotion) return;

        // Check if this is a newly arrived motion event
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
            // Trigger Camera Focus Pop-up
            setFocusedCameraId(matchedCam.id);
            setPopupTimeRemaining(settings.popupDurationSeconds);
            setLastMotionTime(Date.now());
            setIsDimmed(false); // wake up immediately!
          }
        }
      } catch {}
    }, 2500);

    return () => {
      mounted = false;
      clearInterval(pollInterval);
    };
  }, [isOpen, settings.autoPopupEnabled, settings.popupDurationSeconds, cameras]);

  // 5. Popup Countdown Timer
  useEffect(() => {
    if (!focusedCameraId || popupTimeRemaining <= 0) {
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
      if (focusedCameraId && popupTimeRemaining <= 0) {
        setFocusedCameraId(null);
      }
      return;
    }

    countdownIntervalRef.current = setInterval(() => {
      setPopupTimeRemaining((prev) => {
        if (prev <= 1) {
          setFocusedCameraId(null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    };
  }, [focusedCameraId, popupTimeRemaining]);

  // 6. Inactivity Screen Dimming
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

  // Touch or interaction wakes up the screen
  const handleUserActivity = () => {
    if (isDimmed) {
      setIsDimmed(false);
      setLastMotionTime(Date.now());
    }
  };

  if (!isOpen) return null;

  const focusedCamera = cameras.find((c) => c.id === focusedCameraId);

  return (
    <div
      onClick={handleUserActivity}
      className="fixed inset-0 z-[100050] bg-slate-950 text-slate-100 flex flex-col select-none overflow-hidden"
    >
      {/* ─── AMBIENT SCREEN-DIMMER / SCREENSAVER OVERLAY ─── */}
      {isDimmed && (
        <div className="absolute inset-0 z-50 bg-slate-950/95 backdrop-blur-2xl flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-500 cursor-pointer">
          <div className="space-y-3">
            <span className="text-7xl sm:text-9xl font-mono font-light tracking-tight text-slate-400">
              {currentTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
            <p className="text-lg sm:text-xl font-medium text-slate-500">
              {currentTime.toLocaleDateString([], {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </p>
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900/60 px-4 py-1.5 text-xs text-slate-400 shadow-sm mt-4">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>{t("Wand-Tablet aktiv • Tippen zum Aufwecken", "Wall Tablet Active • Tap to wake")}</span>
            </div>
          </div>
        </div>
      )}

      {/* ─── TOP KIOSK STATUS BAR (Auto-hides or subtle) ─── */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-md shrink-0 z-20">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-indigo-500 animate-pulse" />
            <span className="text-xs font-bold tracking-tight text-white flex items-center gap-1.5">
              <Tv className="w-4 h-4 text-indigo-400" />
              {t("Kiosk- & Wandmodus", "Kiosk & Wall Mode")}
            </span>
          </div>

          <span className="hidden sm:inline-block text-slate-600">|</span>

          <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-slate-400">
            <Clock className="w-3.5 h-3.5 text-slate-500" />
            {currentTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>

          {wakeLockActive && (
            <span className="hidden md:inline-flex rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-[10px] text-emerald-300 font-medium">
              {t("Display dauerhaft aktiv", "Display Always-On")}
            </span>
          )}
        </div>

        {/* Right Action Icons */}
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
            <Sliders className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t("Optionen", "Options")}</span>
          </button>

          {/* Exit Kiosk Button */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="btn btn-xs bg-rose-600/80 hover:bg-rose-500 text-white border-none rounded-xl gap-1"
          >
            <Minimize2 className="w-3.5 h-3.5" />
            <span>{t("Beenden", "Exit")}</span>
          </button>
        </div>
      </div>

      {/* ─── KIOSK SETTINGS POP-DOWN ─── */}
      {showSettings && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute top-12 right-4 z-40 w-80 rounded-2xl border border-slate-800 bg-slate-900/95 p-4 shadow-2xl backdrop-blur-xl space-y-3.5 animate-in slide-in-from-top-2"
        >
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="text-xs font-bold text-slate-200">
              {t("Wand-Tablet Einstellungen", "Wall Tablet Settings")}
            </span>
            <button
              onClick={() => setShowSettings(false)}
              className="text-slate-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Auto Popup Toggle */}
          <label className="flex items-start justify-between gap-3 cursor-pointer">
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
                    className={`py-1 text-xs font-semibold rounded-lg border transition-all ${
                      settings.popupDurationSeconds === sec
                        ? "bg-indigo-600 text-white border-indigo-500 shadow-sm"
                        : "bg-slate-950/60 text-slate-400 border-slate-800 hover:text-white"
                    }`}
                  >
                    {sec}s
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Dimming Toggle */}
          <div className="pt-2 border-t border-slate-800 space-y-2">
            <label className="flex items-start justify-between gap-3 cursor-pointer">
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
                      className={`py-1 text-xs font-semibold rounded-lg border transition-all ${
                        settings.dimMinutes === min
                          ? "bg-sky-600 text-white border-sky-500 shadow-sm"
                          : "bg-slate-950/60 text-slate-400 border-slate-800 hover:text-white"
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
      <div className="flex-1 relative overflow-hidden bg-slate-950 p-2 sm:p-3">
        {/* CASE A: A CAMERA IS AUTO-FOCUSED ON MOTION */}
        {focusedCamera ? (
          <div className="absolute inset-2 sm:inset-3 z-30 flex flex-col rounded-2xl overflow-hidden border border-rose-500/50 bg-slate-900 shadow-2xl animate-in zoom-in-95 duration-200">
            {/* Header Overlay */}
            <div className="flex items-center justify-between px-4 py-2.5 bg-gradient-to-r from-rose-950/90 via-slate-950/90 to-slate-950/90 border-b border-rose-500/30">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="h-3 w-3 rounded-full bg-rose-500 animate-ping shrink-0" />
                <span className="font-bold text-sm text-white truncate">
                  {focusedCamera.name}
                </span>
                <span className="rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[10px] font-semibold px-2 py-0.5">
                  {t("BEWEGUNG ERKANNT", "MOTION DETECTED")}
                </span>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                {/* Countdown Timer */}
                <div className="flex items-center gap-1.5 bg-slate-950/80 px-2.5 py-1 rounded-xl border border-slate-800 text-xs font-mono font-bold text-rose-300">
                  <Clock className="w-3.5 h-3.5 text-rose-400" />
                  <span>{popupTimeRemaining}s</span>
                </div>

                <button
                  type="button"
                  onClick={() => setFocusedCameraId(null)}
                  className="btn btn-xs btn-ghost text-slate-300 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Video / Snapshot Area */}
            <div className="flex-1 relative bg-black flex items-center justify-center overflow-hidden">
              <img
                src={`/api/thumbnail?ip=${encodeURIComponent(focusedCamera.ip)}&t=${Date.now()}`}
                alt={focusedCamera.name}
                className="w-full h-full object-contain"
              />

              {/* Progress bar ticking down */}
              <div className="absolute bottom-0 inset-x-0 h-1.5 bg-slate-800">
                <div
                  className="h-full bg-rose-500 transition-all duration-1000 ease-linear"
                  style={{
                    width: `${Math.max(0, (popupTimeRemaining / settings.popupDurationSeconds) * 100)}%`,
                  }}
                />
              </div>
            </div>
          </div>
        ) : null}

        {/* CASE B: NORMAL CAMERA GRID */}
        <div
          className={`h-full w-full grid gap-2 sm:gap-3 ${
            cameras.length <= 1
              ? "grid-cols-1"
              : cameras.length === 2
              ? "grid-cols-1 sm:grid-cols-2"
              : cameras.length <= 4
              ? "grid-cols-2"
              : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4"
          }`}
        >
          {cameras.map((camera) => (
            <div
              key={camera.id}
              onClick={() => {
                setFocusedCameraId(camera.id);
                setPopupTimeRemaining(settings.popupDurationSeconds);
              }}
              className="relative rounded-xl overflow-hidden border border-slate-800/90 bg-slate-900 group cursor-pointer hover:border-indigo-500/50 transition-all flex flex-col shadow-sm"
            >
              <div className="flex-1 relative bg-black flex items-center justify-center overflow-hidden">
                <img
                  src={`/api/thumbnail?ip=${encodeURIComponent(camera.ip)}`}
                  alt={camera.name}
                  className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-102"
                  loading="lazy"
                />
                {/* Overlay Name */}
                <div className="absolute top-2 left-2 px-2 py-0.5 rounded-lg bg-black/75 backdrop-blur-md border border-white/10 text-xs font-semibold text-white truncate max-w-[85%]">
                  {camera.name}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
