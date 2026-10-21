"use client";

import { X } from "lucide-react";
import type { PlaybackState } from "./usePlaybackPage";

export function CameraPickerSheet({ pb }: { pb: PlaybackState }) {
  const { cameras, selectedCameraId, cameraPickerOpen, setCameraPickerOpen, selectCameraFilter } = pb;
  return (
    <>
      {cameraPickerOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-end overscroll-none bg-black/70 backdrop-blur-sm sm:hidden"
          role="presentation"
          onClick={() => setCameraPickerOpen(false)}
        >
          <div
            className="flex h-[72dvh] max-h-[calc(100dvh-env(safe-area-inset-top)-1rem)] w-full min-h-0 flex-col overflow-hidden rounded-t-2xl border-x border-t border-slate-700 bg-slate-950 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="camera-picker-title"
            onClick={(event) => event.stopPropagation()}
            data-pull-to-refresh-ignore="true"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-slate-800 px-4 py-3">
              <div>
                <h2 id="camera-picker-title" className="font-semibold text-white">Kamera auswählen</h2>
                <p className="mt-0.5 text-xs text-slate-400">Aufnahmen nach Kamera filtern</p>
              </div>
              <button
                type="button"
                onClick={() => setCameraPickerOpen(false)}
                className="touch-manipulation rounded-lg border border-slate-700 bg-slate-900 p-2 text-slate-300 active:bg-slate-800"
                aria-label="Kamera-Auswahl schließen"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div
              className="min-h-0 flex-1 touch-pan-y space-y-1 overflow-y-scroll overscroll-contain p-3 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
              style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}
              onTouchMove={(event) => event.stopPropagation()}
              data-pull-to-refresh-ignore="true"
            >
              <button
                type="button"
                onClick={() => selectCameraFilter("")}
                className={`flex min-h-12 w-full touch-manipulation items-center justify-between rounded-xl border px-3 py-2.5 text-left text-sm ${
                  !selectedCameraId
                    ? "border-amber-400/60 bg-amber-500/15 text-amber-100"
                    : "border-slate-800 bg-slate-900 text-slate-200 active:bg-slate-800"
                }`}
              >
                <span className="font-medium">Alle Kameras</span>
                {!selectedCameraId && <span className="text-amber-300">✓</span>}
              </button>
              {cameras.map((camera) => (
                <button
                  key={camera.id}
                  type="button"
                  onClick={() => selectCameraFilter(camera.id)}
                  className={`flex min-h-12 w-full touch-manipulation items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left text-sm ${
                    selectedCameraId === camera.id
                      ? "border-sky-400/60 bg-sky-500/15 text-sky-100"
                      : "border-slate-800 bg-slate-900 text-slate-200 active:bg-slate-800"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{camera.name}</span>
                    <span className="block truncate text-xs text-slate-500">{camera.ip}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {camera.recordEnabled && <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-rose-300">● REC</span>}
                    {selectedCameraId === camera.id && <span className="text-sky-300">✓</span>}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
