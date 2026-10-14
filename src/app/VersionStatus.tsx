"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

type VersionInfo = {
  currentVersion: string;
  latestVersion?: string;
  updateAvailable: boolean;
  updateCommand: string;
  repoUrl: string;
  error?: string;
  checkedAt?: string;
};

const VERSION_CACHE_KEY = "onvifscanner.version-status.v1";

export function VersionStatus(props: { currentVersion: string }) {
  const pathname = usePathname();
  const [info, setInfo] = useState<VersionInfo | null>(null);
  const [checking, setChecking] = useState(true);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
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

  const [updating, setUpdating] = useState(false);
  const [updateMessage, setUpdateMessage] = useState("");

  async function waitForUpdatedServer(controller: AbortController) {
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

        if (versionChanged) {
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
          setUpdateMessage("Update wird vorbereitet und gebaut…");
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
      setUpdateMessage("Das Update dauert ungewöhnlich lange. Bitte Status oder Terminal-Log prüfen.");
    }
  }

  async function handleUpdate(e: React.MouseEvent) {
    e.stopPropagation();
    setUpdating(true);
    setUpdateMessage("Update startet...");
    try {
      const res = await fetch("/api/update", {
        method: "POST",
        cache: "no-store",
        keepalive: true,
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setUpdateMessage(data.alreadyRunning ? "Update läuft bereits…" : "Update gestartet…");
        setOpen(false);
        updateMonitorRef.current?.abort();
        const controller = new AbortController();
        updateMonitorRef.current = controller;
        void waitForUpdatedServer(controller);
      } else {
        setUpdateMessage(data.error || `Update konnte nicht gestartet werden (HTTP ${res.status}).`);
        setUpdating(false);
      }
    } catch {
      setUpdateMessage("Update-Dienst ist nicht erreichbar.");
      setUpdating(false);
    }
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
      <span className="text-slate-400">Rev. v{props.currentVersion}</span>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="cursor-pointer focus:outline-none focus:ring-1 focus:ring-white/20 rounded-full"
        title="Klicken für Update-Details"
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

      {/* Floating Popup:
          - pointer-events-auto ensures the user can hover, click, select and copy text
          - Invisible bridge at the bottom prevents mouseleave when moving cursor from badge into popup
          - Stays open on click (open state) or on hover
      */}
      <div
        className={`pointer-events-auto absolute bottom-full left-0 mb-2 z-50 w-80 max-w-[85vw] rounded-xl border border-white/15 bg-slate-950/95 p-3.5 text-xs leading-relaxed text-slate-200 shadow-2xl shadow-black/80 backdrop-blur-md transition-all ${
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

            <span className="mt-4 block text-slate-400 text-[10px] uppercase tracking-wide font-semibold">
              Oder manuell im Terminal:
            </span>
            <div className="mt-1 flex flex-col gap-1.5">
              <code className="block select-all break-all rounded-lg border border-white/10 bg-black/60 p-2 font-mono text-[11px] text-cyan-200">
                {updateCommand}
              </code>
              <div className="flex items-center justify-end pt-1">
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
              Installation ist aktuell.
            </span>
            <span className="mt-1 block text-slate-400">
              Geprüft gegen GitHub.{checking ? " Aktualisierung läuft im Hintergrund…" : ""}
            </span>
          </>
        )}
      </div>
      {updating ? (
        <span className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/95 px-6 backdrop-blur-md">
          <span className="flex w-full max-w-sm flex-col items-center rounded-2xl border border-cyan-400/20 bg-slate-900/95 p-6 text-center shadow-2xl shadow-black/70">
            <span className="h-12 w-12 animate-spin rounded-full border-4 border-slate-700 border-b-cyan-400" />
            <span className="mt-5 text-lg font-bold text-white">Update läuft</span>
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
