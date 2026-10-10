"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import {
  Radio,
  Video,
  Film,
  HardDrive,
  RefreshCw,
  CheckSquare,
  Square,
  Search,
  CheckCheck,
  Trash2,
  Clock,
  Sparkles,
  SlidersHorizontal,
  ChevronRight,
  ExternalLink,
  ShieldCheck,
  AlertTriangle,
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

type StorageTargetSimple = {
  id: string;
  name: string;
  path: string;
  isDefault: boolean;
};

export default function RecordingsConfigPage() {
  const { toast } = useToast();
  const [cameras, setCameras] = useState<CameraNvrItem[]>([]);
  const [storageTargets, setStorageTargets] = useState<StorageTargetSimple[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState("");
  const [filterMode, setFilterMode] = useState<"all" | "active" | "inactive">("all");

  // Camera Multi-Selection
  const [selectedCamIds, setSelectedCamIds] = useState<Set<string>>(new Set());
  const [batchLoading, setBatchLoading] = useState(false);

  const fetchCameras = async () => {
    try {
      setRefreshing(true);
      const res = await fetch("/api/nvr/cameras", { cache: "no-store" });
      const data = await res.json();
      if (data.cameras) {
        setCameras(data.cameras);
      }
    } catch {
      toast.error("Fehler beim Laden der Kamera-Konfigurationen.");
    } finally {
      setLoading(false);
      setRefreshing(false);
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

  useEffect(() => {
    fetchCameras();
    fetchStorageTargets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Single Camera Toggle
  const handleToggleRecord = async (cam: CameraNvrItem) => {
    const nextState = !cam.recordEnabled;
    try {
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
      toast.success(
        nextState
          ? `🔴 Daueraufnahme für "${cam.name}" aktiviert.`
          : `Aufnahme für "${cam.name}" gestoppt.`
      );
    } catch (err: any) {
      toast.error(err.message || "Fehler beim Umschalten der Aufnahme.");
    }
  };

  // Batch Toggle Recording
  const handleBatchToggleRecord = async (enabled: boolean, forAll: boolean = false) => {
    const idsToUpdate = forAll ? cameras.map((c) => c.id) : Array.from(selectedCamIds);
    if (idsToUpdate.length === 0) return;

    setBatchLoading(true);
    try {
      const res = await fetch("/api/nvr/cameras", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: idsToUpdate,
          recordEnabled: enabled,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Fehler beim Aktualisieren");

      setCameras((prev) =>
        prev.map((c) => (idsToUpdate.includes(c.id) ? { ...c, recordEnabled: enabled } : c))
      );
      toast.success(
        enabled
          ? `🔴 Daueraufnahme für ${idsToUpdate.length} Kamera(s) aktiviert.`
          : `Aufnahme für ${idsToUpdate.length} Kamera(s) gestoppt.`
      );
    } catch (err: any) {
      toast.error(err.message || "Fehler bei der Aufnahmesteuerung.");
    } finally {
      setBatchLoading(false);
    }
  };

  // Batch Set Camera Storage
  const handleBatchSetCameraStorage = async (storageTargetId: string, forAll: boolean = false) => {
    const idsToUpdate = forAll ? cameras.map((c) => c.id) : Array.from(selectedCamIds);
    if (idsToUpdate.length === 0) return;

    setBatchLoading(true);
    try {
      const res = await fetch("/api/nvr/cameras", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: idsToUpdate,
          storageTargetId: storageTargetId || null,
        }),
      });
      if (res.ok) {
        toast.success(`Speicherziel für ${idsToUpdate.length} Kameras zugewiesen.`);
        fetchCameras();
      }
    } catch {
      toast.error("Fehler beim Zuweisen des Speichers.");
    } finally {
      setBatchLoading(false);
    }
  };

  // Batch Set Camera Segment Length
  const handleBatchSetCameraSegment = async (minutes: number, forAll: boolean = false) => {
    const idsToUpdate = forAll ? cameras.map((c) => c.id) : Array.from(selectedCamIds);
    if (idsToUpdate.length === 0) return;

    setBatchLoading(true);
    try {
      const res = await fetch("/api/nvr/cameras", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: idsToUpdate,
          recordSegmentMinutes: minutes,
        }),
      });
      if (res.ok) {
        toast.success(`Segmentdauer für ${idsToUpdate.length} Kameras auf ${minutes} Min. gesetzt.`);
        fetchCameras();
      }
    } catch {
      toast.error("Fehler beim Setzen der Segmentdauer.");
    } finally {
      setBatchLoading(false);
    }
  };

  // Delete All Recordings of Specific Camera(s)
  const handleDeleteCameraClips = async (cameraIdsToDelete: string[]) => {
    if (cameraIdsToDelete.length === 0) return;
    const names = cameras
      .filter((c) => cameraIdsToDelete.includes(c.id))
      .map((c) => c.name)
      .join(", ");

    const confirmMsg =
      cameraIdsToDelete.length === cameras.length
        ? "Möchtest du wirklich ALLE Aufnahmen von ALLEN Kameras unwiderruflich von der Festplatte löschen?"
        : `Möchtest du wirklich alle Aufnahmen der Kamera(s) "${names}" unwiderruflich löschen?`;

    if (!confirm(confirmMsg)) return;

    setBatchLoading(true);
    try {
      const res = await fetch("/api/nvr/recordings", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cameraIds: cameraIdsToDelete }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message || `Aufnahmen gelöscht.`);
      } else {
        throw new Error(data.error || "Löschen fehlgeschlagen");
      }
    } catch (err: any) {
      toast.error(err.message || "Fehler beim Löschen der Kamera-Aufnahmen.");
    } finally {
      setBatchLoading(false);
    }
  };

  const toggleSelectCam = (id: string) => {
    setSelectedCamIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllCams = () => {
    if (selectedCamIds.size >= filteredCameras.length && filteredCameras.length > 0) {
      setSelectedCamIds(new Set());
    } else {
      setSelectedCamIds(new Set(filteredCameras.map((c) => c.id)));
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
        toast.success("Speichermedium für Kamera zugewiesen.");
        fetchCameras();
      }
    } catch {
      toast.error("Fehler beim Zuweisen des Speichers.");
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
        toast.success(`Segmentdauer auf ${minutes} Min. gesetzt.`);
        fetchCameras();
      }
    } catch {
      toast.error("Fehler beim Aktualisieren der Segmentdauer.");
    }
  };

  // Filtered cameras
  const filteredCameras = useMemo(() => {
    let result = [...cameras];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (c) => c.name.toLowerCase().includes(q) || c.ip.toLowerCase().includes(q)
      );
    }
    if (filterMode === "active") {
      result = result.filter((c) => c.recordEnabled);
    } else if (filterMode === "inactive") {
      result = result.filter((c) => !c.recordEnabled);
    }
    return result;
  }, [cameras, searchQuery, filterMode]);

  const activeCount = cameras.filter((c) => c.recordEnabled).length;
  const defaultStorage = storageTargets.find((s) => s.isDefault) || storageTargets[0];

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2.5">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <Radio className="h-5 w-5 text-rose-500 animate-pulse" />
            Aufnahmen
          </h1>
          <span className="rounded-full bg-rose-500/10 border border-rose-500/30 px-2.5 py-0.5 text-xs font-semibold text-rose-300">
            {activeCount} von {cameras.length} aufnehmend
          </span>
        </div>

        {/* Hinweis zur neuen Steuerung auf Monitore */}
        <Link
          href="/monitore"
          className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-950/30 hover:bg-emerald-900/40 px-3 py-1.5 text-xs text-emerald-200 transition shadow-sm"
        >
          <span>💡 Jetzt direkt auf <strong>Monitore</strong> steuerbar</span>
          <span className="font-bold text-emerald-400">➔</span>
        </Link>

        <div className="flex items-center gap-2">
          <button
            onClick={() => handleBatchToggleRecord(true, true)}
            disabled={batchLoading}
            className="touch-manipulation inline-flex items-center gap-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white px-3 py-1.5 text-xs font-semibold shadow-sm active:scale-95 transition-all"
            title="Alle im System gespeicherten Kameras auf Daueraufnahme schalten"
          >
            <Radio className="h-3.5 w-3.5" />
            Alle aufnehmen
          </button>
          <button
            onClick={() => handleBatchToggleRecord(false, true)}
            disabled={batchLoading}
            className="touch-manipulation inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 text-xs font-medium transition-all"
            title="Alle aktiven Daueraufnahmen stoppen"
          >
            Alle stoppen
          </button>
          <Link
            href="/wiedergabe"
            className="touch-manipulation inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/20 active:scale-95 transition-all"
          >
            <Film className="h-3.5 w-3.5" />
            Wiedergabe ➔
          </Link>
          <Link
            href="/nvr/storage"
            className="touch-manipulation inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-200 hover:bg-cyan-500/20 active:scale-95 transition-all"
          >
            <HardDrive className="h-3.5 w-3.5" />
            Speicher
          </Link>
        </div>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-3 shadow-md space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            {/* Search Input */}
            <div className="relative min-w-[200px] sm:min-w-[240px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Kamera suchen..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-lg border border-slate-800 bg-slate-950 pl-8 pr-7 py-1.5 text-xs text-white placeholder-slate-500 focus:border-rose-500 focus:outline-none"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Filter Pills */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => setFilterMode("all")}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${
                  filterMode === "all"
                    ? "bg-slate-700 text-white font-semibold"
                    : "border border-slate-800 bg-slate-950 text-slate-400 hover:text-white"
                }`}
              >
                Alle ({cameras.length})
              </button>
              <button
                onClick={() => setFilterMode("active")}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${
                  filterMode === "active"
                    ? "bg-rose-600 text-white font-semibold"
                    : "border border-slate-800 bg-slate-950 text-slate-400 hover:text-white"
                }`}
              >
                🔴 Aktiv ({activeCount})
              </button>
              <button
                onClick={() => setFilterMode("inactive")}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${
                  filterMode === "inactive"
                    ? "bg-slate-700 text-white font-semibold"
                    : "border border-slate-800 bg-slate-950 text-slate-400 hover:text-white"
                }`}
              >
                Pausiert ({cameras.length - activeCount})
              </button>
            </div>
          </div>

          {/* Select All Checkbox */}
          <div className="flex items-center gap-2">
            <button
              onClick={toggleSelectAllCams}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-200 hover:text-white transition-colors"
            >
              {selectedCamIds.size > 0 && selectedCamIds.size >= filteredCameras.length ? (
                <>
                  <Square className="h-3.5 w-3.5 text-slate-400" />
                  <span>Auswahl aufheben</span>
                </>
              ) : (
                <>
                  <CheckSquare className="h-3.5 w-3.5 text-indigo-400" />
                  <span>Alle {filteredCameras.length} markieren</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Selected Cameras Action Bar */}
        {selectedCamIds.size > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-indigo-500/40 bg-indigo-950/30 p-3 text-xs text-indigo-200 animate-fadeIn">
            <div className="flex items-center gap-2 font-semibold">
              <CheckCheck className="h-4 w-4 text-indigo-400" />
              <span>Aktionen für {selectedCamIds.size} markierte Kamera(s):</span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => handleBatchToggleRecord(true, false)}
                disabled={batchLoading}
                className="inline-flex items-center gap-1 rounded bg-rose-600 hover:bg-rose-500 px-2.5 py-1 text-white font-semibold active:scale-95 transition-all shadow-sm"
              >
                🔴 Aufnahme starten
              </button>
              <button
                onClick={() => handleBatchToggleRecord(false, false)}
                disabled={batchLoading}
                className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-800 hover:bg-slate-700 px-2.5 py-1 text-slate-200 transition-all"
              >
                ⏹️ Aufnahme stoppen
              </button>

              <select
                onChange={(e) => {
                  if (e.target.value) handleBatchSetCameraStorage(e.target.value, false);
                }}
                defaultValue=""
                className="rounded border border-indigo-700/60 bg-slate-950 px-2 py-1 text-xs text-indigo-200 focus:outline-none"
              >
                <option value="" disabled>Speicher zuweisen...</option>
                {storageTargets.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.name} {st.isDefault ? "(Standard)" : ""}
                  </option>
                ))}
              </select>

              <select
                onChange={(e) => {
                  if (e.target.value) handleBatchSetCameraSegment(Number(e.target.value), false);
                }}
                defaultValue=""
                className="rounded border border-indigo-700/60 bg-slate-950 px-2 py-1 text-xs text-indigo-200 focus:outline-none"
              >
                <option value="" disabled>Segmentdauer setzen...</option>
                <option value="5">5 Minuten</option>
                <option value="15">15 Minuten</option>
                <option value="30">30 Minuten</option>
                <option value="60">60 Minuten</option>
              </select>

              <button
                onClick={() => handleDeleteCameraClips(Array.from(selectedCamIds))}
                disabled={batchLoading}
                className="inline-flex items-center gap-1 rounded border border-rose-900/60 bg-rose-950/60 hover:bg-rose-900 px-2.5 py-1 text-rose-300 transition-all"
                title="Löscht alle gespeicherten Aufnahmen der ausgewählten Kameras von der Festplatte"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Aufnahmen dieser Kameras löschen
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Camera Configuration Cards Grid */}
      {loading ? (
        <div className="flex flex-col items-center justify-center p-16 text-slate-400">
          <RefreshCw className="h-8 w-8 animate-spin text-rose-500 mb-3" />
          <p className="text-sm">Lade Kameras & Einstellungen...</p>
        </div>
      ) : filteredCameras.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-950/40 p-16 text-center">
          <Video className="mx-auto h-12 w-12 text-slate-600 mb-3" />
          <h3 className="text-base font-semibold text-white">Keine Kameras gefunden</h3>
          <p className="text-sm text-slate-400 mt-1 max-w-md mx-auto">
            {searchQuery
              ? `Keine Treffer für "${searchQuery}".`
              : "Es wurden noch keine Kameras angelegt. Führe einen Scan aus, um Kameras hinzuzufügen."}
          </p>
          <div className="mt-4">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500"
            >
              Zum Scanner
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredCameras.map((cam) => {
            const isSelected = selectedCamIds.has(cam.id);
            return (
              <div
                key={cam.id}
                className={`flex flex-col justify-between rounded-2xl border bg-slate-900/90 p-4 space-y-3.5 transition-all shadow-md ${
                  isSelected
                    ? "border-indigo-500/80 bg-indigo-950/15"
                    : cam.recordEnabled
                    ? "border-rose-500/70 ring-2 ring-rose-500/30 bg-gradient-to-b from-rose-950/25 via-slate-900 to-slate-950 shadow-[0_0_22px_rgba(244,63,94,0.2)]"
                    : "border-slate-800/80"
                }`}
              >
                {/* Header Row */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <button
                      onClick={() => toggleSelectCam(cam.id)}
                      className="mt-1 text-slate-400 hover:text-white shrink-0"
                      title="Kamera markieren"
                    >
                      {isSelected ? (
                        <CheckSquare className="h-4 w-4 text-indigo-400" />
                      ) : (
                        <Square className="h-4 w-4 text-slate-500" />
                      )}
                    </button>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm sm:text-base font-bold text-white truncate">{cam.name}</h3>
                        {cam.recordEnabled && (
                          <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-rose-500/25 border border-rose-500/50 px-2 py-0.5 text-[10px] font-bold text-rose-200 shadow-sm animate-pulse">
                            <span className="h-1.5 w-1.5 rounded-full bg-rose-500"></span>
                            REC
                          </span>
                        )}
                        <span
                          className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                            cam.isOnline ? "bg-emerald-400" : "bg-slate-600"
                          }`}
                          title={cam.isOnline ? "Kamera online" : "Kamera offline"}
                        />
                      </div>
                      <div className="flex items-center gap-2 text-xs font-mono text-slate-400 mt-0.5">
                        <span>{cam.ip}</span>
                        {cam.resolution && (
                          <span className="rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-1.5 py-0.2 text-[10px] font-sans">
                            {cam.resolution}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Big Record Toggle Button */}
                  <button
                    onClick={() => handleToggleRecord(cam)}
                    className={`touch-manipulation inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold shadow-md active:scale-95 transition-all shrink-0 ${
                      cam.recordEnabled
                        ? "bg-rose-600 text-white shadow-rose-950 hover:bg-rose-500 animate-pulse"
                        : "border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
                    }`}
                  >
                    <span
                      className={`h-2.5 w-2.5 rounded-full ${
                        cam.recordEnabled ? "bg-white" : "bg-rose-500"
                      }`}
                    />
                    {cam.recordEnabled ? "🔴 REC Aktiv" : "Aufnahme Start"}
                  </button>
                </div>

                {/* Settings Grid */}
                <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-800/80 text-xs">
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1 font-medium">
                      Ziel-Speichermedium
                    </label>
                    <select
                      value={cam.storageTargetId || ""}
                      onChange={(e) => handleUpdateCameraStorage(cam.id, e.target.value)}
                      className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-rose-500"
                    >
                      <option value="">Standard-Speicher</option>
                      {storageTargets.map((st) => {
                        const cleanName = st.name.replace(/\s*\(Standard\)\s*/gi, "").trim();
                        return (
                          <option key={st.id} value={st.id}>
                            {cleanName} {st.isDefault ? "(Standard)" : ""}
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1 font-medium">
                      Segmentlänge
                    </label>
                    <select
                      value={cam.recordSegmentMinutes || 15}
                      onChange={(e) => handleUpdateCameraSegment(cam.id, Number(e.target.value))}
                      className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-rose-500"
                    >
                      <option value="5">5 Minuten</option>
                      <option value="15">15 Minuten (Standard)</option>
                      <option value="30">30 Minuten</option>
                      <option value="60">60 Minuten</option>
                    </select>
                  </div>
                </div>

                {/* Footer Quick Links */}
                <div className="flex items-center justify-end pt-2 border-t border-slate-800/60 text-xs text-slate-400">
                  <button
                    onClick={() => handleDeleteCameraClips([cam.id])}
                    className="inline-flex items-center gap-1.5 text-slate-500 hover:text-rose-400 transition-colors"
                    title={`Alle Video-Aufnahmen von "${cam.name}" von der Festplatte löschen`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Archiv leeren</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
