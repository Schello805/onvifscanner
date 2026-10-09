"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  HardDrive,
  Plus,
  RefreshCw,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  FolderCheck,
  FolderPlus,
  Settings2,
  Database,
  ArrowLeft,
  Sparkles,
  ShieldCheck,
  Info,
} from "lucide-react";

type StorageTargetItem = {
  id: string;
  name: string;
  path: string;
  isDefault: boolean;
  enabled: boolean;
  maxDays: number;
  minFreeSpaceGb: number;
  assignedCamerasCount: number;
  createdAt: string;
  stats: {
    path: string;
    exists: boolean;
    writable: boolean;
    isOnline: boolean;
    totalBytes: number;
    freeBytes: number;
    usedBytes: number;
    usagePercent: number;
    recordingsCount: number;
    recordingsSizeBytes: number;
    error?: string;
  };
};

type DiscoveredVolume = {
  name: string;
  path: string;
  suggestedPath: string;
  totalBytes: number;
  freeBytes: number;
  isAlreadyConfigured: boolean;
};

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 GB";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1000) {
    return `${(gb / 1024).toFixed(2)} TB`;
  }
  return `${gb.toFixed(1)} GB`;
}

export default function StorageManagementPage() {
  const [targets, setTargets] = useState<StorageTargetItem[]>([]);
  const [discoveredVolumes, setDiscoveredVolumes] = useState<DiscoveredVolume[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalTab, setModalTab] = useState<"discovered" | "custom">("discovered");

  // Form State for new storage target
  const [newName, setNewName] = useState("");
  const [newPath, setNewPath] = useState("");
  const [newAutoCreate, setNewAutoCreate] = useState(true);
  const [newIsDefault, setNewIsDefault] = useState(false);
  const [newMaxDays, setNewMaxDays] = useState(14);
  const [newMinFreeGb, setNewMinFreeGb] = useState(10);
  const [testingPath, setTestingPath] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    exists: boolean;
    writable: boolean;
    totalBytes: number;
    freeBytes: number;
    error?: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Edit Modal State
  const [editingTarget, setEditingTarget] = useState<StorageTargetItem | null>(null);

  const fetchTargets = async () => {
    try {
      setRefreshing(true);
      const res = await fetch("/api/nvr/storage", { cache: "no-store" });
      const data = await res.json();
      if (data.targets) {
        setTargets(data.targets);
      }
    } catch (err: any) {
      setActionMessage({ type: "error", text: "Fehler beim Laden der Speicherziele." });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const fetchDiscoveredVolumes = async () => {
    try {
      const res = await fetch("/api/nvr/storage/discover", { cache: "no-store" });
      const data = await res.json();
      if (data.volumes) {
        setDiscoveredVolumes(data.volumes);
      }
    } catch {}
  };

  useEffect(() => {
    fetchTargets();
    fetchDiscoveredVolumes();
  }, []);

  const handleTestPath = async (pathToCheck: string) => {
    if (!pathToCheck.trim()) return;
    setTestingPath(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/nvr/storage/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: pathToCheck.trim(), autoCreate: newAutoCreate }),
      });
      const data = await res.json();
      setTestResult(data);
    } catch (err: any) {
      setTestResult({
        ok: false,
        exists: false,
        writable: false,
        totalBytes: 0,
        freeBytes: 0,
        error: "Netzwerkfehler beim Pfad-Test.",
      });
    } finally {
      setTestingPath(false);
    }
  };

  const handleAddTarget = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPath.trim()) return;
    setSubmitting(true);
    setActionMessage(null);
    try {
      const res = await fetch("/api/nvr/storage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          path: newPath.trim(),
          autoCreate: newAutoCreate,
          isDefault: newIsDefault,
          maxDays: newMaxDays,
          minFreeSpaceGb: newMinFreeGb,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Fehler beim Hinzufügen.");
      }
      setActionMessage({ type: "ok", text: data.message || "Speicherziel erfolgreich angebunden!" });
      setIsModalOpen(false);
      setNewName("");
      setNewPath("");
      setTestResult(null);
      await fetchTargets();
      await fetchDiscoveredVolumes();
    } catch (err: any) {
      setActionMessage({ type: "error", text: err.message || "Fehler beim Anbinden." });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSelectDiscovered = (vol: DiscoveredVolume) => {
    setNewName(vol.name);
    setNewPath(vol.suggestedPath);
    setModalTab("custom");
    handleTestPath(vol.suggestedPath);
  };

  const handleSetDefault = async (id: string) => {
    try {
      const res = await fetch("/api/nvr/storage", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, isDefault: true }),
      });
      if (res.ok) {
        setActionMessage({ type: "ok", text: "Standard-Speicherziel aktualisiert." });
        fetchTargets();
      }
    } catch {
      setActionMessage({ type: "error", text: "Fehler beim Aktualisieren." });
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Möchtest du das Speicherziel "${name}" wirklich entfernen? Bereits aufgezeichnete Dateien auf dem Laufwerk bleiben erhalten.`)) {
      return;
    }
    try {
      const res = await fetch(`/api/nvr/storage?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Fehler beim Löschen.");
      }
      setActionMessage({ type: "ok", text: "Speicherziel entfernt." });
      fetchTargets();
      fetchDiscoveredVolumes();
    } catch (err: any) {
      setActionMessage({ type: "error", text: err.message || "Fehler beim Löschen." });
    }
  };

  const handleTriggerCleanup = async (id: string) => {
    try {
      setActionMessage({ type: "ok", text: "Bereinigung läuft im Hintergrund..." });
      const res = await fetch("/api/nvr/storage/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId: id }),
      });
      const data = await res.json();
      if (data.ok && data.results && data.results[0]) {
        const r = data.results[0];
        setActionMessage({
          type: "ok",
          text: `Bereinigung abgeschlossen: ${r.deletedFiles} alte Segmente gelöscht (${formatBytes(r.freedBytes)} freigegeben).`,
        });
      } else {
        setActionMessage({ type: "ok", text: "Bereinigung beendet. Keine überfälligen Dateien gefunden." });
      }
      fetchTargets();
    } catch {
      setActionMessage({ type: "error", text: "Fehler bei der Bereinigung." });
    }
  };

  const handleUpdateTarget = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTarget) return;
    try {
      const res = await fetch("/api/nvr/storage", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingTarget.id,
          name: editingTarget.name,
          maxDays: editingTarget.maxDays,
          minFreeSpaceGb: editingTarget.minFreeSpaceGb,
        }),
      });
      if (res.ok) {
        setActionMessage({ type: "ok", text: "Einstellungen gespeichert." });
        setEditingTarget(null);
        fetchTargets();
      }
    } catch {
      setActionMessage({ type: "error", text: "Fehler beim Speichern." });
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link
              href="/recordings"
              className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Zurück zu Aufnahmen
            </Link>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
            <HardDrive className="h-7 w-7 text-cyan-400" />
            NVR-Speichermedien
          </h1>
          <p className="text-sm text-slate-400">
            Verwalte lokale Festplatten, externe USB-Medien oder gemountete NAS-Freigaben für Videoaufzeichnungen.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              fetchTargets();
              fetchDiscoveredVolumes();
            }}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800 active:scale-95 transition-all"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            Aktualisieren
          </button>
          <button
            onClick={() => {
              setIsModalOpen(true);
              setTestResult(null);
              fetchDiscoveredVolumes();
            }}
            className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-cyan-600 to-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-cyan-950 hover:from-cyan-500 hover:to-indigo-500 active:scale-95 transition-all"
          >
            <Plus className="h-4 w-4" />
            Speichermedium anbinden
          </button>
        </div>
      </div>

      {/* Action Notification */}
      {actionMessage && (
        <div
          className={`rounded-xl border p-4 flex items-center justify-between transition-all ${
            actionMessage.type === "ok"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : "border-rose-500/30 bg-rose-500/10 text-rose-300"
          }`}
        >
          <div className="flex items-center gap-2.5">
            {actionMessage.type === "ok" ? (
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
            ) : (
              <AlertTriangle className="h-5 w-5 shrink-0 text-rose-400" />
            )}
            <span className="text-sm font-medium">{actionMessage.text}</span>
          </div>
          <button
            onClick={() => setActionMessage(null)}
            className="text-xs opacity-70 hover:opacity-100"
          >
            Schließen
          </button>
        </div>
      )}

      {/* Target Cards */}
      {loading ? (
        <div className="flex flex-col items-center justify-center p-12 text-slate-400">
          <RefreshCw className="h-8 w-8 animate-spin text-cyan-500 mb-3" />
          <p className="text-sm">Lade Speichermedien und Laufwerkskapazitäten...</p>
        </div>
      ) : targets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-950/40 p-12 text-center">
          <HardDrive className="mx-auto h-12 w-12 text-slate-600 mb-3" />
          <h3 className="text-base font-semibold text-white">Keine Speichermedien eingerichtet</h3>
          <p className="text-sm text-slate-400 mt-1 max-w-md mx-auto">
            Binde ein lokales Verzeichnis oder eine externe Festplatte an, um Kameras aufzeichnen zu lassen.
          </p>
          <button
            onClick={() => setIsModalOpen(true)}
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500"
          >
            <Plus className="h-4 w-4" />
            Erstes Speichermedium anbinden
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {targets.map((target) => {
            const stats = target.stats;
            const percent = stats.usagePercent || 0;
            const isWarn = percent > 85;
            const isCrit = percent > 95;

            return (
              <div
                key={target.id}
                className="group relative flex flex-col justify-between rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900/90 to-slate-950 p-5 shadow-xl transition-all hover:border-slate-700"
              >
                <div>
                  {/* Top Bar with Name & Status */}
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-base font-bold text-white truncate">{target.name}</h3>
                        {target.isDefault && (
                          <span className="rounded-full bg-cyan-500/20 px-2.5 py-0.5 text-[11px] font-semibold text-cyan-300 border border-cyan-500/30">
                            Standard-Speicher
                          </span>
                        )}
                      </div>
                      <p className="text-xs font-mono text-slate-400 truncate mt-0.5" title={target.path}>
                        {target.path}
                      </p>
                    </div>

                    <div className="shrink-0 flex items-center gap-1.5">
                      {stats.isOnline ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-400 border border-emerald-500/20">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                          Online
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-2 py-0.5 text-xs text-rose-400 border border-rose-500/20">
                          <span className="h-1.5 w-1.5 rounded-full bg-rose-500"></span>
                          Offline / Fehler
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Storage Progress Bar */}
                  <div className="mt-4 mb-4">
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span className="text-slate-400">
                        Belegt:{" "}
                        <strong className="text-slate-200">{formatBytes(stats.usedBytes)}</strong> von{" "}
                        {formatBytes(stats.totalBytes)}
                      </span>
                      <span
                        className={`font-semibold ${
                          isCrit ? "text-rose-400" : isWarn ? "text-amber-400" : "text-cyan-400"
                        }`}
                      >
                        {percent}% belegt
                      </span>
                    </div>

                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
                      <div
                        className={`h-full transition-all duration-500 ${
                          isCrit
                            ? "bg-rose-500"
                            : isWarn
                            ? "bg-amber-500"
                            : "bg-gradient-to-r from-cyan-500 to-indigo-500"
                        }`}
                        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
                      ></div>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-500 mt-1">
                      <span>Freier Speicher: {formatBytes(stats.freeBytes)}</span>
                      <span>
                        NVR-Clips: {stats.recordingsCount} ({formatBytes(stats.recordingsSizeBytes)})
                      </span>
                    </div>
                  </div>

                  {/* Settings & Retention Info */}
                  <div className="rounded-xl bg-slate-950/60 border border-slate-800/80 p-3 grid grid-cols-2 gap-2 text-xs text-slate-300 mb-4">
                    <div>
                      <span className="text-slate-500 block text-[11px]">Aufbewahrungszeit:</span>
                      <span className="font-medium text-slate-200">
                        {target.maxDays > 0 ? `${target.maxDays} Tage` : "Unbegrenzt"}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[11px]">Puffer-Schwelle:</span>
                      <span className="font-medium text-slate-200">
                        {target.minFreeSpaceGb > 0 ? `Min. ${target.minFreeSpaceGb} GB frei` : "Deaktiviert"}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[11px]">Kameras zugewiesen:</span>
                      <span className="font-medium text-slate-200">{target.assignedCamerasCount} Kamera(s)</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[11px]">Schreibrechte:</span>
                      <span className="font-medium text-slate-200">
                        {stats.writable ? (
                          <span className="text-emerald-400">✓ Vorhanden</span>
                        ) : (
                          <span className="text-rose-400">✗ Verweigert</span>
                        )}
                      </span>
                    </div>
                  </div>

                  {stats.error && (
                    <div className="rounded-lg bg-rose-950/40 border border-rose-800/40 p-2.5 text-xs text-rose-300 mb-3 flex items-start gap-2">
                      <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
                      <span>{stats.error}</span>
                    </div>
                  )}
                </div>

                {/* Card Actions */}
                <div className="flex items-center justify-between gap-2 border-t border-slate-800/80 pt-3">
                  <div className="flex items-center gap-1.5">
                    {!target.isDefault && (
                      <button
                        onClick={() => handleSetDefault(target.id)}
                        className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 active:scale-95 transition-all"
                      >
                        Als Standard
                      </button>
                    )}
                    <button
                      onClick={() => handleTriggerCleanup(target.id)}
                      className="rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 active:scale-95 transition-all"
                      title="Löscht veraltete Segmente gemäß Regeln"
                    >
                      Jetzt bereinigen
                    </button>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setEditingTarget(target)}
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
                      title="Einstellungen anpassen"
                    >
                      <Settings2 className="h-4 w-4" />
                    </button>
                    {!target.isDefault && (
                      <button
                        onClick={() => handleDelete(target.id, target.name)}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-500/20 hover:text-rose-300 transition-colors"
                        title="Speicherziel entfernen"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Storage Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="relative w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <FolderPlus className="h-5 w-5 text-cyan-400" />
                Neues Speichermedium anbinden
              </h2>
              <button
                onClick={() => setIsModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                ✕
              </button>
            </div>

            {/* Modal Tabs */}
            <div className="flex gap-2 my-4 border-b border-slate-800 pb-2">
              <button
                type="button"
                onClick={() => setModalTab("discovered")}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                  modalTab === "discovered"
                    ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                    : "text-slate-400 hover:bg-slate-800 hover:text-white"
                }`}
              >
                Erkannte Systemlaufwerke ({discoveredVolumes.length})
              </button>
              <button
                type="button"
                onClick={() => setModalTab("custom")}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                  modalTab === "custom"
                    ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                    : "text-slate-400 hover:bg-slate-800 hover:text-white"
                }`}
              >
                Benutzerdefinierter Pfad
              </button>
            </div>

            {modalTab === "discovered" ? (
              <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                <p className="text-xs text-slate-400">
                  Gefundene Festplatten, USB-Laufwerke und gemountete Netzwerkfreigaben auf deinem Host-System:
                </p>

                {discoveredVolumes.length === 0 ? (
                  <div className="rounded-xl border border-slate-800 p-6 text-center text-xs text-slate-400">
                    Keine externen Laufwerke gefunden. Du kannst im Reiter „Benutzerdefinierter Pfad“ jeden Pfad
                    manuell eingeben.
                  </div>
                ) : (
                  discoveredVolumes.map((vol, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 hover:border-slate-700 transition-all"
                    >
                      <div className="min-w-0 pr-3">
                        <div className="flex items-center gap-2">
                          <HardDrive className="h-4 w-4 text-cyan-400 shrink-0" />
                          <h4 className="text-sm font-semibold text-white truncate">{vol.name}</h4>
                          {vol.isAlreadyConfigured && (
                            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                              Bereits hinterlegt
                            </span>
                          )}
                        </div>
                        <p className="text-xs font-mono text-slate-400 truncate mt-0.5">{vol.path}</p>
                        <p className="text-[11px] text-slate-500 mt-1">
                          Kapazität: {formatBytes(vol.totalBytes)} · Frei:{" "}
                          <strong className="text-slate-300">{formatBytes(vol.freeBytes)}</strong>
                        </p>
                      </div>

                      <button
                        type="button"
                        disabled={vol.isAlreadyConfigured}
                        onClick={() => handleSelectDiscovered(vol)}
                        className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                          vol.isAlreadyConfigured
                            ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                            : "bg-cyan-600 text-white hover:bg-cyan-500 active:scale-95"
                        }`}
                      >
                        Auswählen
                      </button>
                    </div>
                  ))
                )}
              </div>
            ) : (
              <form onSubmit={handleAddTarget} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Name des Speichermediums
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="z. B. Externe SSD T7, Synology CCTV, USB-Stick"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-medium text-slate-300">
                      Vollständiger Ordnerpfad auf dem System
                    </label>
                    <button
                      type="button"
                      disabled={!newPath.trim() || testingPath}
                      onClick={() => handleTestPath(newPath)}
                      className="text-xs text-cyan-400 hover:text-cyan-300 disabled:opacity-40"
                    >
                      {testingPath ? "Prüfe..." : "Pfad testen"}
                    </button>
                  </div>
                  <input
                    type="text"
                    required
                    placeholder="z. B. /Volumes/MeinNAS/recordings oder /data/recordings"
                    value={newPath}
                    onChange={(e) => {
                      setNewPath(e.target.value);
                      setTestResult(null);
                    }}
                    className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm font-mono text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="autoCreateCheck"
                    checked={newAutoCreate}
                    onChange={(e) => setNewAutoCreate(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-900 text-cyan-600 focus:ring-0"
                  />
                  <label htmlFor="autoCreateCheck" className="text-xs text-slate-300 cursor-pointer">
                    Ordner automatisch anlegen, falls er noch nicht existiert
                  </label>
                </div>

                {/* Test Result Box */}
                {testResult && (
                  <div
                    className={`rounded-xl border p-3 text-xs ${
                      testResult.ok
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                        : "border-rose-500/30 bg-rose-500/10 text-rose-300"
                    }`}
                  >
                    {testResult.ok ? (
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5 font-semibold">
                          <FolderCheck className="h-4 w-4 text-emerald-400" />
                          Pfad erfolgreich geprüft & beschreibbar!
                        </div>
                        <div className="text-[11px] opacity-90">
                          Freier Speicher: {formatBytes(testResult.freeBytes)} von {formatBytes(testResult.totalBytes)}
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-1.5">
                        <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
                        <div>
                          <strong>Prüfung fehlgeschlagen:</strong> {testResult.error}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 pt-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Aufbewahrungszeit (Tage)
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={newMaxDays}
                      onChange={(e) => setNewMaxDays(Number(e.target.value))}
                      className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
                    />
                    <span className="text-[10px] text-slate-500">0 = Unbegrenzt</span>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Min. freier Puffer (GB)
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={newMinFreeGb}
                      onChange={(e) => setNewMinFreeGb(Number(e.target.value))}
                      className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
                    />
                    <span className="text-[10px] text-slate-500">Älteste Aufnahmen löschen wenn unterschritten</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="checkbox"
                    id="setDefaultCheck"
                    checked={newIsDefault}
                    onChange={(e) => setNewIsDefault(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-900 text-cyan-600 focus:ring-0"
                  />
                  <label htmlFor="setDefaultCheck" className="text-xs text-slate-300 cursor-pointer">
                    Als Standard-Speicherziel für neue Kameras festlegen
                  </label>
                </div>

                <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="rounded-lg border border-slate-800 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800"
                  >
                    Abbrechen
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="rounded-lg bg-cyan-600 px-4 py-2 text-xs font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
                  >
                    {submitting ? "Speichere..." : "Speichermedium anbinden"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Edit Target Modal */}
      {editingTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="relative w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-4">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Settings2 className="h-5 w-5 text-cyan-400" />
                Speicherziel bearbeiten
              </h2>
              <button
                onClick={() => setEditingTarget(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleUpdateTarget} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Name</label>
                <input
                  type="text"
                  required
                  value={editingTarget.name}
                  onChange={(e) => setEditingTarget({ ...editingTarget, name: e.target.value })}
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Pfad (schreibgeschützt)</label>
                <input
                  type="text"
                  disabled
                  value={editingTarget.path}
                  className="w-full rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2 text-xs font-mono text-slate-400"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Aufbewahrungszeit (Tage)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={editingTarget.maxDays}
                    onChange={(e) =>
                      setEditingTarget({ ...editingTarget, maxDays: Number(e.target.value) })
                    }
                    className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
                  />
                  <span className="text-[10px] text-slate-500">0 = Unbegrenzt</span>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Min. freier Puffer (GB)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={editingTarget.minFreeSpaceGb}
                    onChange={(e) =>
                      setEditingTarget({ ...editingTarget, minFreeSpaceGb: Number(e.target.value) })
                    }
                    className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingTarget(null)}
                  className="rounded-lg border border-slate-800 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800"
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-cyan-600 px-4 py-2 text-xs font-medium text-white hover:bg-cyan-500"
                >
                  Speichern
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
