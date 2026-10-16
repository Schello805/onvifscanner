"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import type { WallCamera } from "@/lib/cameraWall";
import {
  type RecordingMode,
  recordingModeUsesContinuous,
  recordingModeUsesMotion,
  recordingModeUsesSchedule,
  RECORDING_MODE_OPTIONS,
} from "@/lib/recordingPolicy";
import { MotionMaskEditor, type MotionRegion } from "./MotionMaskEditor";

export type CameraEditDraft = {
  name: string;
  snapshotUris: string;
  streamUris: string;
  username: string;
  password: string;
  group: string;
  overlayPosition: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  recordEnabled: boolean;
  recordMode: RecordingMode;
  recordSegmentMinutes: number;
  motionPreRollSeconds: number;
  motionPostRollSeconds: number;
  motionSensitivity: number;
  motionIgnoreRegions: MotionRegion[];
  objectDetectionEnabled: boolean;
  objectDetectionClasses: string[];
  objectMinConfidence: number;
  licensePlateRecognitionEnabled: boolean;
  motionScheduleEnabled: boolean;
  motionScheduleStart: string;
  motionScheduleEnd: string;
  motionScheduleDays: number[];
  motionScheduleSensitivity: number;
  notificationsEnabled: boolean;
  storageTargetId: string;
};

type StorageTargetOption = {
  id: string;
  name: string;
  isDefault?: boolean;
};

type CameraEditModalProps = {
  camera: WallCamera;
  editDraft: CameraEditDraft;
  storageTargets: StorageTargetOption[];
  activeSourceUri?: string;
  previewImageSrc?: string;
  onUpdateDraft: (draft: CameraEditDraft) => void;
  onSave: () => void;
  onClose: () => void;
  onRemove: (cameraId: string) => void;
};

export function CameraEditModal({
  camera,
  editDraft,
  storageTargets,
  activeSourceUri,
  previewImageSrc,
  onUpdateDraft,
  onSave,
  onClose,
  onRemove,
}: CameraEditModalProps) {
  const [showPassword, setShowPassword] = useState(false);

  return createPortal(
    <div
      data-pull-to-refresh-ignore="true"
      className="fixed inset-0 z-[100010] flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="camera-edit-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
        className="relative flex max-h-[calc(100dvh-1.5rem)] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-slate-950 shadow-2xl animate-in fade-in zoom-in-95 duration-150 lg:max-w-4xl"
      >
        {/* Sticky Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-5 py-3.5 bg-slate-900/80">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 id="camera-edit-title" className="text-base sm:text-lg font-bold text-white truncate">
                Kamera bearbeiten
              </h2>
              {camera.resolution && (
                <span className="shrink-0 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-1.5 py-0.5 text-[10px] font-mono">
                  {camera.resolution}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-mono text-xs text-slate-400">{camera.ip}</p>
              <a
                href={`http://${camera.ip}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-md border border-cyan-500/25 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-semibold text-cyan-300 hover:bg-cyan-500/20 hover:text-cyan-100"
              >
                Kamera-UI öffnen ↗
              </a>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
            aria-label="Schließen"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable Body */}
        <div
          data-camera-editor-scroll="true"
          className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-5 py-4 space-y-4 text-xs"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5">
              <span className="font-semibold text-slate-300">Anzeigename</span>
              <input
                value={editDraft.name}
                onChange={(event) => onUpdateDraft({ ...editDraft, name: event.target.value })}
                className="glass-input rounded-lg px-3 py-2 text-sm outline-none"
              />
            </label>
            <label className="grid gap-1.5">
              <span className="font-semibold text-slate-300">Gruppe (z. B. Garten, Haus)</span>
              <input
                value={editDraft.group}
                onChange={(event) => onUpdateDraft({ ...editDraft, group: event.target.value })}
                className="glass-input rounded-lg px-3 py-2 text-sm outline-none"
                placeholder="Ungruppiert"
              />
            </label>
          </div>

          <label className="grid gap-1.5">
            <span className="font-semibold text-slate-300">
              Snapshot-URLs <span className="font-normal text-slate-500">(erste erreichbare URL wird genutzt)</span>
            </span>
            <textarea
              value={editDraft.snapshotUris}
              onChange={(event) => onUpdateDraft({ ...editDraft, snapshotUris: event.target.value })}
              rows={2}
              spellCheck={false}
              className="glass-input resize-y rounded-lg px-3 py-2 font-mono text-xs outline-none"
              placeholder="http://192.168.1.10/snapshot.jpg"
            />
          </label>

          {activeSourceUri ? (
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
              <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                Aktive Bild-Quelle
              </div>
              <div className="mt-0.5 break-all font-mono text-[11px] text-slate-300">
                {activeSourceUri}
              </div>
            </div>
          ) : null}

          <label className="grid gap-1.5">
            <span className="font-semibold text-slate-300">
              Stream-URLs <span className="font-normal text-slate-500">(RTSP-Stream für Live & NVR)</span>
            </span>
            <textarea
              value={editDraft.streamUris}
              onChange={(event) => onUpdateDraft({ ...editDraft, streamUris: event.target.value })}
              rows={2}
              spellCheck={false}
              className="glass-input resize-y rounded-lg px-3 py-2 font-mono text-xs outline-none"
              placeholder="rtsp://192.168.1.10/stream"
            />
          </label>

          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
            <div className="mb-2.5">
              <div className="font-semibold text-slate-200">Zugangsdaten</div>
              <div className="text-[11px] text-amber-200/70">
                Werden lokal auf diesem Server gespeichert.
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1">
                <span className="text-slate-400">Benutzername</span>
                <input
                  value={editDraft.username}
                  onChange={(event) => onUpdateDraft({ ...editDraft, username: event.target.value })}
                  autoComplete="username"
                  className="glass-input rounded-lg px-3 py-1.5 text-xs outline-none"
                />
              </label>
              <label className="grid gap-1">
                <span className="text-slate-400">Passwort</span>
                <div className="flex rounded-lg border border-white/10 bg-white/5 focus-within:border-indigo-500/50">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={editDraft.password}
                    onChange={(event) => onUpdateDraft({ ...editDraft, password: event.target.value })}
                    autoComplete="current-password"
                    className="min-w-0 flex-1 bg-transparent px-3 py-1.5 text-xs text-white outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="px-2 text-[10px] font-semibold text-indigo-300 hover:text-white"
                  >
                    {showPassword ? "Verbergen" : "Anzeigen"}
                  </button>
                </div>
              </label>
            </div>
          </div>

          <div className="grid gap-3">
            <label className="grid gap-1.5">
              <span className="font-semibold text-slate-300">Name im Bild (Overlay)</span>
              <select
                value={editDraft.overlayPosition}
                onChange={(event) =>
                  onUpdateDraft({
                    ...editDraft,
                    overlayPosition: event.target.value as CameraEditDraft["overlayPosition"],
                  })
                }
                className="glass-input rounded-lg px-3 py-2 text-xs outline-none bg-slate-900"
              >
                <option value="top-left">Oben Links</option>
                <option value="top-right">Oben Rechts</option>
                <option value="bottom-left">Unten Links</option>
                <option value="bottom-right">Unten Rechts</option>
              </select>
            </label>

            <div className="rounded-xl border border-rose-500/30 bg-rose-950/20 p-3 flex flex-col gap-2.5">
              <label className="grid gap-1.5">
                <span className="font-semibold text-white text-xs">Aufnahme-Strategie</span>
                <select
                  value={editDraft.recordMode}
                  onChange={(event) => {
                    const recordMode = event.target.value as RecordingMode;
                    onUpdateDraft({
                      ...editDraft,
                      recordMode,
                      recordEnabled: recordMode !== "off",
                      motionScheduleEnabled: recordingModeUsesSchedule(recordMode),
                    });
                  }}
                  className="glass-input rounded-lg bg-slate-900 px-2.5 py-2 text-xs text-white outline-none"
                >
                  {RECORDING_MODE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <span className="text-[10px] leading-relaxed text-slate-400">
                  {RECORDING_MODE_OPTIONS.find((option) => option.value === editDraft.recordMode)?.description}
                </span>
              </label>

              {editDraft.recordEnabled && (
                <div className="grid gap-2 sm:grid-cols-2 pt-2 border-t border-rose-500/20 text-xs">
                  <label className="grid gap-1">
                    <span className="text-slate-400 text-[11px]">Speicherziel:</span>
                    <select
                      value={editDraft.storageTargetId}
                      onChange={(e) => onUpdateDraft({ ...editDraft, storageTargetId: e.target.value })}
                      className="glass-input rounded-lg px-2.5 py-1.5 text-xs outline-none bg-slate-900 text-white"
                    >
                      <option value="">Standard-Speicherziel</option>
                      {storageTargets.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} {t.isDefault ? "(Standard)" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  {recordingModeUsesSchedule(editDraft.recordMode) ? (
                    <div className="sm:col-span-2 rounded-xl border border-violet-500/25 bg-violet-950/15 p-3 space-y-3">
                      <div>
                        <strong className="block text-xs text-white">Zeitfenster</strong>
                        <span className="block text-[10px] leading-relaxed text-slate-400">
                          Die gewählte Aufnahme-Strategie wechselt an diesen Tagen automatisch am Anfang und Ende des Zeitfensters.
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 border-t border-violet-500/15 pt-3">
                        <label className="grid gap-1 text-[10px] text-slate-400">
                          Von
                          <input
                            type="time"
                            value={editDraft.motionScheduleStart}
                            onChange={(event) =>
                              onUpdateDraft({ ...editDraft, motionScheduleStart: event.target.value })
                            }
                            className="glass-input rounded-lg px-2 py-1.5 text-xs text-white"
                          />
                        </label>
                        <label className="grid gap-1 text-[10px] text-slate-400">
                          Bis
                          <input
                            type="time"
                            value={editDraft.motionScheduleEnd}
                            onChange={(event) =>
                              onUpdateDraft({ ...editDraft, motionScheduleEnd: event.target.value })
                            }
                            className="glass-input rounded-lg px-2 py-1.5 text-xs text-white"
                          />
                        </label>
                      </div>
                      <div className="grid grid-cols-7 gap-1">
                        {["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"].map((label, day) => (
                          <button
                            key={label}
                            type="button"
                            onClick={() =>
                              onUpdateDraft({
                                ...editDraft,
                                motionScheduleDays: editDraft.motionScheduleDays.includes(day)
                                  ? editDraft.motionScheduleDays.filter((entry) => entry !== day)
                                  : [...editDraft.motionScheduleDays, day].sort(),
                              })
                            }
                            className={`rounded-md border px-1 py-1.5 text-[9px] font-semibold ${
                              editDraft.motionScheduleDays.includes(day)
                                ? "border-violet-400 bg-violet-500/25 text-violet-200"
                                : "border-white/10 bg-slate-950/60 text-slate-500"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      {recordingModeUsesMotion(editDraft.recordMode) ? (
                        <label className="grid gap-1">
                          <span className="flex justify-between text-[11px] text-slate-400">
                            <span>Empfindlichkeit im Zeitfenster</span>
                            <strong className="text-violet-300">{editDraft.motionScheduleSensitivity}%</strong>
                          </span>
                          <input
                            type="range"
                            min={1}
                            max={100}
                            value={editDraft.motionScheduleSensitivity}
                            onInput={(event) =>
                              onUpdateDraft({
                                ...editDraft,
                                motionScheduleSensitivity: Number(event.currentTarget.value),
                              })
                            }
                            className="range range-secondary range-sm"
                          />
                        </label>
                      ) : null}
                    </div>
                  ) : null}
                  {recordingModeUsesMotion(editDraft.recordMode) && (
                    <>
                      <label className="grid gap-1 sm:col-span-2">
                        <span className="flex items-center justify-between text-slate-400 text-[11px]">
                          <span>Bewegungsempfindlichkeit:</span>
                          <strong className="text-amber-300">{editDraft.motionSensitivity}%</strong>
                        </span>
                        <input
                          type="range"
                          min={1}
                          max={100}
                          step={1}
                          value={editDraft.motionSensitivity}
                          onInput={(event) =>
                            onUpdateDraft({ ...editDraft, motionSensitivity: Number(event.currentTarget.value) })
                          }
                          onPointerDown={(event) => {
                            try {
                              event.currentTarget.setPointerCapture(event.pointerId);
                            } catch {}
                          }}
                          draggable={false}
                          className="motion-sensitivity-range range range-warning range-sm sm:range-xs"
                          aria-label="Bewegungsempfindlichkeit"
                        />
                        <span className="flex justify-between text-[9px] text-slate-500">
                          <span>Weniger Fehlalarme</span>
                          <span>Erkennt kleinere Bewegungen</span>
                        </span>
                      </label>
                      <div className="sm:col-span-2">
                        <MotionMaskEditor
                          imageSrc={previewImageSrc}
                          regions={editDraft.motionIgnoreRegions}
                          onChange={(motionIgnoreRegions) =>
                            onUpdateDraft({ ...editDraft, motionIgnoreRegions })
                          }
                        />
                      </div>
                      <div className="sm:col-span-2 rounded-xl border border-cyan-500/25 bg-cyan-950/15 p-3 space-y-3">
                        <label className="flex cursor-pointer items-start gap-2.5">
                          <input
                            type="checkbox"
                            checked={editDraft.objectDetectionEnabled}
                            onChange={(event) =>
                              onUpdateDraft({ ...editDraft, objectDetectionEnabled: event.target.checked })
                            }
                            className="mt-0.5 rounded border-slate-700 bg-slate-900 text-cyan-500 focus:ring-0"
                          />
                          <span>
                            <strong className="block text-xs text-white">Lokale KI-Objekterkennung</strong>
                            <span className="block text-[10px] leading-relaxed text-slate-400">
                              Nur Bewegungen mit den ausgewählten Objektarten erzeugen Ereignisse. Schlägt die Prüfung fehl, wird kein ungefilterter Alarm ausgelöst.
                            </span>
                          </span>
                        </label>
                        {editDraft.objectDetectionEnabled && (
                          <div className="space-y-3 border-t border-cyan-500/15 pt-3">
                            <div className="grid grid-cols-3 gap-2">
                              {(
                                [
                                  ["person", "Personen"],
                                  ["vehicle", "Fahrzeuge/Fahrräder"],
                                  ["animal", "Tiere"],
                                ] as const
                              ).map(([value, label]) => (
                                <label
                                  key={value}
                                  className="flex min-w-0 cursor-pointer items-center gap-1.5 rounded-lg border border-white/10 bg-slate-950/60 px-2 py-2"
                                >
                                  <input
                                    type="checkbox"
                                    checked={editDraft.objectDetectionClasses.includes(value)}
                                    onChange={(event) =>
                                      onUpdateDraft({
                                        ...editDraft,
                                        objectDetectionClasses: event.target.checked
                                          ? Array.from(new Set([...editDraft.objectDetectionClasses, value]))
                                          : editDraft.objectDetectionClasses.filter((entry) => entry !== value),
                                      })
                                    }
                                    className="rounded border-slate-700 bg-slate-900 text-cyan-500 focus:ring-0"
                                  />
                                  <span className="truncate text-[10px] text-slate-300">{label}</span>
                                </label>
                              ))}
                            </div>
                            <label className="grid gap-1">
                              <span className="flex justify-between text-[11px] text-slate-400">
                                <span>Mindest-Sicherheit</span>
                                <strong className="text-cyan-300">{editDraft.objectMinConfidence}%</strong>
                              </span>
                              <input
                                type="range"
                                min={20}
                                max={95}
                                value={editDraft.objectMinConfidence}
                                onInput={(event) =>
                                  onUpdateDraft({
                                    ...editDraft,
                                    objectMinConfidence: Number(event.currentTarget.value),
                                  })
                                }
                                className="range range-info range-sm"
                              />
                            </label>
                          </div>
                        )}
                      </div>
                      <div className="sm:col-span-2 rounded-xl border border-amber-500/25 bg-amber-950/15 p-3">
                        <label className="flex cursor-pointer items-start gap-2.5">
                          <input
                            type="checkbox"
                            checked={editDraft.licensePlateRecognitionEnabled}
                            onChange={(event) =>
                              onUpdateDraft({
                                ...editDraft,
                                licensePlateRecognitionEnabled: event.target.checked,
                              })
                            }
                            className="mt-0.5 rounded border-slate-700 bg-slate-900 text-amber-500 focus:ring-0"
                          />
                          <span>
                            <strong className="block text-xs text-white">Fahrzeuge und Kennzeichen lokal erkennen</strong>
                            <span className="block text-[10px] leading-relaxed text-slate-400">
                              Prüft bestätigte Bewegungen auf Fahrzeuge und liest sichtbare Kennzeichen lokal per OCR aus. Rot maskierte Bildbereiche werden dabei ebenfalls ignoriert.
                            </span>
                          </span>
                        </label>
                      </div>
                      <label className="grid gap-1">
                        <span className="text-slate-400 text-[11px]">Vorlauf:</span>
                        <select
                          value={editDraft.motionPreRollSeconds}
                          onChange={(e) =>
                            onUpdateDraft({ ...editDraft, motionPreRollSeconds: Number(e.target.value) })
                          }
                          className="glass-input rounded-lg px-2.5 py-1.5 text-xs bg-slate-900 text-white"
                        >
                          {[0, 5, 10, 15, 30].map((seconds) => (
                            <option key={seconds} value={seconds}>
                              {seconds} Sekunden
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="grid gap-1">
                        <span className="text-slate-400 text-[11px]">Nachlauf:</span>
                        <select
                          value={editDraft.motionPostRollSeconds}
                          onChange={(e) =>
                            onUpdateDraft({ ...editDraft, motionPostRollSeconds: Number(e.target.value) })
                          }
                          className="glass-input rounded-lg px-2.5 py-1.5 text-xs bg-slate-900 text-white"
                        >
                          {[10, 20, 30, 60, 120].map((seconds) => (
                            <option key={seconds} value={seconds}>
                              {seconds} Sekunden
                            </option>
                          ))}
                        </select>
                      </label>
                    </>
                  )}

                  {recordingModeUsesContinuous(editDraft.recordMode) && (
                    <label className="grid gap-1">
                      <span className="text-slate-400 text-[11px]">Segmentlänge:</span>
                      <select
                        value={editDraft.recordSegmentMinutes}
                        onChange={(e) =>
                          onUpdateDraft({ ...editDraft, recordSegmentMinutes: Number(e.target.value) || 15 })
                        }
                        className="glass-input rounded-lg px-2.5 py-1.5 text-xs outline-none bg-slate-900 text-white"
                      >
                        <option value={5}>5 Minuten</option>
                        <option value={15}>15 Minuten (Standard)</option>
                        <option value={30}>30 Minuten</option>
                        <option value={60}>60 Minuten</option>
                      </select>
                    </label>
                  )}
                </div>
              )}
            </div>

            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-3">
              <div className="min-w-0">
                <span className="block text-xs font-semibold text-white">Push-Benachrichtigung</span>
                <span className="block text-[10px] leading-relaxed text-slate-400">
                  Meldet Bewegungen dieser Kamera mit aktuellem Bild über Telegram oder ntfy.
                </span>
              </div>
              <input
                type="checkbox"
                checked={editDraft.notificationsEnabled}
                onChange={(event) =>
                  onUpdateDraft({ ...editDraft, notificationsEnabled: event.target.checked })
                }
                className="toggle toggle-success toggle-sm shrink-0"
                aria-label="Push-Benachrichtigungen für diese Kamera aktivieren"
              />
            </label>
          </div>
        </div>

        {/* Sticky Footer */}
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-t border-white/10 px-5 py-3.5 bg-slate-900/80">
          <button
            type="button"
            onClick={() => {
              if (confirm(`Möchtest du "${editDraft.name}" wirklich von den Monitoren entfernen?`)) {
                onRemove(camera.id);
                onClose();
              }
            }}
            className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2 text-xs font-semibold text-rose-300 hover:bg-rose-500/20 active:scale-95 transition-all text-left sm:text-center"
          >
            🗑 Von den Monitoren entfernen
          </button>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-white/10 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-white/5 transition-colors"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500 shadow-lg shadow-indigo-600/30 transition-all"
            >
              Speichern & Bild testen
            </button>
          </div>
        </div>
      </form>
    </div>,
    document.body
  );
}
