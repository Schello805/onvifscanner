"use client";

import { useEffect, useState } from "react";

type SystemUsage = {
  cpuPercent: number;
  ramPercent: number;
};

export function SystemStatus() {
  const [usage, setUsage] = useState<SystemUsage | null>(null);

  useEffect(() => {
    let cancelled = false;
    let controller: AbortController | null = null;

    async function refresh() {
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch("/api/system", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) return;
        const data = await response.json() as SystemUsage;
        if (!cancelled) setUsage(data);
      } catch {
        // The footer remains usable if system metrics are unavailable.
      }
    }

    void refresh();
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => {
      cancelled = true;
      controller?.abort();
      window.clearInterval(timer);
    };
  }, []);

  if (!usage) return null;

  return (
    <div className="mt-1.5 flex items-center gap-2 text-[10px] font-medium text-slate-500" aria-label="Systemauslastung">
      <span className="inline-flex items-center gap-1 rounded-full border border-white/[0.07] bg-white/[0.03] px-2 py-0.5" title="CPU-Auslastung des Servers">
        <span className="h-1.5 w-1.5 rounded-full bg-sky-400/70" />
        CPU {usage.cpuPercent}%
      </span>
      <span className="inline-flex items-center gap-1 rounded-full border border-white/[0.07] bg-white/[0.03] px-2 py-0.5" title="RAM-Auslastung des Servers">
        <span className="h-1.5 w-1.5 rounded-full bg-violet-400/70" />
        RAM {usage.ramPercent}%
      </span>
    </div>
  );
}
