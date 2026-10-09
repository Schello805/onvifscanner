"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import {
  Video,
  Play,
  Download,
  Trash2,
  RefreshCw,
  HardDrive,
  Calendar,
  Clock,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Settings,
  Film,
  X,
  Maximize2,
  RotateCcw,
  RotateCw,
} from "lucide-react";
import { useToast } from "@/components/ToastProvider";

type CameraNvrItem = {
  id: string;
  name: string;
  ip: string;
  resolution?: string;
  isOnline: boolean;
  recordEnabled: boolean;
  recordSegmentMinutes: number;
  storageTargetId?: string | null;
  storageTarget?: {
    id: string;
    name: string;
    path: string;
  } | null;
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

type StorageTargetSimple = {
  id: string;
  name: string;
  path: string;
  isDefault: boolean;
};

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

export default function RecordingsPage() {
  const { toast } = useToast();
  const [cameras, setCameras] = useState<CameraNvrItem[]>([]);
  const [storageTargets, setStorageTargets] = useState<StorageTargetSimple[]>([]);
  const [clips, setClips] = useState<RecordingClip[]>([]);
  const [loadingClips, setLoadingClips] = useState(true);
  const [loadingCameras, setLoadingCameras] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filters
  const [selectedCameraId, setSelectedCameraId] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState<string>(getTodayStr());

  // Show camera settings accordion
  const [showCameraSettings, setShowCameraSettings] = useState(false);

  // Active Video Player Modal
  const [activeClip, setActiveClip] = useState<RecordingClip | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Notifications
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  const fetchCameras = async () => {
    try {
      setLoadingCameras(true);
      const res = await fetch("/api/nvr/cameras", { cache: "no-store" });
      const data = await res.json();
      if (data.cameras) {
        setCameras(data.cameras);
      }
    } catch {
      console.warn("Failed fetching NVR camera configs");
    } finally {
      setLoadingCameras(false);
    }
  };

  const fetchStorageTargets = async () => {
    try {
      const res = await fetch("/api/nvr/storage", { cache: "no-store" });
      const data = await res.json();
      if (data.targets) {
        setStorageTargets(data.targets);
      }
    } catch {}
  };

  const fetchClips = async (camId = selectedCameraId, date = selectedDate) => {
    try {
      setRefreshing(true);
      const params = new URLSearchParams();
      if (camId) params.set("cameraId", camId);
      if (date) params.set("date", date);

      const res = await fetch(`/api/nvr/recordings?${params.toString()}`, { cache: "no-store" });
      const data = await res.json();
      if (data.clips) {
        setClips(data.clips);
      }
    } catch {
      setMessage({ type: "error", text: "Fehler beim Laden der Aufnahmen." });
    } finally {
      setLoadingClips(false);
      setRefreshing(false);
    }
  };

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
    fetchStorageTargets();
    fetchClips(initialCamId, getTodayStr());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleToggleRecord = async (cam: CameraNvrItem) => {
    const nextState = !cam.recordEnabled;
    try {
      setMessage({ type: "ok", text: `Aktualisiere Aufnahme für ${cam.name}...` });
      const res = await fetch("/api/nvr/cameras", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: cam.id, recordEnabled: nextState }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Fehler beim Umschalten");

      setCameras((prev) =>
        prev.map((c) => (c.id === cam.id ? { ...c, recordEnabled: nextState } : c))
      );
      setMessage({
        type: "ok",
        text: nextState
          ? `🔴 Daueraufnahme für "${cam.name}" gestartet.`
          : `Aufnahme für "${cam.name}" gestoppt.`,
      });
    } catch (err: any) {
      setMessage({ type: "error", text: err.message || "Fehler beim Umschalten." });
    }
  };

  const handleUpdateCameraStorage = async (cameraId: string, storageTargetId: string) => {
    try {
      const res = await fetch("/api/nvr/cameras", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: cameraId, storageTargetId: storageTargetId || null }),
      });
      if (res.ok) {
        setMessage({ type: "ok", text: "Speichermedium für Kamera zugewiesen." });
        fetchCameras();
      }
    } catch {
      setMessage({ type: "error", text: "Fehler beim Zuweisen des Speichers." });
    }
  };

  const handleUpdateCameraSegment = async (cameraId: string, minutes: number) => {
    try {
      const res = await fetch("/api/nvr/cameras", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: cameraId, recordSegmentMinutes: minutes }),
      });
      if (res.ok) {
        setMessage({ type: "ok", text: "Segmentdauer aktualisiert." });
        fetchCameras();
      }
    } catch {
      setMessage({ type: "error", text: "Fehler beim Aktualisieren der Segmentdauer." });
    }
  };

  const handleDeleteClip = async (clip: RecordingClip) => {
    if (!confirm(`Möchtest du diese Aufnahme (${clip.filename}) wirklich löschen?`)) {
      return;
    }
    try {
      const res = await fetch(`/api/nvr/recordings?clipId=${encodeURIComponent(clip.id)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        toast.success(`Aufnahme ${clip.filename} gelöscht.`);
        setClips((prev) => prev.filter((c) => c.id !== clip.id));
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

  const seekRelative = (seconds: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime + seconds);
    }
  };

  const recordingCount = cameras.filter((c) => c.recordEnabled).length;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
            <Film className="h-7 w-7 text-rose-500" />
            NVR Aufnahmen & Player
          </h1>
          <p className="text-sm text-slate-400">
            Wiedergabe aufgezeichneter Videoclips, Kamera-Aufnahmesteuerung und Speichereinstellungen.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/nvr/storage"
            className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3.5 py-2 text-sm font-medium text-cyan-200 hover:bg-cyan-500/20 active:scale-95 transition-all"
          >
            <HardDrive className="h-4 w-4" />
            Speichermedien ({storageTargets.length})
          </Link>

          <button
            onClick={() => {
              fetchCameras();
              fetchClips(selectedCameraId, selectedDate);
            }}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800 active:scale-95 transition-all"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            Aktualisieren
          </button>
        </div>
      </div>

      {/* Action Notification */}
      {message && (
        <div
          className={`rounded-xl border p-4 flex items-center justify-between transition-all ${
            message.type === "ok"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : "border-rose-500/30 bg-rose-500/10 text-rose-300"
          }`}
        >
          <div className="flex items-center gap-2.5">
            {message.type === "ok" ? (
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
            ) : (
              <AlertTriangle className="h-5 w-5 shrink-0 text-rose-400" />
            )}
            <span className="text-sm font-medium">{message.text}</span>
          </div>
          <button onClick={() => setMessage(null)} className="text-xs opacity-70 hover:opacity-100">
            Schließen
          </button>
        </div>
      )}

      {/* Accordion: Camera Recording Controls */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 shadow-lg overflow-hidden">
        <button
          onClick={() => setShowCameraSettings(!showCameraSettings)}
          className="w-full flex items-center justify-between p-4 text-left hover:bg-slate-800/40 transition-colors"
        >
          <div className="flex items-center gap-3">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/20">
              <Video className="h-4 w-4" />
            </span>
            <div>
              <div className="text-sm font-semibold text-white flex items-center gap-2">
                Kamera-Aufnahmesteuerung (🔴 REC)
                {recordingCount > 0 ? (
                  <span className="rounded-full bg-rose-500/20 px-2 py-0.5 text-[11px] font-semibold text-rose-300 border border-rose-500/30 flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse"></span>
                    {recordingCount} Kamera(s) aktiv
                  </span>
                ) : (
                  <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-400">
                    Keine Aufnahme aktiv
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400">
                Schalte Daueraufnahme für einzelne Kameras ein/aus und wähle Ziel-Speichermedien.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-slate-400 text-xs">
            <span>{showCameraSettings ? "Einklappen" : "Ausklappen"}</span>
            {showCameraSettings ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </div>
        </button>

        {showCameraSettings && (
          <div className="border-t border-slate-800/80 p-4 space-y-3 bg-slate-950/40">
            {cameras.length === 0 ? (
              <p className="text-xs text-slate-400">Keine gespeicherten Kameras vorhanden.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {cameras.map((cam) => (
                  <div
                    key={cam.id}
                    className="flex flex-col justify-between rounded-xl border border-slate-800/80 bg-slate-900/90 p-3.5 space-y-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-bold text-white truncate">{cam.name}</h4>
                          <span
                            className={`h-2 w-2 rounded-full ${
                              cam.isOnline ? "bg-emerald-400" : "bg-slate-600"
                            }`}
                            title={cam.isOnline ? "Kamera erreichbar" : "Kamera offline"}
                          />
                        </div>
                        <div className="flex items-center gap-2 text-xs font-mono text-slate-400 mt-0.5">
                          <span>{cam.ip}</span>
                          {cam.resolution && (
                            <span className="rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-1.5 py-0.5 text-[10px] font-sans">
                              📷 {cam.resolution}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Record Toggle Button */}
                      <button
                        onClick={() => handleToggleRecord(cam)}
                        className={`touch-manipulation inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold shadow-md active:scale-95 transition-all ${
                          cam.recordEnabled
                            ? "bg-rose-600 text-white shadow-rose-950 hover:bg-rose-500 animate-pulse"
                            : "border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
                        }`}
                      >
                        <span
                          className={`h-2 w-2 rounded-full ${
                            cam.recordEnabled ? "bg-white" : "bg-rose-500"
                          }`}
                        />
                        {cam.recordEnabled ? "🔴 REC Aktiv" : "Aufnahme Start"}
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-slate-800/60">
                      <div>
                        <label className="text-[10px] text-slate-500 block mb-1">Ziel-Speicher</label>
                        <select
                          value={cam.storageTargetId || ""}
                          onChange={(e) => handleUpdateCameraStorage(cam.id, e.target.value)}
                          className="w-full rounded border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-slate-200 focus:outline-none"
                        >
                          <option value="">Standard-Speicher</option>
                          {storageTargets.map((st) => (
                            <option key={st.id} value={st.id}>
                              {st.name} {st.isDefault ? "(Standard)" : ""}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="text-[10px] text-slate-500 block mb-1">Segmentlänge</label>
                        <select
                          value={cam.recordSegmentMinutes || 15}
                          onChange={(e) => handleUpdateCameraSegment(cam.id, Number(e.target.value))}
                          className="w-full rounded border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-slate-200 focus:outline-none"
                        >
                          <option value="5">5 Minuten</option>
                          <option value="15">15 Minuten</option>
                          <option value="30">30 Minuten</option>
                          <option value="60">60 Minuten</option>
                        </select>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Filter Toolbar */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-lg flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Camera Filter */}
          <div className="flex items-center gap-1.5">
            <Video className="h-4 w-4 text-slate-400" />
            <select
              value={selectedCameraId}
              onChange={(e) => {
                setSelectedCameraId(e.target.value);
                fetchClips(e.target.value, selectedDate);
              }}
              className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs text-white focus:border-cyan-500 focus:outline-none"
            >
              <option value="">Alle Kameras</option>
              {cameras.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.ip})
                </option>
              ))}
            </select>
          </div>

          {/* Date Filter */}
          <div className="flex items-center gap-1.5">
            <Calendar className="h-4 w-4 text-slate-400" />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => {
                setSelectedDate(e.target.value);
                fetchClips(selectedCameraId, e.target.value);
              }}
              className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs text-white focus:border-cyan-500 focus:outline-none"
            />
          </div>

          {/* Quick Date Buttons */}
          <button
            onClick={() => {
              setSelectedDate(getTodayStr());
              fetchClips(selectedCameraId, getTodayStr());
            }}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all ${
              selectedDate === getTodayStr()
                ? "bg-slate-700 text-white"
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
            className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all ${
              selectedDate === getYesterdayStr()
                ? "bg-slate-700 text-white"
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
            className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all ${
              selectedDate === ""
                ? "bg-slate-700 text-white"
                : "border border-slate-800 bg-slate-950 text-slate-400 hover:text-white"
            }`}
          >
            Alle Tage
          </button>
        </div>

        <div className="text-xs text-slate-400">
          Gefundene Segmente: <strong className="text-white">{clips.length}</strong>
        </div>
      </div>

      {/* Video Player Modal */}
      {activeClip && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-md">
          <div className="relative w-full max-w-4xl rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl overflow-hidden flex flex-col">
            {/* Player Header */}
            <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-900/60">
              <div className="min-w-0 pr-4">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-rose-500 animate-pulse"></span>
                  <h3 className="text-sm font-bold text-white truncate">{activeClip.cameraName}</h3>
                  <span className="rounded bg-slate-800 px-2 py-0.5 text-[11px] font-mono text-slate-300">
                    {activeClip.timeStr} Uhr
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5 truncate">
                  Datum: {activeClip.dateStr} · Größe: {formatBytes(activeClip.sizeBytes)} · Speicher:{" "}
                  {activeClip.storageTargetName}
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
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
                  title="Schließen"
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
                className="w-full h-full max-h-[70vh] object-contain"
              />
            </div>

            {/* Quick Seek Toolbar */}
            <div className="p-3 border-t border-slate-800/80 bg-slate-900/50 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => seekRelative(-10)}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> -10s
                </button>
                <button
                  onClick={() => seekRelative(10)}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
                >
                  <RotateCw className="h-3.5 w-3.5" /> +10s
                </button>
              </div>

              <button
                onClick={() => handleDeleteClip(activeClip)}
                className="inline-flex items-center gap-1 rounded-lg border border-rose-900/50 bg-rose-950/30 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-900/50 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" /> Diese Aufnahme löschen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clips Grid / List */}
      {loadingClips ? (
        <div className="flex flex-col items-center justify-center p-16 text-slate-400">
          <RefreshCw className="h-8 w-8 animate-spin text-rose-500 mb-3" />
          <p className="text-sm">Lade Aufnahmesegmente...</p>
        </div>
      ) : clips.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-950/40 p-16 text-center">
          <Film className="mx-auto h-12 w-12 text-slate-600 mb-3" />
          <h3 className="text-base font-semibold text-white">Keine Aufnahmen für diesen Zeitraum</h3>
          <p className="text-sm text-slate-400 mt-1 max-w-md mx-auto">
            {recordingCount === 0
              ? "Aktuell ist für keine Kamera die Daueraufnahme aktiviert. Klappe oben die Kamera-Aufnahmesteuerung auf und aktiviere '🔴 REC'."
              : "Für das gewählte Datum wurden keine Clips gefunden. Wähle ein anderes Datum oder 'Alle Tage'."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {clips.map((clip) => (
            <div
              key={clip.id}
              className="group relative flex flex-col justify-between rounded-xl border border-slate-800/80 bg-slate-900/80 p-4 shadow-md hover:border-slate-700 transition-all"
            >
              <div>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <h4 className="text-sm font-bold text-white truncate">{clip.cameraName}</h4>
                    <span className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                      <Clock className="h-3 w-3 text-slate-500" />
                      {clip.dateStr} um {clip.timeStr} Uhr
                    </span>
                  </div>
                  <span className="shrink-0 rounded bg-slate-800/90 px-2 py-0.5 text-[10px] font-mono text-slate-300">
                    {formatBytes(clip.sizeBytes)}
                  </span>
                </div>

                <div className="rounded-lg bg-slate-950/60 p-2.5 my-2 border border-slate-800/60 text-xs text-slate-400 flex items-center justify-between">
                  <span className="truncate text-[11px]">Speicher: {clip.storageTargetName}</span>
                  <span className="text-[10px] text-slate-500 font-mono truncate max-w-[120px]">
                    {clip.filename}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-800/80 mt-2">
                <button
                  onClick={() => setActiveClip(clip)}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-rose-600/90 hover:bg-rose-500 text-white px-3 py-1.5 text-xs font-semibold shadow-md active:scale-95 transition-all"
                >
                  <Play className="h-3.5 w-3.5 fill-current" />
                  Abspielen
                </button>

                <a
                  href={clip.downloadUrl}
                  className="rounded-lg border border-slate-800 bg-slate-950 p-2 text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                  title="Herunterladen"
                >
                  <Download className="h-4 w-4" />
                </a>

                <button
                  onClick={() => handleDeleteClip(clip)}
                  className="rounded-lg border border-slate-800 bg-slate-950 p-2 text-slate-400 hover:text-rose-400 hover:bg-rose-950/30 transition-colors"
                  title="Löschen"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
