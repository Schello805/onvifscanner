"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { readWallCameras, writeWallCameras, type WallCamera } from "@/lib/cameraWall";

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
};

function apiUrl(path: string): string {
  return new URL(path, window.location.origin).toString();
}

export default function CameraWallPage() {
  const [cameras, setCameras] = useState<WallCamera[]>([]);
  const [images, setImages] = useState<Record<string, CameraImageState>>({});
  const [columns, setColumns] = useState(3);
  const [refreshSeconds, setRefreshSeconds] = useState(10);
  const [editingCameraId, setEditingCameraId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<CameraEditDraft | null>(null);
  const [showPassword, setShowPassword] = useState(false);
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
    const onFullscreenChange = () => {
      const fullscreen = Boolean(document.fullscreenElement);
      setIsFullscreen(fullscreen);
      if (!fullscreen) setControlsVisible(true);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    if (!editingCameraId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeEditor();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [editingCameraId]);

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

  function openEditor(camera: WallCamera) {
    setEditingCameraId(camera.id);
    setEditDraft({
      name: camera.name,
      snapshotUris: camera.snapshotUris.join("\n"),
      streamUris: camera.streamUris.join("\n"),
      username: camera.credentials?.username ?? "",
      password: camera.credentials?.password ?? ""
    });
    setShowPassword(false);
  }

  function closeEditor() {
    setEditingCameraId(null);
    setEditDraft(null);
    setShowPassword(false);
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
        : undefined
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
            {isFullscreen ? (
              <button type="button" onClick={leaveFullscreen} className="rounded-xl bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-500">Vollbild verlassen</button>
            ) : (
              <button type="button" onClick={enterMonitorMode} className="rounded-xl bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-500">▣ Überwachungsmodus</button>
            )}
            <Link href="/" className="rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-white/5">Zum Scanner</Link>
          </div>
        </div>
        {cameras.some((camera) => camera.credentials) ? (
          <p className="mt-3 text-[11px] text-amber-200/70">Zugangsdaten für geschützte Snapshots sind ausschließlich in diesem Browser gespeichert.</p>
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
        <div className="wall-grid" style={{ "--wall-columns": columns } as CSSProperties}>
          {cameras.map((camera, index) => {
            const image = images[camera.id];
            return (
              <article key={camera.id} className="group relative overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl flex flex-col justify-center">
                <div className="flex-1 w-full flex flex-col justify-center bg-slate-900">
                  {image?.src ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={image.src} alt={camera.name} className="w-full h-auto block" />
                  ) : (
                    <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 text-slate-500">
                      <span className={image?.state === "loading" ? "animate-pulse text-2xl" : "text-2xl"}>◉</span>
                      <span className="px-4 text-center text-xs">{image?.state === "loading" ? "Bild wird geladen…" : image?.message ?? (camera.snapshotUris.length ? "Noch kein Bild" : "Keine Snapshot-URL")}</span>
                    </div>
                  )}
                </div>

                <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-black via-black/75 to-transparent px-3 pb-3 pt-10">
                  <div className="min-w-0">
                    <div className="block max-w-full truncate text-left text-sm font-bold text-white">{camera.name}</div>
                    <div className="truncate font-mono text-[11px] text-slate-300">{camera.ip}{camera.model ? ` · ${camera.model}` : ""}</div>
                    {image?.updatedAt ? <div className="text-[10px] text-slate-500">Stand {image.updatedAt.toLocaleTimeString("de-DE")}</div> : null}
                  </div>
                  {!isFullscreen || controlsVisible ? (
                    <div className="flex shrink-0 gap-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                      <button type="button" onClick={() => openEditor(camera)} className="rounded bg-indigo-950/90 px-2 py-1 text-xs text-indigo-100" title="Kamera bearbeiten">✎</button>
                      <button type="button" disabled={index === 0} onClick={() => moveCamera(index, -1)} className="rounded bg-black/70 px-2 py-1 text-xs text-white disabled:opacity-30" title="Nach vorne">←</button>
                      <button type="button" disabled={index === cameras.length - 1} onClick={() => moveCamera(index, 1)} className="rounded bg-black/70 px-2 py-1 text-xs text-white disabled:opacity-30" title="Nach hinten">→</button>
                      <button type="button" onClick={() => persist(cameras.filter((item) => item.id !== camera.id))} className="rounded bg-red-950/80 px-2 py-1 text-xs text-red-200" title="Entfernen">×</button>
                    </div>
                  ) : null}
                </div>
              </article>
            );
          })}
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
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-300">Aktuell verwendete Bild-URL</div>
                  <div className="mt-1 break-all font-mono text-xs text-slate-300">{images[editingCameraId].sourceUri}</div>
                </div>
              ) : null}

              <label className="grid gap-1.5">
                <span className="text-xs font-semibold text-slate-300">Stream-URLs <span className="font-normal text-slate-500">(eine URL pro Zeile)</span></span>
                <textarea value={editDraft.streamUris} onChange={(event) => setEditDraft({ ...editDraft, streamUris: event.target.value })} rows={3} spellCheck={false} className="glass-input resize-y rounded-lg px-3 py-2 font-mono text-xs outline-none" placeholder="rtsp://192.168.1.10/stream" />
              </label>

              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <div className="mb-3">
                  <div className="text-xs font-semibold text-slate-200">Zugangsdaten</div>
                  <div className="mt-0.5 text-[11px] text-amber-200/70">Werden ausschließlich im lokalen Speicher dieses Browsers abgelegt.</div>
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
                </div>
              </div>
            </div>

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={closeEditor} className="rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-slate-300 hover:bg-white/5">Abbrechen</button>
              <button type="submit" className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500">Speichern & Bild testen</button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
