"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useBodyScrollLock } from "@/lib/useBodyScrollLock";

export interface SnapshotLightboxModalProps {
  snapshot: { url: string; title: string } | null;
  onClose: () => void;
}

export function SnapshotLightboxModal({ snapshot, onClose }: SnapshotLightboxModalProps) {
  useBodyScrollLock(Boolean(snapshot));

  useEffect(() => {
    if (!snapshot) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [snapshot, onClose]);

  if (!snapshot || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-5 bg-black/85 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative max-h-[92vh] max-w-4xl w-full flex flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 p-3 sm:p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2.5 flex items-center justify-between border-b border-slate-800/80 pb-2 px-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="flex h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse shrink-0" />
            <h3 className="text-sm font-semibold text-white truncate">{snapshot.title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white transition"
            aria-label="Schließen"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-1 items-center justify-center overflow-hidden rounded-xl bg-black/90 p-1">
          <img
            src={snapshot.url}
            alt={snapshot.title || "Erkennungsschnappschuss"}
            loading="lazy"
            className="max-h-[75vh] w-auto max-w-full object-contain rounded-lg"
          />
        </div>
      </div>
    </div>,
    document.body
  );
}
