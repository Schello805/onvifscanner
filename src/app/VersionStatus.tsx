"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

type VersionInfo = {
  currentVersion: string;
  latestVersion?: string;
  availableVersions?: string[];
  updateAvailable: boolean;
  updateCommand: string;
  repoUrl: string;
  error?: string;
  checkedAt?: string;
};

const VERSION_CACHE_KEY = "onvifscanner.version-status.v2";

export function VersionStatus(props: { currentVersion: string }) {
  const pathname = usePathname();
  const [info, setInfo] = useState<VersionInfo | null>(null);
  const [checking, setChecking] = useState(true);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selectedRollbackVersion, setSelectedRollbackVersion] = useState("");
  const [updating, setUpdating] = useState(false);
  const [updateMessage, setUpdateMessage] = useState("");
  const containerRef = useRef<HTMLSpanElement>(null);
  const updateMonitorRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function load() {
      setChecking(true);
      try {
        const cached = window.localStorage.getItem(VERSION_CACHE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached) as VersionInfo;
          if (parsed.currentVersion === props.currentVersion && !cancelled) setInfo(parsed);
        }
      } catch {
        // Der Netzwerk-Check funktioniert auch ohne lokalen Cache.
      }

      try {
        const res = await fetch(`/api/version?ts=${Date.now()}`, {
          cache: "no-store",
          headers: { "cache-control": "no-cache" },
          signal: controller.signal
        });
        const json = (await res.json()) as VersionInfo;
        if (!cancelled) {
          setInfo(json);
          if (!json.error) {
            try {
              window.localStorage.setItem(VERSION_CACHE_KEY, JSON.stringify(json));
            } catch {
              // Die Anzeige funktioniert auch bei deaktiviertem Local Storage.
            }
          }
        }
      } catch {
        if (!cancelled) {
          setInfo((current) => current ?? {
            currentVersion: props.currentVersion,
            updateAvailable: false,
            updateCommand: "",
            repoUrl: "",
            error: "Versionsprüfung nicht erreichbar"
          });
        }
      } finally {
        if (!cancelled) setChecking(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [pathname, props.currentVersion]);

  // Close popup when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => () => updateMonitorRef.current?.abort(), []);

  const updateAvailable = Boolean(info?.updateAvailable);
  const checkFailed = Boolean(info?.error && !info.latestVersion);
  const latestVersion = info?.latestVersion;
  const updateCommand =
    info?.updateCommand ??
    "curl -fsSL https://raw.githubusercontent.com/Schello805/onvifscanner/main/scripts/debian-lxc/auto.sh | bash";

  // Rollback versions: filter out currently active version
  const availableRollbackVersions = (info?.availableVersions || []).filter((v) => {
    const cleanCurrent = props.currentVersion.replace(/^v/i, "");
    const cleanV = v.replace(/^v/i, "");
    return cleanCurrent !== cleanV;
  });

  async function waitForUpdatedServer(controller: AbortController, expectedVersion?: string) {
    const deadline = Date.now() + 10 * 60 * 1000;
    let serverWasOffline = false;
    let consecutiveSuccessfulChecks = 0;

    while (!controller.signal.aborted && Date.now() < deadline) {
      await new Promise((resolve) => window.setTimeout(resolve, 2_000));
      if (controller.signal.aborted) return;

      const requestController = new AbortController();
      const abortRequest = () => requestController.abort();
      controller.signal.addEventListener("abort", abortRequest, { once: true });
      const requestTimeout = window.setTimeout(() => requestController.abort(), 4_000);

      try {
        const response = await fetch(`/api/version?update=${Date.now()}`, {
          cache: "no-store",
          headers: { "cache-control": "no-cache" },
          signal: requestController.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const version = (await response.json()) as VersionInfo;
        const versionChanged = version.currentVersion !== props.currentVersion;

        if (versionChanged || (expectedVersion && version.currentVersion.includes(expectedVersion.replace(/^v/i, "")))) {
          setUpdateMessage(`Version ${version.currentVersion} ist bereit. Seite wird geladen…`);
          window.setTimeout(() => window.location.reload(), 700);
          return;
        }

        if (serverWasOffline) {
          consecutiveSuccessfulChecks += 1;
          setUpdateMessage("Dienst ist wieder erreichbar. Version wird geprüft…");
          if (consecutiveSuccessfulChecks >= 3) {
            window.location.reload();
            return;
          }
        } else {
          setUpdateMessage("App wird gebaut und neu gestartet…");
        }
      } catch {
        if (!controller.signal.aborted) {
          serverWasOffline = true;
          consecutiveSuccessfulChecks = 0;
          setUpdateMessage("App wird aktualisiert und neu gestartet…");
        }
      } finally {
        window.clearTimeout(requestTimeout);
        controller.signal.removeEventListener("abort", abortRequest);
      }
    }

    if (!controller.signal.aborted) {
      setUpdating(false);
      setOpen(true);
      setUpdateMessage("Der Vorgang dauert ungewöhnlich lange. Bitte Status oder Terminal-Log prüfen.");
    }
  }

  async function executeUpdateOrRollback(targetVersion?: string) {
    setUpdating(true);
    setUpdateMessage(targetVersion ? `Rollback auf ${targetVersion} startet...` : "Update startet...");
    try {
      const res = await fetch("/api/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        keepalive: true,
        body: JSON.stringify(targetVersion ? { targetVersion } : {}),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setUpdateMessage(data.message || (data.alreadyRunning ? "Prozess läuft bereits…" : "Prozess gestartet…"));
        setOpen(false);
        updateMonitorRef.current?.abort();
        const controller = new AbortController();
        updateMonitorRef.current = controller;
        void waitForUpdatedServer(controller, targetVersion);
      } else {
        setUpdateMessage(data.error || `Aktion konnte nicht gestartet werden (HTTP ${res.status}).`);
        setUpdating(false);
      }
    } catch {
      setUpdateMessage("Update-Dienst ist nicht erreichbar.");
      setUpdating(false);
    }
  }

  async function handleUpdate(e: React.MouseEvent) {
    e.stopPropagation();
    void executeUpdateOrRollback();
  }

  async function handleTriggerRollback(e: React.MouseEvent) {
    e.stopPropagation();
    if (!selectedRollbackVersion) return;
    const ok = window.confirm(
      `Möchtest du wirklich auf Version ${selectedRollbackVersion} zurücksetzen?\n\nEin Sicherheits-Backup der Datenbank wird vor dem Rollback automatisch erstellt.`
    );
    if (!ok) return;
    void executeUpdateOrRollback(selectedRollbackVersion);
  }

  async function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(updateCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard fallback
    }
  }

  return (
    <span
      ref={containerRef}
      className="relative inline-flex items-center gap-2 align-middle group/version"
    >
      <span className="text-slate-400">Rev. v{info?.currentVersion || props.currentVersion}</span>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="cursor-pointer focus:outline-none focus:ring-1 focus:ring-white/20 rounded-full"
        title="Klicken für Update- & Rollback-Details"
      >
        {updateAvailable ? (
          <span className="inline-flex items-center rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[11px] font-semibold text-amber-200 hover:bg-amber-400/20 transition">
            Update verfügbar
          </span>
        ) : checking && !info ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-400/20 bg-slate-400/10 px-2 py-0.5 text-[11px] font-semibold text-slate-300">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-300" />
            prüft…
          </span>
        ) : checkFailed ? (
          <span className="inline-flex items-center rounded-full border border-slate-400/20 bg-slate-400/10 px-2 py-0.5 text-[11px] font-semibold text-slate-300 hover:bg-slate-400/20 transition">
            Prüfung nicht möglich
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-200 hover:bg-emerald-400/20 transition">
            aktuell
          </span>
        )}
      </button>

      {/* Floating Popup */}
      <div
        className={`pointer-events-auto absolute bottom-full left-0 mb-2 z-50 w-84 max-w-[90vw] rounded-xl border border-white/15 bg-slate-950/95 p-4 text-xs leading-relaxed text-slate-200 shadow-2xl shadow-black/80 backdrop-blur-md transition-all ${
          open ? "block" : "hidden group-hover/version:block"
        }`}
      >
        {/* Invisible hover bridge to eliminate gap */}
        <div className="absolute -bottom-3 inset-x-0 h-3" />

        {updateAvailable ? (
          <>
            <div className="flex items-center justify-between">
              <span className="font-semibold text-amber-200">
                Neue Version verfügbar: v{latestVersion}
              </span>
              <span className="rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-300 border border-amber-400/30">
                Update
              </span>
            </div>
            
            <div className="mt-3">
              <button
                type="button"
                onClick={handleUpdate}
                disabled={updating}
                className="w-full rounded-lg bg-amber-500 hover:bg-amber-400 text-amber-950 font-bold py-2 px-3 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {updating ? updateMessage : "1-Klick Update starten"}
              </button>
              {!updating && updateMessage ? (
                <p className="mt-2 rounded-lg border border-rose-400/25 bg-rose-400/10 px-2.5 py-2 text-[11px] leading-relaxed text-rose-200">
                  {updateMessage}
                </p>
              ) : null}
            </div>

            <span className="mt-3.5 block text-slate-400 text-[10px] uppercase tracking-wide font-semibold">
              Oder manuell im Terminal:
            </span>
            <div className="mt-1 flex flex-col gap-1.5">
              <code className="block select-all break-all rounded-lg border border-white/10 bg-black/60 p-2 font-mono text-[11px] text-cyan-200">
                {updateCommand}
              </code>
              <div className="flex items-center justify-end pt-0.5">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="rounded-md border border-white/20 bg-white/10 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-white/20 active:scale-95 cursor-pointer"
                >
                  {copied ? "✓ Kopiert!" : "📋 Kopieren"}
                </button>
              </div>
            </div>
          </>
        ) : checkFailed ? (
          <>
            <span className="block font-semibold text-slate-200">Versionsprüfung momentan nicht möglich.</span>
            <span className="mt-1 block text-slate-400">Die App läuft normal weiter. Beim nächsten Seitenaufruf wird automatisch erneut geprüft.</span>
          </>
        ) : (
          <>
            <span className="block font-semibold text-emerald-200">
              Installation ist aktuell (v{props.currentVersion}).
            </span>
            <span className="mt-1 block text-slate-400">
              Geprüft gegen GitHub.{checking ? " Aktualisierung läuft im Hintergrund…" : ""}
            </span>
          </>
        )}

        {/* Version Switch / Rollback Section */}
        {availableRollbackVersions.length > 0 && (
          <div className="mt-3.5 pt-3 border-t border-white/10 space-y-2">
            <span className="block text-slate-400 text-[10px] uppercase tracking-wide font-semibold">
              Version wechseln / Rollback:
            </span>
            <div className="flex items-center gap-1.5">
              <select
                value={selectedRollbackVersion}
                onChange={(e) => setSelectedRollbackVersion(e.target.value)}
                className="grow bg-slate-900 border border-slate-700/80 rounded-lg px-2 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                <option value="">Version wählen…</option>
                <option value="main">main (neuester Stand)</option>
                {availableRollbackVersions.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleTriggerRollback}
                disabled={!selectedRollbackVersion || updating}
                className="rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 border border-slate-600 px-2.5 py-1 text-[11px] font-medium transition cursor-pointer"
              >
                Rollback
              </button>
            </div>
            <p className="text-[10px] text-slate-500 leading-tight">
              Sichert die Datenbank automatisch und schaltet auf den gewählten Release-Stand um.
            </p>
          </div>
        )}
      </div>

      {updating ? (
        <span className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/95 px-6 backdrop-blur-md">
          <span className="flex w-full max-w-sm flex-col items-center rounded-2xl border border-cyan-400/20 bg-slate-900/95 p-6 text-center shadow-2xl shadow-black/70">
            <span className="h-12 w-12 animate-spin rounded-full border-4 border-slate-700 border-b-cyan-400" />
            <span className="mt-5 text-lg font-bold text-white">Vorgang läuft</span>
            <span className="mt-2 text-sm leading-relaxed text-slate-300">{updateMessage}</span>
            <span className="mt-4 text-[11px] leading-relaxed text-slate-500">
              Diese Seite geöffnet lassen. Sie lädt nach dem Neustart automatisch neu.
            </span>
          </span>
        </span>
      ) : null}
    </span>
  );
}
