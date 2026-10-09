"use client";

import { useCallback, useEffect, useState } from "react";
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
  Server,
  Network,
  Wrench,
} from "lucide-react";
import { useToast } from "@/components/ToastProvider";

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
  const { toast } = useToast();
  const [targets, setTargets] = useState<StorageTargetItem[]>([]);
  const [discoveredVolumes, setDiscoveredVolumes] = useState<DiscoveredVolume[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fixingPath, setFixingPath] = useState<string | null>(null);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalTab, setModalTab] = useState<"discovered" | "smb" | "nfs" | "custom">("discovered");

  // Form State for Custom Path
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

  // Form State for SMB / CIFS
  const [smbName, setSmbName] = useState("");
  const [smbServer, setSmbServer] = useState("");
  const [smbShare, setSmbShare] = useState("");
  const [smbUsername, setSmbUsername] = useState("");
  const [smbPassword, setSmbPassword] = useState("");
  const [smbDomain, setSmbDomain] = useState("");
  const [smbMountpoint, setSmbMountpoint] = useState("/mnt/nas-recordings");
  const [smbPersist, setSmbPersist] = useState(true);
  const [smbIsDefault, setSmbIsDefault] = useState(false);
  const [smbMaxDays, setSmbMaxDays] = useState(14);
  const [smbMinFreeGb, setSmbMinFreeGb] = useState(10);
  const [mountingSmb, setMountingSmb] = useState(false);

  // Form State for NFS
  const [nfsName, setNfsName] = useState("");
  const [nfsServer, setNfsServer] = useState("");
  const [nfsShare, setNfsShare] = useState("");
  const [nfsMountpoint, setNfsMountpoint] = useState("/mnt/nfs-recordings");
  const [nfsPersist, setNfsPersist] = useState(true);
  const [nfsIsDefault, setNfsIsDefault] = useState(false);
  const [nfsMaxDays, setNfsMaxDays] = useState(14);
  const [nfsMinFreeGb, setNfsMinFreeGb] = useState(10);
  const [mountingNfs, setMountingNfs] = useState(false);

  // Edit Modal State
  const [editingTarget, setEditingTarget] = useState<StorageTargetItem | null>(null);

  const fetchTargets = useCallback(async () => {
    try {
      setRefreshing(true);
      const res = await fetch("/api/nvr/storage", { cache: "no-store" });
      const data = await res.json();
      if (data.targets) {
        setTargets(data.targets);
      }
    } catch {
      toast.error("Fehler beim Laden der Speicherziele.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [toast]);

  const fetchDiscoveredVolumes = useCallback(async () => {
    try {
      const res = await fetch("/api/nvr/storage/discover", { cache: "no-store" });
      const data = await res.json();
      if (data.volumes) {
        setDiscoveredVolumes(data.volumes);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchTargets();
    fetchDiscoveredVolumes();
  }, [fetchTargets, fetchDiscoveredVolumes]);

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
      if (data.ok && data.writable) {
        toast.success(`Pfad erreichbar & beschreibbar (${formatBytes(data.freeBytes)} frei).`);
      } else {
        toast.warning(data.error || "Prüfung fehlgeschlagen: Keine Schreibrechte.");
      }
    } catch {
      setTestResult({
        ok: false,
        exists: false,
        writable: false,
        totalBytes: 0,
        freeBytes: 0,
        error: "Netzwerkfehler beim Pfad-Test.",
      });
      toast.error("Netzwerkfehler beim Pfad-Test.");
    } finally {
      setTestingPath(false);
    }
  };

  const handleFixPermissions = async (pathToFix: string) => {
    if (!pathToFix.trim()) return;
    setFixingPath(pathToFix);
    try {
      const res = await fetch("/api/nvr/storage/fix-permission", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: pathToFix.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        toast.success(data.message || "Schreibrechte erfolgreich eingerichtet!");
        await fetchTargets();
        await fetchDiscoveredVolumes();
        if (testResult) {
          handleTestPath(pathToFix);
        }
      } else {
        toast.error(data.error || "Fehler beim Anpassen der Berechtigungen.");
      }
    } catch (err: any) {
      toast.error("Fehler: " + (err?.message || "Konnte Berechtigungen nicht anpassen."));
    } finally {
      setFixingPath(null);
    }
  };

  const handleAddTarget = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPath.trim()) return;
    setSubmitting(true);
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
      toast.success(data.message || "Speicherziel erfolgreich angebunden!");
      setIsModalOpen(false);
      setNewName("");
      setNewPath("");
      setTestResult(null);
      await fetchTargets();
      await fetchDiscoveredVolumes();
    } catch (err: any) {
      toast.error(err.message || "Fehler beim Anbinden.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleMountSmb = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!smbServer.trim() || !smbShare.trim() || !smbMountpoint.trim()) return;
    setMountingSmb(true);
    try {
      const res = await fetch("/api/nvr/storage/mount", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "cifs",
          name: smbName.trim(),
          server: smbServer.trim(),
          share: smbShare.trim(),
          username: smbUsername.trim() || undefined,
          password: smbPassword || undefined,
          domain: smbDomain.trim() || undefined,
          mountpoint: smbMountpoint.trim(),
          persist: smbPersist,
          isDefault: smbIsDefault,
          maxDays: smbMaxDays,
          minFreeSpaceGb: smbMinFreeGb,
        }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        toast.success(data.message || "SMB-Freigabe erfolgreich angebunden!");
        setIsModalOpen(false);
        setSmbName("");
        setSmbServer("");
        setSmbShare("");
        setSmbUsername("");
        setSmbPassword("");
        await fetchTargets();
        await fetchDiscoveredVolumes();
      } else {
        toast.error(data.error || "Fehler beim Einhängen der SMB-Freigabe.");
      }
    } catch (err: any) {
      toast.error("Fehler: " + (err?.message || "Netzwerkfehler beim Einhängen."));
    } finally {
      setMountingSmb(false);
    }
  };

  const handleMountNfs = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nfsServer.trim() || !nfsShare.trim() || !nfsMountpoint.trim()) return;
    setMountingNfs(true);
    try {
      const res = await fetch("/api/nvr/storage/mount", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "nfs",
          name: nfsName.trim(),
          server: nfsServer.trim(),
          share: nfsShare.trim(),
          mountpoint: nfsMountpoint.trim(),
          persist: nfsPersist,
          isDefault: nfsIsDefault,
          maxDays: nfsMaxDays,
          minFreeSpaceGb: nfsMinFreeGb,
        }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        toast.success(data.message || "NFS-Freigabe erfolgreich angebunden!");
        setIsModalOpen(false);
        setNfsName("");
        setNfsServer("");
        setNfsShare("");
        await fetchTargets();
        await fetchDiscoveredVolumes();
      } else {
        toast.error(data.error || "Fehler beim Einhängen der NFS-Freigabe.");
      }
    } catch (err: any) {
      toast.error("Fehler: " + (err?.message || "Netzwerkfehler beim Einhängen."));
    } finally {
      setMountingNfs(false);
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
        toast.success("Standard-Speicherziel aktualisiert.");
        fetchTargets();
      }
    } catch {
      toast.error("Fehler beim Aktualisieren.");
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (
      !confirm(
        `Möchtest du das Speicherziel "${name}" wirklich entfernen? Aufgezeichnete Videodateien bleiben auf dem Laufwerk erhalten.`
      )
    ) {
      return;
    }
    try {
      const res = await fetch(`/api/nvr/storage?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Fehler beim Löschen.");
      }
      toast.success("Speicherziel entfernt.");
      fetchTargets();
      fetchDiscoveredVolumes();
    } catch (err: any) {
      toast.error(err.message || "Fehler beim Löschen.");
    }
  };

  const handleTriggerCleanup = async (id: string) => {
    try {
      toast.info("Bereinigung läuft im Hintergrund...");
      const res = await fetch("/api/nvr/storage/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId: id }),
      });
      const data = await res.json();
      if (data.ok && data.results && data.results[0]) {
        const r = data.results[0];
        toast.success(`Bereinigung abgeschlossen: ${r.deletedFiles} alte Segmente gelöscht (${formatBytes(r.freedBytes)} freigegeben).`);
      } else {
        toast.info("Bereinigung beendet. Keine überfälligen Dateien gefunden.");
      }
      fetchTargets();
    } catch {
      toast.error("Fehler bei der Bereinigung.");
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
          name: editingTarget.name.trim(),
          maxDays: editingTarget.maxDays,
          minFreeSpaceGb: editingTarget.minFreeSpaceGb,
          enabled: editingTarget.enabled,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Fehler beim Speichern.");
      toast.success("Speicherziel aktualisiert.");
      setEditingTarget(null);
      fetchTargets();
    } catch (err: any) {
      toast.error(err.message || "Fehler beim Speichern.");
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Link
              href="/recordings"
              className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Zurück zu Aufnahmen
            </Link>
          </div>
          <h1 className="text-2xl font-bold text-white sm:text-3xl flex items-center gap-2.5 mt-1">
            <HardDrive className="h-7 w-7 text-cyan-400" />
            NVR-Speichermedien
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Festplatten, USB-Laufwerke, Proxmox-Mounts und SMB/NFS-Netzwerkfreigaben für die 24/7-Kameraaufzeichnung.
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
            Binde ein lokales Verzeichnis, eine externe Festplatte oder ein Netzlaufwerk an, um Kameras aufzeichnen zu lassen.
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

                  {/* Missing write permission auto-fix button */}
                  {!stats.writable && (
                    <div className="rounded-lg bg-amber-950/40 border border-amber-800/40 p-3 text-xs text-amber-300 mb-3 flex flex-col gap-2">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
                        <div>
                          <strong>Keine Schreibrechte:</strong> Der Server-Benutzer darf nicht in diesen Ordner schreiben.
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={fixingPath === target.path}
                        onClick={() => handleFixPermissions(target.path)}
                        className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-500 active:scale-95 transition-all disabled:opacity-50"
                      >
                        <Wrench className="h-3.5 w-3.5" />
                        {fixingPath === target.path ? "Repariere Berechtigungen..." : "Schreibrechte jetzt per Klick reparieren"}
                      </button>
                    </div>
                  )}

                  {stats.error && stats.writable && (
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
          <div className="relative w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800 shrink-0">
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
            <div className="flex gap-1.5 my-4 border-b border-slate-800 pb-2 shrink-0 flex-wrap">
              <button
                type="button"
                onClick={() => setModalTab("discovered")}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                  modalTab === "discovered"
                    ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                    : "text-slate-400 hover:bg-slate-800 hover:text-white"
                }`}
              >
                Erkannte Laufwerke ({discoveredVolumes.length})
              </button>
              <button
                type="button"
                onClick={() => setModalTab("smb")}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all flex items-center gap-1.5 ${
                  modalTab === "smb"
                    ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                    : "text-slate-400 hover:bg-slate-800 hover:text-white"
                }`}
              >
                <Server className="h-3.5 w-3.5" />
                Netzlaufwerk (SMB / NAS)
              </button>
              <button
                type="button"
                onClick={() => setModalTab("nfs")}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all flex items-center gap-1.5 ${
                  modalTab === "nfs"
                    ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                    : "text-slate-400 hover:bg-slate-800 hover:text-white"
                }`}
              >
                <Network className="h-3.5 w-3.5" />
                NFS Freigabe
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
                Manueller Pfad
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto pr-1">
              {modalTab === "discovered" && (
                <div className="space-y-3">
                  <p className="text-xs text-slate-400">
                    Gefundene Festplatten, USB-Laufwerke und gemountete Verzeichnisse auf diesem Host:
                  </p>

                  {discoveredVolumes.length === 0 ? (
                    <div className="rounded-xl border border-slate-800 p-6 text-center text-xs text-slate-400">
                      Keine externen Laufwerke gefunden. Nutze den Reiter „Netzlaufwerk (SMB / NAS)“ oder „Manueller Pfad“.
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
              )}

              {modalTab === "smb" && (
                <form onSubmit={handleMountSmb} className="space-y-3.5 text-xs">
                  <div className="rounded-lg bg-cyan-950/30 border border-cyan-800/40 p-3 text-cyan-300">
                    <p className="font-semibold mb-0.5">Netzlaufwerk ohne Terminal einbinden</p>
                    <p className="text-[11px] opacity-80 leading-relaxed">
                      Der LXC bindet die Freigabe (Synology, QNAP, TrueNAS, Windows) automatisch mit Schreibrechten ein.
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block font-medium text-slate-300 mb-1">Anzeigename</label>
                      <input
                        type="text"
                        required
                        placeholder="z. B. Synology NAS, FritzBox"
                        value={smbName}
                        onChange={(e) => setSmbName(e.target.value)}
                        className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-white placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-slate-300 mb-1">Server / IP</label>
                      <input
                        type="text"
                        required
                        placeholder="192.168.1.100"
                        value={smbServer}
                        onChange={(e) => setSmbServer(e.target.value)}
                        className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-white placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block font-medium text-slate-300 mb-1">Freigabename</label>
                      <input
                        type="text"
                        required
                        placeholder="cameras oder nvr-share"
                        value={smbShare}
                        onChange={(e) => setSmbShare(e.target.value)}
                        className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-white placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-slate-300 mb-1">Lokaler Mount-Pfad</label>
                      <input
                        type="text"
                        required
                        placeholder="/mnt/nas-recordings"
                        value={smbMountpoint}
                        onChange={(e) => setSmbMountpoint(e.target.value)}
                        className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-white placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3 space-y-2.5">
                    <span className="font-semibold text-slate-300 block">Zugangsdaten (SMB)</span>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="block text-slate-400 mb-1">Benutzername</label>
                        <input
                          type="text"
                          placeholder="Gast wenn leer"
                          value={smbUsername}
                          onChange={(e) => setSmbUsername(e.target.value)}
                          className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-white placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-slate-400 mb-1">Passwort</label>
                        <input
                          type="password"
                          placeholder="••••••••"
                          value={smbPassword}
                          onChange={(e) => setSmbPassword(e.target.value)}
                          className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-white placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div>
                      <label className="block font-medium text-slate-300 mb-1">Aufbewahrungszeit (Tage)</label>
                      <input
                        type="number"
                        min="0"
                        value={smbMaxDays}
                        onChange={(e) => setSmbMaxDays(Number(e.target.value))}
                        className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-white focus:border-cyan-500 focus:outline-none"
                      />
                      <span className="text-[10px] text-slate-500">0 = Unbegrenzt</span>
                    </div>
                    <div>
                      <label className="block font-medium text-slate-300 mb-1">Min. freier Puffer (GB)</label>
                      <input
                        type="number"
                        min="0"
                        value={smbMinFreeGb}
                        onChange={(e) => setSmbMinFreeGb(Number(e.target.value))}
                        className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-white focus:border-cyan-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5 pt-1">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={smbPersist}
                        onChange={(e) => setSmbPersist(e.target.checked)}
                        className="rounded border-slate-700 bg-slate-900 text-cyan-600 focus:ring-0"
                      />
                      <span className="text-slate-300">Beim Container-Start automatisch einhängen (/etc/fstab)</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={smbIsDefault}
                        onChange={(e) => setSmbIsDefault(e.target.checked)}
                        className="rounded border-slate-700 bg-slate-900 text-cyan-600 focus:ring-0"
                      />
                      <span className="text-slate-300">Als Standard-Speicherziel für neue Kameras festlegen</span>
                    </label>
                  </div>

                  <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setIsModalOpen(false)}
                      className="rounded-lg border border-slate-800 px-3.5 py-2 text-slate-300 hover:bg-slate-800"
                    >
                      Abbrechen
                    </button>
                    <button
                      type="submit"
                      disabled={mountingSmb}
                      className="rounded-lg bg-cyan-600 px-4 py-2 font-medium text-white hover:bg-cyan-500 disabled:opacity-50 flex items-center gap-1.5"
                    >
                      {mountingSmb ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Server className="h-3.5 w-3.5" />}
                      {mountingSmb ? "Wird eingehängt..." : "Netzlaufwerk jetzt einbinden"}
                    </button>
                  </div>
                </form>
              )}

              {modalTab === "nfs" && (
                <form onSubmit={handleMountNfs} className="space-y-3.5 text-xs">
                  <div className="rounded-lg bg-cyan-950/30 border border-cyan-800/40 p-3 text-cyan-300">
                    <p className="font-semibold mb-0.5">NFS-Freigabe automatisch einbinden</p>
                    <p className="text-[11px] opacity-80 leading-relaxed">
                      Direktes Linux-Mounten über NFSv3/v4 – besonders schnell und zuverlässig.
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block font-medium text-slate-300 mb-1">Anzeigename</label>
                      <input
                        type="text"
                        required
                        placeholder="z. B. TrueNAS NFS"
                        value={nfsName}
                        onChange={(e) => setNfsName(e.target.value)}
                        className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-white placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-slate-300 mb-1">Server / IP</label>
                      <input
                        type="text"
                        required
                        placeholder="192.168.1.100"
                        value={nfsServer}
                        onChange={(e) => setNfsServer(e.target.value)}
                        className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-white placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block font-medium text-slate-300 mb-1">Export-Pfad (auf dem NAS)</label>
                      <input
                        type="text"
                        required
                        placeholder="/volume1/recordings"
                        value={nfsShare}
                        onChange={(e) => setNfsShare(e.target.value)}
                        className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-white placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-slate-300 mb-1">Lokaler Mount-Pfad</label>
                      <input
                        type="text"
                        required
                        placeholder="/mnt/nfs-recordings"
                        value={nfsMountpoint}
                        onChange={(e) => setNfsMountpoint(e.target.value)}
                        className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-white placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div>
                      <label className="block font-medium text-slate-300 mb-1">Aufbewahrungszeit (Tage)</label>
                      <input
                        type="number"
                        min="0"
                        value={nfsMaxDays}
                        onChange={(e) => setNfsMaxDays(Number(e.target.value))}
                        className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-white focus:border-cyan-500 focus:outline-none"
                      />
                      <span className="text-[10px] text-slate-500">0 = Unbegrenzt</span>
                    </div>
                    <div>
                      <label className="block font-medium text-slate-300 mb-1">Min. freier Puffer (GB)</label>
                      <input
                        type="number"
                        min="0"
                        value={nfsMinFreeGb}
                        onChange={(e) => setNfsMinFreeGb(Number(e.target.value))}
                        className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-white focus:border-cyan-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5 pt-1">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={nfsPersist}
                        onChange={(e) => setNfsPersist(e.target.checked)}
                        className="rounded border-slate-700 bg-slate-900 text-cyan-600 focus:ring-0"
                      />
                      <span className="text-slate-300">Beim Container-Start automatisch einhängen (/etc/fstab)</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={nfsIsDefault}
                        onChange={(e) => setNfsIsDefault(e.target.checked)}
                        className="rounded border-slate-700 bg-slate-900 text-cyan-600 focus:ring-0"
                      />
                      <span className="text-slate-300">Als Standard-Speicherziel festlegen</span>
                    </label>
                  </div>

                  <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setIsModalOpen(false)}
                      className="rounded-lg border border-slate-800 px-3.5 py-2 text-slate-300 hover:bg-slate-800"
                    >
                      Abbrechen
                    </button>
                    <button
                      type="submit"
                      disabled={mountingNfs}
                      className="rounded-lg bg-cyan-600 px-4 py-2 font-medium text-white hover:bg-cyan-500 disabled:opacity-50 flex items-center gap-1.5"
                    >
                      {mountingNfs ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Network className="h-3.5 w-3.5" />}
                      {mountingNfs ? "Wird eingehängt..." : "NFS-Freigabe jetzt einbinden"}
                    </button>
                  </div>
                </form>
              )}

              {modalTab === "custom" && (
                <form onSubmit={handleAddTarget} className="space-y-4 text-xs">
                  <div>
                    <label className="block font-medium text-slate-300 mb-1">
                      Name des Speichermediums
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="z. B. Externe SSD T7, Proxmox Bind-Mount"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block font-medium text-slate-300">
                        Vollständiger Ordnerpfad auf dem Host
                      </label>
                      <button
                        type="button"
                        disabled={!newPath.trim() || testingPath}
                        onClick={() => handleTestPath(newPath)}
                        className="text-cyan-400 hover:text-cyan-300 disabled:opacity-40"
                      >
                        {testingPath ? "Prüfe..." : "Pfad testen"}
                      </button>
                    </div>
                    <input
                      type="text"
                      required
                      placeholder="z. B. /mnt/recordings oder /data/recordings"
                      value={newPath}
                      onChange={(e) => {
                        setNewPath(e.target.value);
                        setTestResult(null);
                      }}
                      className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
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
                    <label htmlFor="autoCreateCheck" className="text-slate-300 cursor-pointer">
                      Ordner automatisch anlegen, falls er noch nicht existiert
                    </label>
                  </div>

                  {/* Test Result Box */}
                  {testResult && (
                    <div
                      className={`rounded-xl border p-3.5 space-y-2 ${
                        testResult.ok && testResult.writable
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                          : "border-rose-500/30 bg-rose-500/10 text-rose-300"
                      }`}
                    >
                      {testResult.ok && testResult.writable ? (
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
                        <div className="space-y-2">
                          <div className="flex items-start gap-1.5">
                            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
                            <div>
                              <strong>Prüfung fehlgeschlagen:</strong> {testResult.error}
                            </div>
                          </div>
                          {/* Direct repair button */}
                          <button
                            type="button"
                            disabled={fixingPath === newPath}
                            onClick={() => handleFixPermissions(newPath)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-500 active:scale-95 transition-all disabled:opacity-50"
                          >
                            <Wrench className="h-3.5 w-3.5" />
                            {fixingPath === newPath ? "Repariere Berechtigungen..." : "Schreibrechte jetzt per Klick reparieren"}
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div>
                      <label className="block font-medium text-slate-300 mb-1">
                        Aufbewahrungszeit (Tage)
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={newMaxDays}
                        onChange={(e) => setNewMaxDays(Number(e.target.value))}
                        className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-white focus:border-cyan-500 focus:outline-none"
                      />
                      <span className="text-[10px] text-slate-500">0 = Unbegrenzt</span>
                    </div>

                    <div>
                      <label className="block font-medium text-slate-300 mb-1">
                        Min. freier Puffer (GB)
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={newMinFreeGb}
                        onChange={(e) => setNewMinFreeGb(Number(e.target.value))}
                        className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-white focus:border-cyan-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="checkbox"
                      id="isDefaultCheck"
                      checked={newIsDefault}
                      onChange={(e) => setNewIsDefault(e.target.checked)}
                      className="rounded border-slate-700 bg-slate-900 text-cyan-600 focus:ring-0"
                    />
                    <label htmlFor="isDefaultCheck" className="text-slate-300 cursor-pointer">
                      Als Standard-Speicherziel für neue Kameras festlegen
                    </label>
                  </div>

                  <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setIsModalOpen(false)}
                      className="rounded-lg border border-slate-800 px-3.5 py-2 text-slate-300 hover:bg-slate-800"
                    >
                      Abbrechen
                    </button>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="rounded-lg bg-cyan-600 px-4 py-2 font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
                    >
                      {submitting ? "Wird angebunden..." : "Speichermedium anbinden"}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Edit Storage Target Modal */}
      {editingTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
          <div className="relative w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Settings2 className="h-5 w-5 text-cyan-400" />
                Speicherziel anpassen
              </h2>
              <button
                onClick={() => setEditingTarget(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleUpdateTarget} className="space-y-4 mt-4 text-xs">
              <div>
                <label className="block font-medium text-slate-300 mb-1">Name</label>
                <input
                  type="text"
                  required
                  value={editingTarget.name}
                  onChange={(e) => setEditingTarget({ ...editingTarget, name: e.target.value })}
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-white focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-300 mb-1">Pfad</label>
                <div className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 font-mono text-slate-400 truncate">
                  {editingTarget.path}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-300 mb-1">Aufbewahrungszeit (Tage)</label>
                  <input
                    type="number"
                    min="0"
                    value={editingTarget.maxDays}
                    onChange={(e) =>
                      setEditingTarget({ ...editingTarget, maxDays: Number(e.target.value) })
                    }
                    className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-white focus:border-cyan-500 focus:outline-none"
                  />
                  <span className="text-[10px] text-slate-500">0 = Unbegrenzt</span>
                </div>

                <div>
                  <label className="block font-medium text-slate-300 mb-1">Min. freier Puffer (GB)</label>
                  <input
                    type="number"
                    min="0"
                    value={editingTarget.minFreeSpaceGb}
                    onChange={(e) =>
                      setEditingTarget({
                        ...editingTarget,
                        minFreeSpaceGb: Number(e.target.value),
                      })
                    }
                    className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-white focus:border-cyan-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="enabledCheck"
                  checked={editingTarget.enabled}
                  onChange={(e) => setEditingTarget({ ...editingTarget, enabled: e.target.checked })}
                  className="rounded border-slate-700 bg-slate-900 text-cyan-600 focus:ring-0"
                />
                <label htmlFor="enabledCheck" className="text-slate-300 cursor-pointer">
                  Aktiviert (Aufnahmen auf dieses Ziel zulassen)
                </label>
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingTarget(null)}
                  className="rounded-lg border border-slate-800 px-3.5 py-2 text-slate-300 hover:bg-slate-800"
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-cyan-600 px-4 py-2 font-medium text-white hover:bg-cyan-500"
                >
                  Änderungen speichern
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
