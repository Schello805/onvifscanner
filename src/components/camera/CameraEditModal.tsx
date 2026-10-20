"use client";

import { useState, useRef, useEffect, useMemo } from "react";
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
import {
  Car,
  Check,
  ChevronDown,
  Cpu,
  Folder,
  Paintbrush,
  Pencil,
  Plus,
  Sliders,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { KnownEntitiesModal } from "./KnownEntitiesModal";

export type ExistingGroup = {
  name: string;
  count: number;
};

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
  alarmCooldownSeconds: number;
  motionMinAreaPercent?: number | null;
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
  existingGroups?: ExistingGroup[];
  storageTargets: StorageTargetOption[];
  activeSourceUri?: string;
  previewImageSrc?: string;
  onUpdateDraft: (draft: CameraEditDraft) => void;
  onSave: () => void;
  onClose: () => void;
  onRemove: (cameraId: string) => void;
  onTriggerRenameGroup?: (groupName: string) => void;
  onTriggerDeleteGroup?: (groupName: string) => void;
};

type SectionKey = "general" | "recording" | "ai" | "mask";

export function CameraEditModal({
  camera,
  editDraft,
  existingGroups = [],
  storageTargets,
  activeSourceUri,
  previewImageSrc,
  onUpdateDraft,
  onSave,
  onClose,
  onRemove,
  onTriggerRenameGroup,
  onTriggerDeleteGroup,
}: CameraEditModalProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [isKnownEntitiesOpen, setIsKnownEntitiesOpen] = useState(false);
  const [isGroupDropdownOpen, setIsGroupDropdownOpen] = useState(false);
  const groupDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isGroupDropdownOpen) return;
    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (
        groupDropdownRef.current &&
        !groupDropdownRef.current.contains(event.target as Node)
      ) {
        setIsGroupDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [isGroupDropdownOpen]);

  const currentGroupQuery = (editDraft.group || "").trim().toLowerCase();
  const filteredGroups = useMemo(() => {
    if (!currentGroupQuery) return existingGroups;
    return existingGroups.filter((g) =>
      g.name.toLowerCase().includes(currentGroupQuery)
    );
  }, [existingGroups, currentGroupQuery]);

  const hasExactGroupMatch = existingGroups.some(
    (g) => g.name.toLowerCase() === currentGroupQuery
  );

  const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>({
    general: true,
    recording: false,
    ai: false,
    mask: false,
  });

  const toggleSection = (key: SectionKey) => {
    setOpenSections((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const toggleAll = (expand: boolean) => {
    setOpenSections({
      general: expand,
      recording: expand,
      ai: expand,
      mask: expand,
    });
  };

  const currentRecordModeOption = RECORDING_MODE_OPTIONS.find(
    (option) => option.value === editDraft.recordMode
  );

  return (
    <>
      {createPortal(
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

            {/* Scrollable Body with Accordions */}
            <div
              data-camera-editor-scroll="true"
              className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-4 sm:px-6 py-4 space-y-3 text-xs"
            >
              {/* Quick Accordion Toolbar */}
              <div className="flex items-center justify-between pb-1 text-[11px] text-slate-400">
                <span className="font-medium text-slate-300">Konfigurationsbereiche</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggleAll(true)}
                    className="text-indigo-400 hover:text-indigo-300 font-medium transition-colors"
                  >
                    Alle aufklappen
                  </button>
                  <span className="text-slate-600">•</span>
                  <button
                    type="button"
                    onClick={() => toggleAll(false)}
                    className="text-slate-400 hover:text-slate-300 font-medium transition-colors"
                  >
                    Alle zuklappen
                  </button>
                </div>
              </div>

              {/* 1. ALLGEMEIN & VERBINDUNG */}
              <div
                className={`rounded-xl border border-white/10 bg-slate-900/60 backdrop-blur-sm transition-all duration-200 ${
                  openSections.general ? "overflow-visible" : "overflow-hidden"
                }`}
              >
                <button
                  type="button"
                  onClick={() => toggleSection("general")}
                  className={`flex w-full items-center justify-between gap-3 p-3.5 text-left hover:bg-white/[0.04] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-500 rounded-t-xl ${
                    !openSections.general ? "rounded-b-xl" : ""
                  }`}
                  aria-expanded={openSections.general}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                      <Sliders className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-200 text-sm">Allgemein & Verbindungsdaten</div>
                      <p className="text-[11px] text-slate-400 truncate">
                        {editDraft.name || camera.name || "Kamera"}
                        {editDraft.group ? ` • Gruppe: ${editDraft.group}` : " • Ungruppiert"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {editDraft.streamUris ? (
                      <span className="hidden sm:inline-block rounded-md bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 text-[10px] text-indigo-300 font-mono">
                        RTSP konfiguriert
                      </span>
                    ) : null}
                    <ChevronDown
                      className={`h-4 w-4 text-slate-400 transition-transform duration-200 ${
                        openSections.general ? "rotate-180 text-white" : ""
                      }`}
                    />
                  </div>
                </button>

                {openSections.general && (
                  <div className="border-t border-white/10 p-4 space-y-4 animate-in fade-in-50 duration-150">
                    <div className="grid gap-3 sm:grid-cols-2 items-start">
                      <label className="flex flex-col gap-1.5">
                        <div className="flex items-center min-h-[22px]">
                          <span className="font-semibold text-slate-300">Anzeigename</span>
                        </div>
                        <input
                          value={editDraft.name}
                          onChange={(event) => onUpdateDraft({ ...editDraft, name: event.target.value })}
                          className="glass-input h-10 w-full rounded-lg px-3 py-2 text-sm outline-none"
                        />
                      </label>
                      <div className="flex flex-col gap-1.5 relative" ref={groupDropdownRef}>
                        <div className="flex items-center justify-between min-h-[22px]">
                          <label htmlFor="camera-group-input" className="font-semibold text-slate-300 cursor-pointer">
                            Gruppe (z. B. Garten, Haus)
                          </label>
                          {editDraft.group ? (
                            <button
                              type="button"
                              onClick={() => onUpdateDraft({ ...editDraft, group: "" })}
                              className="text-[11px] text-slate-400 hover:text-rose-300 transition-colors"
                            >
                              Gruppe leeren
                            </button>
                          ) : null}
                        </div>

                        <div className="relative">
                          <input
                            id="camera-group-input"
                            value={editDraft.group}
                            onChange={(event) => {
                              onUpdateDraft({ ...editDraft, group: event.target.value });
                              if (!isGroupDropdownOpen) setIsGroupDropdownOpen(true);
                            }}
                            onFocus={() => setIsGroupDropdownOpen(true)}
                            onClick={() => setIsGroupDropdownOpen(true)}
                            onKeyDown={(event) => {
                              if (event.key === "Escape") {
                                setIsGroupDropdownOpen(false);
                              }
                            }}
                            className="glass-input h-10 w-full rounded-lg pl-3 pr-9 py-2 text-sm outline-none"
                            placeholder="Ungruppiert"
                            autoComplete="off"
                          />
                          <button
                            type="button"
                            onClick={() => setIsGroupDropdownOpen((prev) => !prev)}
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-200 transition-colors rounded-md"
                            aria-label="Gruppenliste aufklappen"
                            tabIndex={-1}
                          >
                            <ChevronDown
                              className={`h-4 w-4 transition-transform duration-200 ${
                                isGroupDropdownOpen ? "rotate-180 text-cyan-400" : ""
                              }`}
                            />
                          </button>
                        </div>

                        {/* Dropdown Menu */}
                        {isGroupDropdownOpen && (
                          <div
                            className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 rounded-xl border border-white/20 bg-slate-900/95 p-1.5 shadow-2xl backdrop-blur-xl animate-in fade-in-50 slide-in-from-top-1 duration-150 max-h-60 overflow-y-auto"
                            role="listbox"
                          >
                            {existingGroups.length > 0 ? (
                              <>
                                <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                                  Bestehende Gruppen
                                </div>
                                {filteredGroups.length > 0 ? (
                                  filteredGroups.map((g) => {
                                    const isSelected =
                                      editDraft.group?.trim().toLowerCase() === g.name.toLowerCase();
                                    return (
                                      <div
                                        key={g.name}
                                        className={`w-full flex items-center justify-between rounded-lg px-2 py-1.5 transition-colors ${
                                          isSelected
                                            ? "bg-cyan-500/20 text-cyan-300 font-medium"
                                            : "text-slate-200 hover:bg-white/10"
                                        }`}
                                      >
                                        <button
                                          type="button"
                                          onClick={() => {
                                            onUpdateDraft({ ...editDraft, group: g.name });
                                            setIsGroupDropdownOpen(false);
                                          }}
                                          className="flex-1 flex items-center gap-2 min-w-0 text-left py-0.5"
                                        >
                                          <Folder
                                            className={`h-4 w-4 shrink-0 ${
                                              isSelected ? "text-cyan-400" : "text-slate-400"
                                            }`}
                                          />
                                          <span className="truncate">{g.name}</span>
                                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-slate-400 shrink-0 ml-1">
                                            {g.count}
                                          </span>
                                          {isSelected && <Check className="h-3.5 w-3.5 text-cyan-400 shrink-0 ml-auto mr-1" />}
                                        </button>

                                        {(onTriggerRenameGroup || onTriggerDeleteGroup) && (
                                          <div className="flex items-center gap-0.5 shrink-0 ml-1 pl-1.5 border-l border-white/10">
                                            {onTriggerRenameGroup && (
                                              <button
                                                type="button"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setIsGroupDropdownOpen(false);
                                                  onTriggerRenameGroup(g.name);
                                                }}
                                                className="p-1 rounded text-slate-400 hover:text-cyan-300 hover:bg-white/10 transition-colors"
                                                title={`Gruppe „${g.name}“ umbenennen`}
                                              >
                                                <Pencil className="h-3.5 w-3.5" />
                                              </button>
                                            )}
                                            {onTriggerDeleteGroup && (
                                              <button
                                                type="button"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setIsGroupDropdownOpen(false);
                                                  onTriggerDeleteGroup(g.name);
                                                }}
                                                className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                                                title={`Gruppe „${g.name}“ löschen`}
                                              >
                                                <Trash2 className="h-3.5 w-3.5" />
                                              </button>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })
                                ) : (
                                  <div className="px-3 py-2 text-xs text-slate-400 italic">
                                    Keine passende Gruppe gefunden.
                                  </div>
                                )}

                                {editDraft.group.trim() !== "" && !hasExactGroupMatch && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setIsGroupDropdownOpen(false);
                                    }}
                                    className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-cyan-400 hover:bg-cyan-500/10 active:bg-cyan-500/20 text-left border-t border-white/10 mt-1"
                                  >
                                    <Plus className="h-4 w-4 shrink-0" />
                                    <span className="truncate">
                                      &quot;{editDraft.group.trim()}&quot; als neue Gruppe verwenden
                                    </span>
                                  </button>
                                )}

                                {editDraft.group && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      onUpdateDraft({ ...editDraft, group: "" });
                                      setIsGroupDropdownOpen(false);
                                    }}
                                    className="w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-slate-400 hover:text-rose-300 hover:bg-rose-500/10 text-left transition-colors border-t border-white/5 mt-1"
                                  >
                                    <X className="h-3.5 w-3.5 shrink-0" />
                                    <span>Keine Gruppe (Ungruppiert)</span>
                                  </button>
                                )}
                              </>
                            ) : (
                              <div className="px-3 py-3 text-center text-xs text-slate-400">
                                Noch keine Gruppen vorhanden. Tippe einen Namen ein (z. B. &quot;Garten&quot;), um die erste Gruppe anzulegen.
                              </div>
                            )}
                          </div>
                        )}

                        {/* Quick Selection Chips */}
                        {existingGroups && existingGroups.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5 pt-1">
                            <span className="text-[11px] text-slate-400 mr-0.5">Vorschläge:</span>
                            {existingGroups.slice(0, 6).map((g) => {
                              const isSelected =
                                editDraft.group?.trim().toLowerCase() === g.name.toLowerCase();
                              return (
                                <button
                                  key={g.name}
                                  type="button"
                                  onClick={() => {
                                    onUpdateDraft({ ...editDraft, group: isSelected ? "" : g.name });
                                    setIsGroupDropdownOpen(false);
                                  }}
                                  className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-md border transition-all ${
                                    isSelected
                                      ? "bg-cyan-500/20 border-cyan-400/50 text-cyan-300 font-medium"
                                      : "bg-white/5 border-white/10 text-slate-300 hover:bg-white/10 hover:border-white/20 active:scale-95"
                                  }`}
                                >
                                  <span>{g.name}</span>
                                  <span className="text-[10px] opacity-60">({g.count})</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
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
                  </div>
                )}
              </div>

              {/* 2. AUFNAHME & NVR-STRATEGIE */}
              <div className="overflow-hidden rounded-xl border border-white/10 bg-slate-900/60 backdrop-blur-sm transition-all duration-200">
                <button
                  type="button"
                  onClick={() => toggleSection("recording")}
                  className="flex w-full items-center justify-between gap-3 p-3.5 text-left hover:bg-white/[0.04] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-rose-500"
                  aria-expanded={openSections.recording}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-500/15 text-rose-400 border border-rose-500/30">
                      <Video className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-200 text-sm">Aufnahme & NVR-Strategie</div>
                      <p className="text-[11px] text-slate-400 truncate">
                        {currentRecordModeOption?.label || "Aus"}
                        {editDraft.recordEnabled && editDraft.storageTargetId
                          ? ` • ${storageTargets.find((t) => t.id === editDraft.storageTargetId)?.name || "Speicherziel"}`
                          : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold border ${
                        editDraft.recordEnabled
                          ? "bg-rose-500/20 text-rose-300 border-rose-500/30"
                          : "bg-slate-800 text-slate-400 border-slate-700"
                      }`}
                    >
                      {editDraft.recordEnabled ? "Aktiv" : "Aus"}
                    </span>
                    <ChevronDown
                      className={`h-4 w-4 text-slate-400 transition-transform duration-200 ${
                        openSections.recording ? "rotate-180 text-white" : ""
                      }`}
                    />
                  </div>
                </button>

                {openSections.recording && (
                  <div className="border-t border-white/10 p-4 space-y-4 animate-in fade-in-50 duration-150">
                    <div className="rounded-xl border border-rose-500/30 bg-rose-950/20 p-3.5 flex flex-col gap-3">
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
                          {currentRecordModeOption?.description}
                        </span>
                      </label>

                      {editDraft.recordEnabled && (
                        <div className="grid gap-3 sm:grid-cols-2 pt-3 border-t border-rose-500/20 text-xs">
                          <label className="grid gap-1">
                            <span className="text-slate-300 text-[11px] font-medium">Speicherziel:</span>
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

                          {recordingModeUsesContinuous(editDraft.recordMode) && (
                            <label className="grid gap-1">
                              <span className="text-slate-300 text-[11px] font-medium">Segmentlänge:</span>
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

                          {recordingModeUsesMotion(editDraft.recordMode) && (
                            <>
                              <label className="grid gap-1">
                                <span className="text-slate-300 text-[11px] font-medium">Vorlauf (Pre-Roll):</span>
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
                                <span className="text-slate-300 text-[11px] font-medium">Nachlauf (Post-Roll):</span>
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

                          {recordingModeUsesSchedule(editDraft.recordMode) && (
                            <div className="sm:col-span-2 rounded-xl border border-violet-500/25 bg-violet-950/20 p-3 space-y-3 mt-1">
                              <div>
                                <strong className="block text-xs text-white">Aufnahme-Zeitfenster</strong>
                                <span className="block text-[10px] leading-relaxed text-slate-400">
                                  Die Aufnahme-Strategie wechselt an diesen Tagen automatisch am Anfang und Ende des Zeitfensters.
                                </span>
                              </div>
                              <div className="grid grid-cols-2 gap-2 border-t border-violet-500/15 pt-2.5">
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
                                    className={`rounded-md border px-1 py-1.5 text-[9px] font-semibold transition-all ${
                                      editDraft.motionScheduleDays.includes(day)
                                        ? "border-violet-400 bg-violet-500/25 text-violet-200 shadow-sm"
                                        : "border-white/10 bg-slate-950/60 text-slate-500"
                                    }`}
                                  >
                                    {label}
                                  </button>
                                ))}
                              </div>
                              {recordingModeUsesMotion(editDraft.recordMode) ? (
                                <label className="grid gap-1 pt-1">
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
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* 3. BEWEGUNG, KI & ALARMIERUNG */}
              <div className="overflow-hidden rounded-xl border border-white/10 bg-slate-900/60 backdrop-blur-sm transition-all duration-200">
                <button
                  type="button"
                  onClick={() => toggleSection("ai")}
                  className="flex w-full items-center justify-between gap-3 p-3.5 text-left hover:bg-white/[0.04] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-500"
                  aria-expanded={openSections.ai}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                      <Cpu className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-200 text-sm">Bewegung, KI & Alarmierung</div>
                      <p className="text-[11px] text-slate-400 truncate">
                        Sens: {editDraft.motionSensitivity}%
                        {editDraft.objectDetectionEnabled
                          ? ` • KI: ${editDraft.objectDetectionClasses.length} Typen (${editDraft.objectMinConfidence}%)`
                          : " • KI: Aus"}
                        {editDraft.notificationsEnabled ? " • Push aktiv" : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {editDraft.licensePlateRecognitionEnabled && (
                      <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                        <Car className="w-3 h-3" /> LPR
                      </span>
                    )}
                    {editDraft.objectDetectionEnabled && (
                      <span className="hidden sm:inline-block rounded-full bg-cyan-500/15 border border-cyan-500/30 px-2 py-0.5 text-[10px] font-semibold text-cyan-300">
                        KI
                      </span>
                    )}
                    <ChevronDown
                      className={`h-4 w-4 text-slate-400 transition-transform duration-200 ${
                        openSections.ai ? "rotate-180 text-white" : ""
                      }`}
                    />
                  </div>
                </button>

                {openSections.ai && (
                  <div className="border-t border-white/10 p-4 space-y-4 animate-in fade-in-50 duration-150">
                    {/* Push Notification Toggle */}
                    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-3">
                      <div className="min-w-0">
                        <span className="block text-xs font-semibold text-white">Push-Benachrichtigung</span>
                        <span className="block text-[10px] leading-relaxed text-slate-400">
                          Meldet Bewegungen dieser Kamera mit aktuellem Bild über Web-Push, Telegram oder ntfy.
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

                    {/* Notification Cooldown */}
                    {editDraft.notificationsEnabled && (
                      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 space-y-1.5">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <span className="block text-xs font-semibold text-slate-200">
                              Wiederholungssperre (Cooldown)
                            </span>
                            <span className="block text-[10px] text-slate-400">
                              Pausiert Benachrichtigungen während andauernder Bewegung. Erst nach dieser Ruhezeit wird wieder gemeldet.
                            </span>
                          </div>
                          <select
                            value={editDraft.alarmCooldownSeconds ?? 30}
                            onChange={(e) =>
                              onUpdateDraft({ ...editDraft, alarmCooldownSeconds: Number(e.target.value) })
                            }
                            className="glass-input rounded-lg px-2.5 py-1.5 text-xs bg-slate-900 text-white shrink-0 border border-white/10"
                            aria-label="Wiederholungssperre Cooldown"
                          >
                            {[15, 20, 30, 45, 60, 120, 300].map((sec) => (
                              <option key={sec} value={sec}>
                                {sec >= 60 ? `${sec / 60} Minute${sec > 60 ? "n" : ""}` : `${sec} Sekunden`}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )}

                    {/* Motion Sensitivity */}
                    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3.5 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-200 text-xs">Bewegungsempfindlichkeit</span>
                        <strong className="text-amber-300 text-xs">{editDraft.motionSensitivity}%</strong>
                      </div>
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
                        className="motion-sensitivity-range range range-warning range-sm"
                        aria-label="Bewegungsempfindlichkeit"
                      />
                      <div className="flex justify-between text-[9px] text-slate-500">
                        <span>Weniger Fehlalarme (robuster)</span>
                        <span>Erkennt kleinste Bewegungen</span>
                      </div>
                    </div>

                    {/* Minimum Motion Area */}
                    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 space-y-1.5">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <span className="block text-xs font-semibold text-slate-200">
                            Mindest-Bewegungsfläche (% Bild)
                          </span>
                          <span className="block text-[10px] text-slate-400">
                            Wie viel Prozent des Bildes sich bewegen müssen. Filtert wackelnde Kissen, Pflanzen oder kleine Tiere.
                          </span>
                        </div>
                        <select
                          value={editDraft.motionMinAreaPercent != null ? String(editDraft.motionMinAreaPercent) : "default"}
                          onChange={(e) =>
                            onUpdateDraft({
                              ...editDraft,
                              motionMinAreaPercent: e.target.value === "default" ? null : Number(e.target.value),
                            })
                          }
                          className="glass-input rounded-lg px-2.5 py-1.5 text-xs bg-slate-900 text-white shrink-0 border border-white/10"
                          aria-label="Mindest-Bewegungsfläche"
                        >
                          <option value="default">Standard (aus Gesamteinstellungen)</option>
                          <option value="0.5">0.5% (Sehr empfindlich)</option>
                          <option value="1.0">1.0% (Fein)</option>
                          <option value="1.5">1.5% (Standard)</option>
                          <option value="2.0">2.0% (Mittel)</option>
                          <option value="3.0">3.0% (Empfohlen gegen Fehlalarme)</option>
                          <option value="5.0">5.0% (Groß / Personen)</option>
                          <option value="8.0">8.0% (Sehr groß)</option>
                          <option value="10.0">10.0% (Nur massive Bewegung)</option>
                        </select>
                      </div>
                    </div>

                    {/* Local Object Detection */}
                    <div className="rounded-xl border border-cyan-500/25 bg-cyan-950/15 p-3.5 space-y-3">
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
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            {(
                              [
                                ["person", "Personen"],
                                ["vehicle", "Fahrzeuge/Räder"],
                                ["animal", "Tiere"],
                              ] as const
                            ).map(([value, label]) => (
                              <label
                                key={value}
                                className="flex min-w-0 cursor-pointer items-center gap-2 rounded-lg border border-white/10 bg-slate-950/60 px-2.5 py-2 hover:bg-slate-950 transition-colors"
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
                                <span className="truncate text-[11px] text-slate-200 font-medium">{label}</span>
                              </label>
                            ))}
                          </div>
                          <label className="grid gap-1">
                            <span className="flex justify-between text-[11px] text-slate-400">
                              <span>Mindest-Sicherheit (Konfidenz)</span>
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

                    {/* License Plate Recognition (LPR) */}
                    <div className="rounded-xl border border-amber-500/25 bg-amber-950/15 p-3.5 space-y-2.5">
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
                          <strong className="block text-xs text-white">Fahrzeuge und Kennzeichen lokal erkennen (LPR)</strong>
                          <span className="block text-[10px] leading-relaxed text-slate-400">
                            Prüft bestätigte Bewegungen auf Fahrzeuge und liest sichtbare Kennzeichen lokal per OCR aus. Rot maskierte Bildbereiche werden dabei ebenfalls ignoriert.
                          </span>
                        </span>
                      </label>
                      {editDraft.licensePlateRecognitionEnabled && (
                        <div className="pt-2 border-t border-amber-500/20 flex justify-end">
                          <button
                            type="button"
                            onClick={() => setIsKnownEntitiesOpen(true)}
                            className="btn btn-xs border border-amber-500/30 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25 rounded-lg gap-1.5"
                          >
                            <Car className="w-3.5 h-3.5" />
                            <span>Bekannte Kennzeichen verwalten...</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* 4. MASKEN & BILD-OVERLAY */}
              <div className="overflow-hidden rounded-xl border border-white/10 bg-slate-900/60 backdrop-blur-sm transition-all duration-200">
                <button
                  type="button"
                  onClick={() => toggleSection("mask")}
                  className="flex w-full items-center justify-between gap-3 p-3.5 text-left hover:bg-white/[0.04] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500"
                  aria-expanded={openSections.mask}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                      <Paintbrush className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-200 text-sm">Masken & Bild-Overlay</div>
                      <p className="text-[11px] text-slate-400 truncate">
                        {editDraft.motionIgnoreRegions?.length
                          ? `${editDraft.motionIgnoreRegions.length} Ignorier-Bereich(e)`
                          : "Keine Masken"}
                        {" • Overlay: "}
                        {editDraft.overlayPosition === "top-left"
                          ? "Oben Links"
                          : editDraft.overlayPosition === "top-right"
                          ? "Oben Rechts"
                          : editDraft.overlayPosition === "bottom-left"
                          ? "Unten Links"
                          : "Unten Rechts"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="rounded-full bg-slate-800 border border-slate-700 px-2 py-0.5 text-[10px] text-slate-300 font-mono">
                      {editDraft.motionIgnoreRegions?.length || 0} Masken
                    </span>
                    <ChevronDown
                      className={`h-4 w-4 text-slate-400 transition-transform duration-200 ${
                        openSections.mask ? "rotate-180 text-white" : ""
                      }`}
                    />
                  </div>
                </button>

                {openSections.mask && (
                  <div className="border-t border-white/10 p-4 space-y-4 animate-in fade-in-50 duration-150">
                    <label className="grid gap-1.5 max-w-sm">
                      <span className="font-semibold text-slate-300">Name im Bild (Overlay-Position)</span>
                      <select
                        value={editDraft.overlayPosition}
                        onChange={(event) =>
                          onUpdateDraft({
                            ...editDraft,
                            overlayPosition: event.target.value as CameraEditDraft["overlayPosition"],
                          })
                        }
                        className="glass-input rounded-lg px-3 py-2 text-xs outline-none bg-slate-900 text-white"
                      >
                        <option value="top-left">Oben Links</option>
                        <option value="top-right">Oben Rechts</option>
                        <option value="bottom-left">Unten Links</option>
                        <option value="bottom-right">Unten Rechts</option>
                      </select>
                    </label>

                    <div>
                      <span className="block font-semibold text-slate-300 mb-1">
                        Ignorier-Masken (Bewegungserkennung & KI)
                      </span>
                      <span className="block text-[11px] text-slate-400 mb-2">
                        Mit dem Pinsel rot markierte Bereiche (z. B. Bäume, Straßenverkehr, Reflexionen) werden von der Bewegungserkennung und KI ignoriert.
                      </span>
                      <MotionMaskEditor
                        imageSrc={previewImageSrc}
                        regions={editDraft.motionIgnoreRegions}
                        onChange={(motionIgnoreRegions) =>
                          onUpdateDraft({ ...editDraft, motionIgnoreRegions })
                        }
                      />
                    </div>
                  </div>
                )}
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
      )}
      <KnownEntitiesModal
        isOpen={isKnownEntitiesOpen}
        onClose={() => setIsKnownEntitiesOpen(false)}
      />
    </>
  );
}
