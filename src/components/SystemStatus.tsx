"use client";

import { useEffect, useState } from "react";

type SystemUsage = {
  cpuPercent: number;
  ramPercent: number;
};

function UsageBar({ label, value }: { label: string; value: number }) {
  const color = value <= 50
    ? "bg-emerald-400"
    : value < 80
      ? "bg-orange-400"
      : "bg-rose-500";

  return (
    <div className="grid w-32 grid-cols-[2rem_1fr_2rem] items-center gap-1.5" title={`${label}-Auslastung des Servers: ${value}%`}>
      <span className="font-semibold text-slate-500">{label}</span>
      <span
        className="h-1.5 overflow-hidden rounded-full bg-slate-800 ring-1 ring-white/[0.05]"
        role="progressbar"
        aria-label={`${label}-Auslastung`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
      >
        <span
          className={`block h-full rounded-full transition-[width,background-color] duration-500 ${color}`}
          style={{ width: `${value}%` }}
        />
      </span>
      <span className="text-right tabular-nums text-slate-400">{value}%</span>
    </div>
  );
}

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
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-medium" aria-label="Systemauslastung">
      <UsageBar label="CPU" value={usage.cpuPercent} />
      <UsageBar label="RAM" value={usage.ramPercent} />
    </div>
  );
}
