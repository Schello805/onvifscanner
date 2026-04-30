"use client";

import { useEffect, useState } from "react";

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

  const updateAvailable = Boolean(info?.updateAvailable);
  const latestVersion = info?.latestVersion;
  const updateCommand =
    info?.updateCommand ??
    "curl -fsSL https://raw.githubusercontent.com/Schello805/onvifscanner/main/scripts/debian-lxc/auto.sh | bash";

  return (
    <span className="relative inline-flex items-center gap-2 align-middle group/version">
      <span className="text-slate-400">Rev. v{props.currentVersion}</span>
      {updateAvailable ? (
        <span className="inline-flex items-center rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[11px] font-semibold text-amber-200">
          Update verfügbar
        </span>
      ) : (
        <span className="inline-flex items-center rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-200">
          aktuell
        </span>
      )}
      <span className="pointer-events-none absolute bottom-7 left-0 z-50 hidden w-80 max-w-[80vw] rounded-xl border border-white/10 bg-slate-950 p-3 text-xs leading-relaxed text-slate-200 shadow-2xl shadow-black/50 group-hover/version:block">
        {updateAvailable ? (
          <>
            <span className="block font-semibold text-amber-200">
              Neue Version verfügbar: v{latestVersion}
            </span>
            <span className="mt-1 block text-slate-300">
              Auf dem Debian-LXC aktualisieren:
            </span>
            <code className="mt-2 block break-all rounded-lg border border-white/10 bg-black/50 p-2 font-mono text-[11px] text-cyan-200">
              {updateCommand}
            </code>
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
      </span>
    </span>
  );
}
