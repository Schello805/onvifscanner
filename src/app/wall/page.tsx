"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { loadWallData, saveWallData, type WallCamera } from "@/lib/cameraWall";

type CameraImageState = {
  src?: string;
  sourceUri?: string;
  state: "idle" | "loading" | "ok" | "error";
  message?: string;
  updatedAt?: Date;
};

type CameraEditDraft = {
  name: string;
  snapshotUris: string;
  streamUris: string;
  username: string;
  password: string;
  group: string;
  overlayPosition: "top-left" | "top-right" | "bottom-left" | "bottom-right";
};

function apiUrl(path: string): string {
  return new URL(path, window.location.origin).toString();
}

export default function CameraWallPage() {
  const [cameras, setCameras] = useState<WallCamera[]>([]);
  const [images, setImages] = useState<Record<string, CameraImageState>>({});
  const [columns, setColumns] = useState(3);
  const [mobileColumns, setMobileColumns] = useState(2);
  const [expandedCameraId, setExpandedCameraId] = useState<string | null>(null);
  const [refreshSeconds, setRefreshSeconds] = useState(10);
  const [editingCameraId, setEditingCameraId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<CameraEditDraft | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [liveCameras, setLiveCameras] = useState<Set<string>>(new Set());
  const [livePlaybackUrls, setLivePlaybackUrls] = useState<Record<string, string>>({});
  const [liveErrors, setLiveErrors] = useState<Record<string, string>>({});
  const [liveLoading, setLiveLoading] = useState<Set<string>>(new Set());
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const wallRef = useRef<HTMLDivElement>(null);
  const objectUrlsRef = useRef<Record<string, string>>({});
  const runningRef = useRef<Set<string>>(new Set());
  const refreshRunningRef = useRef(false);
  const liveCamerasRef = useRef<Set<string>>(new Set());
  const initialRefreshDoneRef = useRef(false);
  const lastClickRef = useRef<{ id: string, time: number }>({ id: "", time: 0 });

  useEffect(() => {
    liveCamerasRef.current = liveCameras;
  }, [liveCameras]);

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
    const onFullscreenChange = () => {
      const fullscreen = Boolean(document.fullscreenElement);
      setIsFullscreen(fullscreen);
      if (!fullscreen) setControlsVisible(true);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    if (!editingCameraId && !expandedCameraId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeEditor();
        setExpandedCameraId(null);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [editingCameraId, expandedCameraId]);

  const loadCamera = useCallback(async (camera: WallCamera, fresh = false) => {
    if ((!camera.snapshotUris.length && !camera.streamUris.length) || runningRef.current.has(camera.id)) return;
    
    // Don't hammer the API if the background ping detected it as offline
    if (camera.status?.isOnline === false) {
       setImages((current) => ({
         ...current,
         [camera.id]: { ...current[camera.id], state: "error", message: "Kamera ist offline" }
       }));
       return;
    }

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
          urls,
          size: 512,
          timeoutMs: 3000,
          fastAuth: true,
          fresh,
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
    const timer = window.setInterval(() => void refreshAll(false), refreshSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [cameras.length, refreshAll, refreshSeconds]);

  function persist(next: WallCamera[]) {
    setCameras(next);
    saveWallData({ cameras: next, columns, refresh: refreshSeconds });
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
    setEditDraft({
      name: camera.name,
      snapshotUris: camera.snapshotUris.join("\n"),
      streamUris: camera.streamUris.join("\n"),
      username: camera.credentials?.username ?? "",
      password: camera.credentials?.password ?? "",
      group: camera.group ?? "",
      overlayPosition: camera.overlayPosition ?? "top-left"
    });
    setShowPassword(false);
  }

  function closeEditor() {
    setEditingCameraId(null);
    setEditDraft(null);
    setShowPassword(false);
  }

  function removeCamera(id: string) {
    const next = cameras.filter((item) => item.id !== id);
    if (expandedCameraId === id) setExpandedCameraId(null);
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
  }

  function saveCameraDetails() {
    if (!editingCameraId || !editDraft) return;
    const lines = (value: string) => Array.from(new Set(value.split("\n").map((line) => line.trim()).filter(Boolean)));
    const next = cameras.map((camera) => camera.id === editingCameraId ? {
      ...camera,
      name: editDraft.name.trim() || `Kamera ${camera.ip}`,
      snapshotUris: lines(editDraft.snapshotUris),
      streamUris: lines(editDraft.streamUris),
      credentials: editDraft.username.trim()
        ? { username: editDraft.username.trim(), password: editDraft.password }
        : undefined,
      group: editDraft.group.trim() || undefined,
      overlayPosition: editDraft.overlayPosition
    } : camera);

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
  }

  async function enterMonitorMode() {
    setControlsVisible(false);
    await wallRef.current?.requestFullscreen();
  }

  async function leaveFullscreen() {
    if (document.fullscreenElement) await document.exitFullscreen();
  }

  async function toggleLive(cameraId: string) {
    if (liveCameras.has(cameraId)) {
      setLiveCameras((current) => {
        const next = new Set(current);
        next.delete(cameraId);
        return next;
      });
      return;
    }

    setLiveErrors((current) => ({ ...current, [cameraId]: "" }));
    setLiveLoading((current) => new Set(current).add(cameraId));
    try {
      const response = await fetch(apiUrl("/api/stream/prepare"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cameraId })
      });
      const result = (await response.json().catch(() => null)) as { playbackUrl?: string; error?: string } | null;
      if (!response.ok || !result?.playbackUrl) {
        throw new Error(result?.error ?? `Live-Stream konnte nicht gestartet werden (HTTP ${response.status}).`);
      }
      setLivePlaybackUrls((current) => ({ ...current, [cameraId]: result.playbackUrl! }));
      setLiveCameras((current) => new Set(current).add(cameraId));
    } catch (error) {
      setLiveErrors((current) => ({
        ...current,
        [cameraId]: error instanceof Error ? error.message : "Live-Stream konnte nicht gestartet werden."
      }));
    } finally {
      setLiveLoading((current) => {
        const next = new Set(current);
        next.delete(cameraId);
        return next;
      });
    }
  }

  function toggleAllLive() {
    const allIds = cameras.map(c => c.id);
    const anyNotLive = allIds.some(id => !liveCameras.has(id));
    
    if (anyNotLive) {
      // Start all cameras that are not live yet
      for (const id of allIds) {
        if (!liveCameras.has(id) && !liveLoading.has(id)) {
          void toggleLive(id);
        }
      }
    } else {
      // Stop all cameras
      setLiveCameras(new Set());
    }
  }

  return (
    <div ref={wallRef} className="camera-wall min-h-[70vh] rounded-3xl bg-slate-950 p-3 sm:p-6">
      <div className={`mb-4 sm:mb-5 ${isFullscreen && !controlsVisible ? "hidden" : "block"}`}>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <h1 className="text-2xl font-bold text-white sm:text-3xl">Kamera-Wall</h1>
              <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-300">
                {cameras.length} Kameras
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-400">Gespeicherte Kameras als automatisch aktualisiertes Monitor-Dashboard.</p>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
            <label className="hidden sm:flex min-w-0 items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-xs text-slate-300 sm:py-2">
              Spalten (Desktop)
              <select aria-label="Anzahl der Spalten Desktop" value={columns} onChange={(event) => changeColumns(Number(event.target.value))} className="min-w-0 bg-slate-900 text-white outline-none">
                {[1, 2, 3, 4, 5, 6].map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label className="flex sm:hidden min-w-0 items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-xs text-slate-300 sm:py-2">
              Spalten (Mobil)
              <select aria-label="Anzahl der Spalten Mobile" value={mobileColumns} onChange={(event) => changeMobileColumns(Number(event.target.value))} className="min-w-0 bg-slate-900 text-white outline-none">
                {[1, 2].map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label className="flex min-w-0 items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-xs text-slate-300 sm:py-2">
              Aktualisieren
              <select aria-label="Aktualisierungsintervall" value={refreshSeconds} onChange={(event) => changeRefresh(Number(event.target.value))} className="min-w-0 bg-slate-900 text-white outline-none">
                <option value={0}>Manuell</option>
                <option value={5}>5 Sek.</option>
                <option value={10}>10 Sek.</option>
                <option value={30}>30 Sek.</option>
                <option value={60}>60 Sek.</option>
              </select>
            </label>
            <button type="button" onClick={() => void refreshAll(true)} className="touch-manipulation rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-xs font-semibold text-slate-200 hover:bg-white/10 sm:py-2">↻ Jetzt laden</button>
            <button type="button" onClick={toggleAllLive} disabled={cameras.length === 0} className="touch-manipulation rounded-xl border border-sky-500/50 bg-sky-500/10 px-3 py-2.5 text-xs font-semibold text-sky-300 hover:bg-sky-500/20 sm:py-2 disabled:opacity-50">
              {cameras.length > 0 && cameras.every(c => liveCameras.has(c.id)) ? "■ Alle stoppen" : "▶ Alle streamen"}
            </button>
            {isFullscreen ? (
              <button type="button" onClick={leaveFullscreen} className="touch-manipulation rounded-xl bg-indigo-600 px-3 py-2.5 text-xs font-semibold text-white hover:bg-indigo-500 sm:py-2">Vollbild verlassen</button>
            ) : (
              <button type="button" onClick={enterMonitorMode} className="touch-manipulation rounded-xl bg-indigo-600 px-3 py-2.5 text-xs font-semibold text-white hover:bg-indigo-500 sm:py-2">▣ <span className="sm:hidden">Monitor</span><span className="hidden sm:inline">Überwachungsmodus</span></button>
            )}
            <Link href="/" className="col-span-2 touch-manipulation rounded-xl border border-white/10 px-3 py-2.5 text-center text-xs font-semibold text-slate-300 hover:bg-white/5 sm:py-2">Zum Scanner</Link>
          </div>
        </div>
        {cameras.some((camera) => camera.credentials) ? (
          <p className="mt-3 text-[11px] text-amber-200/70">Zugangsdaten werden ausschließlich lokal auf diesem ONVIFscanner-Server gespeichert.</p>
        ) : null}
      </div>

      {isFullscreen ? (
        <button type="button" onClick={() => setControlsVisible((value) => !value)} className={`fixed right-3 top-3 z-50 rounded-full border border-white/10 bg-black/60 px-3 py-2 text-xs text-white backdrop-blur-md transition-opacity ${controlsVisible ? "opacity-100" : "opacity-0 hover:opacity-100 focus:opacity-100"}`}>
          {controlsVisible ? "Bedienung ausblenden" : "Bedienung"}
        </button>
      ) : null}

      {!cameras.length ? (
        <div className="flex min-h-[55vh] flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.02] px-6 text-center">
          <div className="mb-4 text-5xl">▦</div>
          <h2 className="text-xl font-semibold text-white">Noch keine Kamera gespeichert</h2>
          <p className="mt-2 max-w-md text-sm text-slate-400">Starte einen Scan und speichere einzelne Kameras oder die gesamte Ergebnisliste für diese Wall.</p>
          <Link href="/" className="mt-5 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500">Scanner öffnen</Link>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {Object.entries(
            cameras.reduce((acc, camera) => {
              const g = camera.group?.trim() || "Ungruppiert";
              if (!acc[g]) acc[g] = [];
              acc[g].push(camera);
              return acc;
            }, {} as Record<string, WallCamera[]>)
          ).sort((a, b) => a[0] === "Ungruppiert" ? 1 : b[0] === "Ungruppiert" ? -1 : a[0].localeCompare(b[0])).map(([groupName, groupCameras]) => (
            <div key={groupName} className="flex flex-col gap-3">
              {groupName !== "Ungruppiert" && (
                <h2 className="px-2 text-lg font-semibold text-white/90 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-indigo-500"></div>
                  {groupName}
                </h2>
              )}
              <div className="wall-grid" style={{ "--wall-columns": columns, "--wall-columns-mobile": mobileColumns } as CSSProperties}>
                {groupCameras.map((camera) => {
                  const index = cameras.findIndex(c => c.id === camera.id);
            const image = images[camera.id];
            const isLive = liveCameras.has(camera.id);
            const isOffline = camera.status && camera.status.isOnline === false;
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
                className={`group overflow-hidden transition-all flex flex-col justify-center ${
                  expandedCameraId === camera.id 
                    ? 'fixed inset-0 z-[99999] bg-black' 
                    : `relative rounded-2xl border bg-black shadow-2xl ${isOffline ? 'border-red-500 ring-2 ring-red-500/50 shadow-[0_0_15px_rgba(239,68,68,0.3)]' : isLive ? 'border-sky-500 ring-2 ring-sky-500/50 shadow-[0_0_15px_rgba(14,165,233,0.3)]' : 'border-white/10'} ${dragOverIndex === index ? 'opacity-50 scale-105 border-indigo-500' : ''}`
                }`}
              >
                <div 
                  onClick={() => {
                    const now = Date.now();
                    const last = lastClickRef.current;
                    if (last.id === camera.id && now - last.time < 350) {
                      // Double click detected!
                      setExpandedCameraId(expandedCameraId === camera.id ? null : camera.id);
                      lastClickRef.current = { id: "", time: 0 };
                    } else {
                      lastClickRef.current = { id: camera.id, time: now };
                    }
                  }}
                  className={`flex flex-col justify-center bg-slate-900 relative cursor-grab active:cursor-grabbing ${expandedCameraId === camera.id ? 'w-full h-full' : 'flex-1 w-full aspect-video'}`}
                >
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedCameraId(expandedCameraId === camera.id ? null : camera.id);
                    }}
                    className={`absolute top-2 right-2 z-10 p-2 rounded-lg bg-black/60 text-white backdrop-blur-md transition-all hover:bg-black/80 hover:scale-110 ${expandedCameraId === camera.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                    title={expandedCameraId === camera.id ? "Vollbild schließen" : "Vollbild öffnen"}
                  >
                    {expandedCameraId === camera.id ? (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20H5v-4m14-5v4h-4M5 9V5h4m5-4h4v4" /></svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
                    )}
                  </button>
                  {isLive ? (
                     <iframe 
                        src={livePlaybackUrls[camera.id]}
                        title={`Live-Stream ${camera.name}`}
                        className={`w-full h-full border-0 pointer-events-none ${expandedCameraId === camera.id ? 'object-contain' : 'object-cover'}`}
                        allow="autoplay; fullscreen"
                     />
                  ) : image?.src ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={image.src} alt={camera.name} className={`w-full h-full block transition-all duration-500 ${expandedCameraId === camera.id ? 'object-contain' : 'object-cover'} ${
                        image.state === "error" ? "opacity-30 grayscale" : 
                        (image.state === "loading" && !isLive) ? "opacity-60 contrast-75 saturate-50" : ""
                      }`} />
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

                  {image?.src && camera.overlayPosition && (
                    <div className={`absolute m-3 px-2.5 py-1 text-xs font-bold text-white bg-black/60 rounded-md backdrop-blur-md border border-white/10 shadow-lg
                      ${camera.overlayPosition === "top-left" ? "top-0 left-0" : ""}
                      ${camera.overlayPosition === "top-right" ? "top-0 right-0" : ""}
                      ${camera.overlayPosition === "bottom-left" ? "bottom-0 left-0" : ""}
                      ${camera.overlayPosition === "bottom-right" ? "bottom-0 right-0" : ""}
                    `}>
                      {camera.name}
                      {isOffline ? <span className="ml-2 inline-block rounded bg-red-500 px-1 text-[9px] uppercase tracking-wider">Offline</span> : null}
                      {isLive && !isOffline ? <span className="ml-2 inline-block w-2 h-2 rounded-full bg-sky-400 animate-pulse"></span> : null}
                    </div>
                  )}
                </div>

                {!isFullscreen || controlsVisible ? (
                  <div className="bg-slate-950 p-2 sm:p-3 flex items-center justify-between border-t border-white/10">
                    <div className="min-w-0">
                      <button type="button" disabled={liveLoading.has(camera.id)} onClick={() => void toggleLive(camera.id)} className={`touch-manipulation rounded px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:cursor-wait disabled:opacity-60 ${isLive ? 'bg-sky-500 text-white shadow-[0_0_10px_rgba(14,165,233,0.4)]' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`} title="Live-Stream an/aus">
                        <span className="sm:hidden">{liveLoading.has(camera.id) ? "…" : isLive ? "■" : "▶"}</span>
                        <span className="hidden sm:inline">{liveLoading.has(camera.id) ? "Wird vorbereitet…" : isLive ? "■ Stop" : "▶ Live"}</span>
                      </button>
                      {liveErrors[camera.id] ? <div className="mt-1 max-w-72 truncate text-[10px] text-red-300" title={liveErrors[camera.id]}>{liveErrors[camera.id]}</div> : null}
                    </div>
                    <div className="flex gap-1">
                      <button type="button" onClick={() => openEditor(camera)} className="touch-manipulation rounded bg-indigo-900/50 px-2.5 py-1.5 text-xs text-indigo-200 hover:bg-indigo-900/80" title="Kamera bearbeiten">✎</button>
                      <button type="button" disabled={index === 0} onClick={() => moveCamera(index, -1)} className="touch-manipulation rounded bg-white/5 px-2.5 py-1.5 text-xs text-white hover:bg-white/10 disabled:opacity-30" title="Nach vorne">←</button>
                      <button type="button" disabled={index === cameras.length - 1} onClick={() => moveCamera(index, 1)} className="touch-manipulation rounded bg-white/5 px-2.5 py-1.5 text-xs text-white hover:bg-white/10 disabled:opacity-30" title="Nach hinten">→</button>
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm(`Möchtest du "${camera.name}" wirklich von der Wall entfernen?`)) {
                            removeCamera(camera.id);
                          }
                        }}
                        className="touch-manipulation rounded bg-red-900/40 px-2.5 py-1.5 text-xs text-red-300 hover:bg-red-900/70"
                        title="Kamera von der Wall entfernen"
                      >
                        ✕
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

      {editingCameraId && editDraft ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="camera-edit-title" onMouseDown={(event) => { if (event.target === event.currentTarget) closeEditor(); }}>
          <form onSubmit={(event) => { event.preventDefault(); saveCameraDetails(); }} className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/15 bg-slate-950 p-5 shadow-2xl sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="camera-edit-title" className="text-xl font-bold text-white">Kamera bearbeiten</h2>
                <p className="mt-1 font-mono text-xs text-slate-400">{cameras.find((camera) => camera.id === editingCameraId)?.ip}</p>
              </div>
              <button type="button" onClick={closeEditor} className="rounded-lg border border-white/10 px-2.5 py-1.5 text-sm text-slate-300 hover:bg-white/5" aria-label="Schließen">×</button>
            </div>

            <div className="mt-5 grid gap-4">
              <label className="grid gap-1.5">
                <span className="text-xs font-semibold text-slate-300">Anzeigename</span>
                <input value={editDraft.name} onChange={(event) => setEditDraft({ ...editDraft, name: event.target.value })} className="glass-input rounded-lg px-3 py-2 text-sm outline-none" />
              </label>

              <label className="grid gap-1.5">
                <span className="text-xs font-semibold text-slate-300">Snapshot-URLs <span className="font-normal text-slate-500">(erste funktionierende URL wird verwendet)</span></span>
                <textarea value={editDraft.snapshotUris} onChange={(event) => setEditDraft({ ...editDraft, snapshotUris: event.target.value })} rows={3} spellCheck={false} className="glass-input resize-y rounded-lg px-3 py-2 font-mono text-xs outline-none" placeholder="http://192.168.1.10/snapshot.jpg" />
              </label>

              {images[editingCameraId]?.sourceUri ? (
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 flex flex-col gap-2">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-300">Aktuell verwendete Bild-URL</div>
                    <div className="mt-1 break-all font-mono text-xs text-slate-300">{images[editingCameraId].sourceUri}</div>
                  </div>
                  {images[editingCameraId]?.src && (
                    <div className="relative mt-1 aspect-video w-full overflow-hidden rounded-md border border-black/50 bg-black shadow-inner">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={images[editingCameraId].src} alt="Vorschau" className="h-full w-full object-cover" />
                    </div>
                  )}
                </div>
              ) : null}

              <label className="grid gap-1.5">
                <span className="text-xs font-semibold text-slate-300">Stream-URLs <span className="font-normal text-slate-500">(eine URL pro Zeile)</span></span>
                <textarea value={editDraft.streamUris} onChange={(event) => setEditDraft({ ...editDraft, streamUris: event.target.value })} rows={3} spellCheck={false} className="glass-input resize-y rounded-lg px-3 py-2 font-mono text-xs outline-none" placeholder="rtsp://192.168.1.10/stream" />
              </label>

              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <div className="mb-3">
                  <div className="text-xs font-semibold text-slate-200">Zugangsdaten</div>
                  <div className="mt-0.5 text-[11px] text-amber-200/70">Werden ausschließlich lokal auf diesem ONVIFscanner-Server abgelegt.</div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1.5">
                    <span className="text-xs text-slate-400">Benutzername</span>
                    <input value={editDraft.username} onChange={(event) => setEditDraft({ ...editDraft, username: event.target.value })} autoComplete="username" className="glass-input rounded-lg px-3 py-2 text-sm outline-none" />
                  </label>
                  <label className="grid gap-1.5">
                    <span className="text-xs text-slate-400">Passwort</span>
                    <div className="flex rounded-lg border border-white/10 bg-white/5 focus-within:border-indigo-500/50">
                      <input type={showPassword ? "text" : "password"} value={editDraft.password} onChange={(event) => setEditDraft({ ...editDraft, password: event.target.value })} autoComplete="current-password" className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-white outline-none" />
                      <button type="button" onClick={() => setShowPassword((value) => !value)} className="px-3 text-[11px] font-semibold text-indigo-300 hover:text-white">{showPassword ? "Verbergen" : "Anzeigen"}</button>
                    </div>
                                    </label>
                  <label className="grid gap-1.5">
                    <span className="text-xs text-slate-400">Gruppe (z. B. Garten, Haus)</span>
                    <input value={editDraft.group} onChange={(event) => setEditDraft({ ...editDraft, group: event.target.value })} className="glass-input rounded-lg px-3 py-2 text-sm outline-none" />
                  </label>
                </div>
              </div>

              <label className="grid gap-1.5 mt-2">
                <span className="text-xs font-semibold text-slate-300">Name im Bild anzeigen (Overlay)</span>
                <select 
                  value={editDraft.overlayPosition} 
                  onChange={(event) => setEditDraft({ ...editDraft, overlayPosition: event.target.value as CameraEditDraft["overlayPosition"] })} 
                  className="glass-input rounded-lg px-3 py-2 text-sm outline-none bg-slate-900"
                >
                  <option value="top-left">Oben Links</option>
                  <option value="top-right">Oben Rechts</option>
                  <option value="bottom-left">Unten Links</option>
                  <option value="bottom-right">Unten Rechts</option>
                </select>
              </label>
            </div>

            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-t border-white/10 pt-4">
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Möchtest du die Kamera "${editDraft.name}" wirklich von der Wall entfernen?`)) {
                    removeCamera(editingCameraId);
                    closeEditor();
                  }
                }}
                className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm font-semibold text-red-300 hover:bg-red-500/20 active:scale-95 transition-all text-left sm:text-center"
              >
                🗑 Von der Wall entfernen
              </button>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <button type="button" onClick={closeEditor} className="rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-slate-300 hover:bg-white/5">Abbrechen</button>
                <button type="submit" className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500">Speichern & Bild testen</button>
              </div>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
