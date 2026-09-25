"use client";

import { useEffect, useRef, useState } from "react";

type VersionInfo = {
  currentVersion: string;
  latestVersion?: string;
  updateAvailable: boolean;
  updateCommand: string;
  repoUrl: string;
  error?: string;
};

export function VersionStatus(props: { currentVersion: string }) {
  const [info, setInfo] = useState<VersionInfo | null>(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function load() {
      try {
        const res = await fetch("/api/version", {
          cache: "no-store",
          signal: controller.signal
        });
        const json = (await res.json()) as VersionInfo;
        if (!cancelled) setInfo(json);
      } catch {
        if (!cancelled) setInfo(null);
      }
    }

    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

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

  const updateAvailable = Boolean(info?.updateAvailable);
  const latestVersion = info?.latestVersion;
  const updateCommand =
    info?.updateCommand ??
    "curl -fsSL https://raw.githubusercontent.com/Schello805/onvifscanner/main/scripts/debian-lxc/auto.sh | bash";

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
            <span className="mt-1.5 block text-slate-300">
              Auf dem Debian-LXC aktualisieren:
            </span>
            <div className="mt-2 flex flex-col gap-1.5">
              <code className="block select-all break-all rounded-lg border border-white/10 bg-black/60 p-2 font-mono text-[11px] text-cyan-200">
                {updateCommand}
              </code>
              <div className="flex items-center justify-between pt-1">
                <span className="text-[10px] text-slate-400">Befehl im Terminal ausführen</span>
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
        ) : (
          <>
            <span className="block font-semibold text-emerald-200">
              Installation ist aktuell.
            </span>
            <span className="mt-1 block text-slate-400">
              Geprüft gegen GitHub{info?.error ? `, Check aktuell nicht möglich: ${info.error}` : "."}
            </span>
          </>
        )}
      </div>
    </span>
  );
}
