"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { readWallCameras, writeWallCameras, type WallCamera } from "@/lib/cameraWall";

type CameraImageState = {
  src?: string;
  state: "idle" | "loading" | "ok" | "error";
  message?: string;
  updatedAt?: Date;
};

function apiUrl(path: string): string {
  return new URL(path, window.location.origin).toString();
}

export default function CameraWallPage() {
  const [cameras, setCameras] = useState<WallCamera[]>([]);
  const [images, setImages] = useState<Record<string, CameraImageState>>({});
  const [columns, setColumns] = useState(3);
  const [refreshSeconds, setRefreshSeconds] = useState(10);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const wallRef = useRef<HTMLDivElement>(null);
  const objectUrlsRef = useRef<Record<string, string>>({});
  const runningRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const objectUrls = objectUrlsRef.current;
    setCameras(readWallCameras());
    const rawColumns = window.localStorage.getItem("onvifscanner.wall.columns");
    const rawRefresh = window.localStorage.getItem("onvifscanner.wall.refresh");
    const storedColumns = rawColumns === null ? Number.NaN : Number(rawColumns);
    const storedRefresh = rawRefresh === null ? Number.NaN : Number(rawRefresh);
    if (storedColumns >= 1 && storedColumns <= 6) setColumns(storedColumns);
    if ([0, 5, 10, 30, 60].includes(storedRefresh)) setRefreshSeconds(storedRefresh);

    const sync = () => setCameras(readWallCameras());
    window.addEventListener("storage", sync);
    window.addEventListener("onvifscanner:wall-updated", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("onvifscanner:wall-updated", sync);
      for (const src of Object.values(objectUrls)) URL.revokeObjectURL(src);
    };
  }, []);

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const loadCamera = useCallback(async (camera: WallCamera) => {
    if (!camera.snapshotUris.length || runningRef.current.has(camera.id)) return;
    runningRef.current.add(camera.id);
    setImages((current) => ({ ...current, [camera.id]: { ...current[camera.id], state: "loading" } }));

    try {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 8000);
      const response = await fetch(apiUrl("/api/thumbnail"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          urls: camera.snapshotUris.slice(0, 4),
          size: 512,
          timeoutMs: 3000,
          fastAuth: true,
          credentials: camera.credentials
        }),
        signal: controller.signal
      }).finally(() => window.clearTimeout(timer));

      const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
      if (!response.ok || contentType.includes("application/json")) {
        const detail = await response.json().catch(() => null);
        throw new Error(detail?.error ?? `Bild nicht verfügbar (HTTP ${response.status})`);
      }

      const blob = await response.blob();
      const src = URL.createObjectURL(blob);
      const previous = objectUrlsRef.current[camera.id];
      if (previous) URL.revokeObjectURL(previous);
      objectUrlsRef.current[camera.id] = src;
      setImages((current) => ({
        ...current,
        [camera.id]: { src, state: "ok", updatedAt: new Date() }
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

  const refreshAll = useCallback(() => {
    for (const camera of cameras) void loadCamera(camera);
  }, [cameras, loadCamera]);

  useEffect(() => {
    if (!cameras.length) return;
    refreshAll();
  }, [cameras, refreshAll]);

  useEffect(() => {
    if (refreshSeconds <= 0 || !cameras.length) return;
    const timer = window.setInterval(refreshAll, refreshSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [cameras.length, refreshAll, refreshSeconds]);

  function persist(next: WallCamera[]) {
    setCameras(next);
    writeWallCameras(next);
  }

  function changeColumns(value: number) {
    setColumns(value);
    window.localStorage.setItem("onvifscanner.wall.columns", String(value));
  }

  function changeRefresh(value: number) {
    setRefreshSeconds(value);
    window.localStorage.setItem("onvifscanner.wall.refresh", String(value));
  }

  function moveCamera(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= cameras.length) return;
    const next = [...cameras];
    [next[index], next[target]] = [next[target], next[index]];
    persist(next);
  }

  function saveName(id: string) {
    const value = editingName.trim();
    if (value) persist(cameras.map((camera) => camera.id === id ? { ...camera, name: value } : camera));
    setEditingId(null);
  }

  async function toggleFullscreen() {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await wallRef.current?.requestFullscreen();
    }
  }

  return (
    <div ref={wallRef} className="camera-wall min-h-[70vh] rounded-3xl bg-slate-950 p-4 sm:p-6">
      <div className={`mb-5 ${isFullscreen && !controlsVisible ? "hidden" : "block"}`}>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-white sm:text-3xl">Kamera-Wall</h1>
              <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-300">
                {cameras.length} Kameras
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-400">Gespeicherte Kameras als automatisch aktualisiertes Monitor-Dashboard.</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300">
              Spalten
              <select value={columns} onChange={(event) => changeColumns(Number(event.target.value))} className="bg-slate-900 text-white outline-none">
                {[1, 2, 3, 4, 5, 6].map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300">
              Aktualisieren
              <select value={refreshSeconds} onChange={(event) => changeRefresh(Number(event.target.value))} className="bg-slate-900 text-white outline-none">
                <option value={0}>Manuell</option>
                <option value={5}>5 Sek.</option>
                <option value={10}>10 Sek.</option>
                <option value={30}>30 Sek.</option>
                <option value={60}>60 Sek.</option>
              </select>
            </label>
            <button type="button" onClick={refreshAll} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10">↻ Jetzt laden</button>
            <button type="button" onClick={toggleFullscreen} className="rounded-xl bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-500">{isFullscreen ? "Vollbild verlassen" : "Vollbild"}</button>
            <Link href="/" className="rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-white/5">Zum Scanner</Link>
          </div>
        </div>
        {cameras.some((camera) => camera.credentials) ? (
          <p className="mt-3 text-[11px] text-amber-200/70">Zugangsdaten für geschützte Snapshots sind ausschließlich in diesem Browser gespeichert.</p>
        ) : null}
      </div>

      {isFullscreen ? (
        <button type="button" onClick={() => setControlsVisible((value) => !value)} className="fixed right-3 top-3 z-50 rounded-full border border-white/10 bg-black/60 px-3 py-2 text-xs text-white backdrop-blur-md">
          {controlsVisible ? "Bedienung ausblenden" : "Bedienung anzeigen"}
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
        <div className="wall-grid" style={{ "--wall-columns": columns } as CSSProperties}>
          {cameras.map((camera, index) => {
            const image = images[camera.id];
            return (
              <article key={camera.id} className="group relative overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl">
                <div className="aspect-video w-full bg-slate-900">
                  {image?.src ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={image.src} alt={camera.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-500">
                      <span className={image?.state === "loading" ? "animate-pulse text-2xl" : "text-2xl"}>◉</span>
                      <span className="px-4 text-center text-xs">{image?.state === "loading" ? "Bild wird geladen…" : image?.message ?? (camera.snapshotUris.length ? "Noch kein Bild" : "Keine Snapshot-URL")}</span>
                    </div>
                  )}
                </div>

                <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-black via-black/75 to-transparent px-3 pb-3 pt-10">
                  <div className="min-w-0">
                    {editingId === camera.id ? (
                      <form onSubmit={(event) => { event.preventDefault(); saveName(camera.id); }} className="flex gap-1">
                        <input autoFocus value={editingName} onChange={(event) => setEditingName(event.target.value)} onBlur={() => saveName(camera.id)} className="min-w-0 rounded bg-black/80 px-2 py-1 text-sm text-white outline-none ring-1 ring-indigo-400" />
                      </form>
                    ) : (
                      <button type="button" onClick={() => { setEditingId(camera.id); setEditingName(camera.name); }} className="block max-w-full truncate text-left text-sm font-bold text-white" title="Namen ändern">{camera.name}</button>
                    )}
                    <div className="truncate font-mono text-[11px] text-slate-300">{camera.ip}{camera.model ? ` · ${camera.model}` : ""}</div>
                    {image?.updatedAt ? <div className="text-[10px] text-slate-500">Stand {image.updatedAt.toLocaleTimeString("de-DE")}</div> : null}
                  </div>
                  <div className="flex shrink-0 gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                    <button type="button" disabled={index === 0} onClick={() => moveCamera(index, -1)} className="rounded bg-black/70 px-2 py-1 text-xs text-white disabled:opacity-30" title="Nach vorne">←</button>
                    <button type="button" disabled={index === cameras.length - 1} onClick={() => moveCamera(index, 1)} className="rounded bg-black/70 px-2 py-1 text-xs text-white disabled:opacity-30" title="Nach hinten">→</button>
                    <button type="button" onClick={() => persist(cameras.filter((item) => item.id !== camera.id))} className="rounded bg-red-950/80 px-2 py-1 text-xs text-red-200" title="Entfernen">×</button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
