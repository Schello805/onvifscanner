"use client";

import { useEffect, useState } from "react";
import { Activity, X, RefreshCw, Radio, CheckCircle, AlertTriangle, Video, Users, ArrowDown } from "lucide-react";
import { formatBytes } from "@/components/playback/playbackUtils";

type CameraHealthData = {
  id: string;
  name: string;
  ip: string;
  isOnline: boolean;
  lastSeen: string | null;
  pingFailures: number;
  disconnects24h: number;
  uptimePercent: number;
  streaming: {
    active: boolean;
    readers: number;
    bytesReceived: number;
    tracks: Array<{ type: string; codec: string }>;
  };
};

type HealthResponse = {
  ok: boolean;
  mediaMtxAlive: boolean;
  cameras: CameraHealthData[];
  totalCameras: number;
  onlineCameras: number;
};

export function HealthDashboardModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchHealth = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/system/health", { cache: "no-store" });
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch {
      // quiet fallback
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      void fetchHealth();
      const interval = setInterval(() => void fetchHealth(), 5000);
      return () => clearInterval(interval);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100020] flex items-center justify-center bg-black/80 px-3 pt-[max(3.5rem,calc(env(safe-area-inset-top,0px)+1rem))] pb-[max(1rem,calc(env(safe-area-inset-bottom,0px)+0.75rem))] backdrop-blur-md sm:p-6"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[82dvh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-slate-950 shadow-2xl sm:max-h-[calc(100dvh-3rem)]">
        <header className="flex shrink-0 items-center justify-between border-b border-white/10 bg-slate-900/80 px-4 py-3.5 sm:px-5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
              <Activity className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">System- & Kamera-Gesundheit</h2>
              <p className="text-[11px] text-slate-400">Live-Bitrate, Verbindungsstabilität & Stream-Status</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={fetchHealth}
              disabled={loading}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
              title="Aktualisieren"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin text-emerald-400" : ""}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        {/* Global Summary Cards */}
        <div className="grid grid-cols-2 gap-3 p-4 border-b border-white/10 bg-slate-900/40 sm:grid-cols-4">
          <div className="rounded-xl border border-white/10 bg-slate-900/60 p-3">
            <span className="text-[10px] uppercase font-semibold text-slate-400">Kameras Online</span>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-xl font-bold text-white">{data?.onlineCameras ?? 0}</span>
              <span className="text-xs text-slate-400">/ {data?.totalCameras ?? 0}</span>
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-slate-900/60 p-3">
            <span className="text-[10px] uppercase font-semibold text-slate-400">Streaming-Server</span>
            <div className="mt-1 flex items-center gap-1.5">
              {data?.mediaMtxAlive ? (
                <>
                  <CheckCircle className="h-4 w-4 text-emerald-400" />
                  <span className="text-xs font-semibold text-emerald-300">MediaMTX Aktiv</span>
                </>
              ) : (
                <>
                  <AlertTriangle className="h-4 w-4 text-rose-400" />
                  <span className="text-xs font-semibold text-rose-300">Getrennt</span>
                </>
              )}
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-slate-900/60 p-3">
            <span className="text-[10px] uppercase font-semibold text-slate-400">Aktive Streams</span>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-xl font-bold text-emerald-400">
                {data?.cameras.filter((c) => c.streaming.active).length ?? 0}
              </span>
              <span className="text-xs text-slate-400">bereit</span>
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-slate-900/60 p-3">
            <span className="text-[10px] uppercase font-semibold text-slate-400">Zuschauer (WebRTC)</span>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-xl font-bold text-amber-400">
                {data?.cameras.reduce((sum, c) => sum + c.streaming.readers, 0) ?? 0}
              </span>
              <span className="text-xs text-slate-400">Viewer</span>
            </div>
          </div>
        </div>

        {/* Camera List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {(!data?.cameras || data.cameras.length === 0) ? (
            <div className="py-12 text-center text-sm text-slate-400">Keine Kameras konfiguriert.</div>
          ) : (
            data.cameras.map((cam) => (
              <div
                key={cam.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-900/70 p-3.5 hover:border-white/20 transition-colors"
              >
                <div className="flex items-start sm:items-center gap-3">
                  <span
                    className={`mt-1 sm:mt-0 h-3 w-3 rounded-full shrink-0 ${
                      cam.isOnline
                        ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]"
                        : "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)]"
                    }`}
                  />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-white">{cam.name}</span>
                      <span className="text-[11px] text-slate-400">{cam.ip}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-slate-400">
                      <span>24h-Stabilität: <strong className={cam.uptimePercent >= 95 ? "text-emerald-400" : "text-orange-400"}>{cam.uptimePercent}%</strong></span>
                      {cam.disconnects24h > 0 && (
                        <span className="text-rose-400 font-medium">({cam.disconnects24h} Abbrüche)</span>
                      )}
                      {cam.pingFailures > 0 && (
                        <span className="text-amber-400">Ping-Fehler: {cam.pingFailures}</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4 text-xs">
                  {/* Stream Status & Codecs */}
                  <div className="flex flex-col sm:items-end">
                    <div className="flex items-center gap-1.5">
                      <Radio className={`h-3.5 w-3.5 ${cam.streaming.active ? "text-emerald-400 animate-pulse" : "text-slate-500"}`} />
                      <span className={`font-medium ${cam.streaming.active ? "text-emerald-300" : "text-slate-500"}`}>
                        {cam.streaming.active ? "Live bereit" : "Standby / On Demand"}
                      </span>
                    </div>
                    {cam.streaming.tracks.length > 0 && (
                      <div className="flex gap-1 mt-0.5">
                        {cam.streaming.tracks.map((t, idx) => (
                          <span key={idx} className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">
                            {t.codec.toUpperCase()}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Traffic received */}
                  {cam.streaming.bytesReceived > 0 && (
                    <div className="hidden sm:flex flex-col items-end min-w-[70px]">
                      <span className="text-[10px] text-slate-500 uppercase">Traffic</span>
                      <span className="font-mono text-slate-300">{formatBytes(cam.streaming.bytesReceived)}</span>
                    </div>
                  )}

                  {/* Readers */}
                  {cam.streaming.readers > 0 && (
                    <div className="flex items-center gap-1 text-amber-300 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-md">
                      <Users className="h-3 w-3" />
                      <span className="font-semibold text-xs">{cam.streaming.readers}</span>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
