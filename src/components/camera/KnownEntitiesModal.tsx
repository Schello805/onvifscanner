"use client";

import React, { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Car,
  User,
  Plus,
  Trash2,
  Edit2,
  Check,
  Search,
  Bell,
  ShieldAlert,
  Clock,
  Camera as CameraIcon,
  Sparkles,
} from "lucide-react";
import { useToast } from "../ToastProvider";
import { useLanguage } from "../LanguageProvider";
import { useBodyScrollLock } from "@/lib/useBodyScrollLock";
import type { KnownEntity, EntityCategory } from "@/lib/knownEntities";

const CATEGORY_CONFIG: Record<
  EntityCategory,
  { labelDe: string; labelEn: string; color: string; badgeClass: string }
> = {
  family: {
    labelDe: "Familie / Eigen",
    labelEn: "Family / Own",
    color: "emerald",
    badgeClass: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  },
  guest: {
    labelDe: "Besucher / Gast",
    labelEn: "Guest / Visitor",
    color: "sky",
    badgeClass: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  },
  service: {
    labelDe: "Lieferdienst / Handwerk",
    labelEn: "Service / Delivery",
    color: "amber",
    badgeClass: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  },
  suspicious: {
    labelDe: "Verdächtig / Achtung",
    labelEn: "Suspicious / Alert",
    color: "rose",
    badgeClass: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  },
};

export function KnownEntitiesModal({
  isOpen,
  onClose,
  initialPlate = "",
}: {
  isOpen: boolean;
  onClose: () => void;
  initialPlate?: string;
}) {
  const { toast } = useToast();
  const { t } = useLanguage();
  useBodyScrollLock(isOpen);

  const [entities, setEntities] = useState<KnownEntity[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  // Form State
  const [isAdding, setIsAdding] = useState(Boolean(initialPlate));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formType, setFormType] = useState<"plate" | "person">("plate");
  const [formIdentifier, setFormIdentifier] = useState(initialPlate);
  const [formName, setFormName] = useState("");
  const [formCategory, setFormCategory] = useState<EntityCategory>("family");
  const [formNotes, setFormNotes] = useState("");
  const [formNotify, setFormNotify] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/system/known-entities");
      const json = await res.json();
      if (res.ok && json.entities) {
        setEntities(json.entities);
      }
    } catch {
      toast.error(t("Fehler beim Laden der bekannten Kennzeichen.", "Failed to load known plates."));
    } finally {
      setLoading(false);
    }
  }, [toast, t]);

  useEffect(() => {
    if (isOpen) {
      void loadData();
      if (initialPlate) {
        setIsAdding(true);
        setFormIdentifier(initialPlate);
        setFormType("plate");
      }
    } else {
      setIsAdding(false);
      setEditingId(null);
    }
  }, [isOpen, initialPlate, loadData]);

  function resetForm() {
    setIsAdding(false);
    setEditingId(null);
    setFormIdentifier("");
    setFormName("");
    setFormCategory("family");
    setFormNotes("");
    setFormNotify(true);
  }

  function startEdit(entity: KnownEntity) {
    setEditingId(entity.id);
    setIsAdding(true);
    setFormType(entity.type);
    setFormIdentifier(entity.identifier);
    setFormName(entity.name);
    setFormCategory(entity.category);
    setFormNotes(entity.notes || "");
    setFormNotify(entity.notify);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!formIdentifier.trim() || !formName.trim()) {
      toast.error(t("Kennzeichen und Name erforderlich.", "Plate/ID and name required."));
      return;
    }

    setIsSaving(true);
    try {
      if (editingId) {
        // Update
        const res = await fetch("/api/system/known-entities", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "update",
            id: editingId,
            updates: {
              type: formType,
              identifier: formIdentifier.trim().toUpperCase(),
              name: formName.trim(),
              category: formCategory,
              notes: formNotes.trim(),
              notify: formNotify,
            },
          }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Fehler beim Aktualisieren");
        toast.success(t("Eintrag aktualisiert!", "Entry updated!"));
      } else {
        // Add
        const res = await fetch("/api/system/known-entities", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "add",
            type: formType,
            identifier: formIdentifier.trim().toUpperCase(),
            name: formName.trim(),
            category: formCategory,
            notes: formNotes.trim(),
            notify: formNotify,
          }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Fehler beim Hinzufügen");
        toast.success(t("Kennzeichen gespeichert!", "Plate saved successfully!"));
      }
      resetForm();
      await loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("Fehler beim Speichern.", "Failed to save."));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(id: string) {
    const ok = window.confirm(t("Diesen Eintrag wirklich löschen?", "Really delete this entry?"));
    if (!ok) return;

    try {
      const res = await fetch("/api/system/known-entities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", id }),
      });
      if (!res.ok) throw new Error("Fehler beim Löschen");
      toast.success(t("Eintrag gelöscht.", "Entry deleted."));
      await loadData();
    } catch {
      toast.error(t("Löschen fehlgeschlagen.", "Delete failed."));
    }
  }

  const filteredEntities = entities.filter((e) => {
    const matchesSearch =
      e.identifier.toLowerCase().includes(search.toLowerCase()) ||
      e.name.toLowerCase().includes(search.toLowerCase()) ||
      (e.notes && e.notes.toLowerCase().includes(search.toLowerCase()));
    const matchesCategory = selectedCategory === "all" || e.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  if (!isOpen || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[100030] flex items-center justify-center px-3 pt-[max(3.5rem,calc(env(safe-area-inset-top,0px)+1rem))] pb-[max(1rem,calc(env(safe-area-inset-bottom,0px)+0.75rem))] sm:p-5">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-md animate-in fade-in" onClick={onClose} />

      {/* Modal Card */}
      <div className="relative flex max-h-[82dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-slate-900 border border-slate-700/60 shadow-2xl animate-in zoom-in-95 fade-in sm:max-h-[calc(100dvh-3rem)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800/90 px-6 py-4 bg-slate-900/80">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-500/15 text-emerald-400 rounded-xl border border-emerald-500/20">
              <Car className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-100 tracking-tight flex items-center gap-2">
                {t("Bekannte Kennzeichen & Fahrzeuge", "Known License Plates & Vehicles")}
                <span className="rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-xs font-semibold text-emerald-300">
                  {entities.length}
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                {t(
                  "Automatische Erkennung & personalisierte Push-Alarme bei Ankunft",
                  "Automatic recognition & personalized alerts upon arrival"
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!isAdding && (
              <button
                type="button"
                onClick={() => {
                  resetForm();
                  setIsAdding(true);
                }}
                className="btn btn-xs sm:btn-sm bg-emerald-600 hover:bg-emerald-500 text-white border-none rounded-xl gap-1.5 shadow-sm"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{t("Neu", "New")}</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="rounded-xl p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5 space-y-4">
          {/* Add / Edit Form Drawer */}
          {isAdding && (
            <form
              onSubmit={handleSave}
              className="rounded-2xl border border-emerald-500/30 bg-emerald-950/20 p-4 space-y-3.5 animate-in slide-in-from-top-2 shadow-inner"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  {editingId
                    ? t("Eintrag bearbeiten", "Edit Entry")
                    : t("Neues Kennzeichen anlegen", "Add New License Plate")}
                </span>
                <button
                  type="button"
                  onClick={resetForm}
                  className="btn btn-xs btn-ghost text-slate-400 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-slate-300 mb-1">
                    {t("Kennzeichen (z. B. B-MW 1234)", "License Plate (e.g. B-MW 1234)")}
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="B-MW 1234"
                    value={formIdentifier}
                    onChange={(e) => setFormIdentifier(e.target.value.toUpperCase())}
                    className="input input-bordered input-sm w-full bg-slate-900 border-slate-700 text-slate-100 font-mono text-xs font-bold rounded-xl focus:border-emerald-500 uppercase"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-300 mb-1">
                    {t("Name / Bezeichnung", "Name / Vehicle Label")}
                  </label>
                  <input
                    type="text"
                    required
                    placeholder={t("z. B. Michaels Audi", "e.g. Michael's Audi")}
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    className="input input-bordered input-sm w-full bg-slate-900 border-slate-700 text-slate-100 text-xs rounded-xl focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-slate-300 mb-1">
                    {t("Kategorie", "Category")}
                  </label>
                  <select
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value as EntityCategory)}
                    className="select select-bordered select-sm w-full bg-slate-900 border-slate-700 text-slate-100 text-xs rounded-xl focus:border-emerald-500"
                  >
                    <option value="family">{t("Familie / Eigenes Auto", "Family / Own Car")}</option>
                    <option value="guest">{t("Besucher / Freunde", "Guest / Friends")}</option>
                    <option value="service">{t("Lieferdienst / Handwerk", "Delivery / Service")}</option>
                    <option value="suspicious">{t("Verdächtig / Warnung", "Suspicious / Alert")}</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-300 mb-1">
                    {t("Notizen (optional)", "Notes (optional)")}
                  </label>
                  <input
                    type="text"
                    placeholder={t("z. B. Parkt in Einfahrt", "e.g. Parked in driveway")}
                    value={formNotes}
                    onChange={(e) => setFormNotes(e.target.value)}
                    className="input input-bordered input-sm w-full bg-slate-900 border-slate-700 text-slate-100 text-xs rounded-xl focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-xs checkbox-success rounded"
                    checked={formNotify}
                    onChange={(e) => setFormNotify(e.target.checked)}
                  />
                  <span className="text-xs text-slate-300">
                    {t("Push-Nachricht bei Ankunft senden", "Send push alert on arrival")}
                  </span>
                </label>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={resetForm}
                    className="btn btn-xs btn-ghost text-slate-400 hover:text-white"
                  >
                    {t("Abbrechen", "Cancel")}
                  </button>
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="btn btn-xs bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg gap-1.5"
                  >
                    {isSaving ? (
                      <span className="loading loading-spinner loading-xs" />
                    ) : (
                      <Check className="w-3.5 h-3.5" />
                    )}
                    <span>{editingId ? t("Aktualisieren", "Update") : t("Speichern", "Save")}</span>
                  </button>
                </div>
              </div>
            </form>
          )}

          {/* Search & Filter Bar */}
          <div className="flex flex-col sm:flex-row gap-2 items-center justify-between">
            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-500" />
              <input
                type="text"
                placeholder={t("Suchen nach Kennzeichen/Name...", "Search plate/name...")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="input input-bordered input-xs w-full pl-8 bg-slate-950/60 border-slate-800 text-slate-200 rounded-xl"
              />
            </div>

            <div className="flex items-center gap-1 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
              {["all", "family", "guest", "service", "suspicious"].map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-lg transition-all ${
                    selectedCategory === cat
                      ? "bg-slate-800 text-white border border-slate-700"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
                  }`}
                >
                  {cat === "all"
                    ? t("Alle", "All")
                    : t(
                        CATEGORY_CONFIG[cat as EntityCategory].labelDe,
                        CATEGORY_CONFIG[cat as EntityCategory].labelEn
                      )}
                </button>
              ))}
            </div>
          </div>

          {/* Entities List */}
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-slate-400">
              <span className="loading loading-spinner loading-md text-emerald-500"></span>
              <span className="text-xs">{t("Lade Kennzeichen...", "Loading plates...")}</span>
            </div>
          ) : filteredEntities.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 border border-dashed border-slate-800 rounded-2xl p-6 text-center">
              <Car className="w-10 h-10 text-slate-600 mb-2" />
              <p className="text-sm font-semibold text-slate-300">
                {search || selectedCategory !== "all"
                  ? t("Keine passenden Einträge gefunden", "No matching entries found")
                  : t("Noch keine Kennzeichen hinterlegt", "No known license plates yet")}
              </p>
              <p className="text-xs text-slate-500 max-w-sm mt-1">
                {t(
                  "Füge eigene Fahrzeuge hinzu, damit ONVIFscanner bei der Erkennung weiß, wer angekommen ist.",
                  "Add your vehicles so ONVIFscanner knows who arrived upon motion detection."
                )}
              </p>
              {!isAdding && (
                <button
                  type="button"
                  onClick={() => setIsAdding(true)}
                  className="mt-3.5 btn btn-xs bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{t("Erstes Kennzeichen anlegen", "Add first plate")}</span>
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2.5">
              {filteredEntities.map((entity) => {
                const cat = CATEGORY_CONFIG[entity.category] || CATEGORY_CONFIG.family;
                return (
                  <div
                    key={entity.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-slate-800/90 bg-slate-950/40 p-3 hover:border-slate-700/80 transition-all shadow-sm"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 shrink-0">
                        {entity.type === "plate" ? (
                          <Car className="w-4 h-4 text-emerald-400" />
                        ) : (
                          <User className="w-4 h-4 text-indigo-400" />
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs font-bold text-slate-100 bg-slate-900 px-2 py-0.5 rounded border border-slate-700 tracking-wider">
                            {entity.identifier}
                          </span>
                          <span className="font-semibold text-slate-200 text-xs truncate">
                            {entity.name}
                          </span>
                          <span
                            className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold border ${cat.badgeClass}`}
                          >
                            {t(cat.labelDe, cat.labelEn)}
                          </span>
                        </div>

                        <div className="flex items-center gap-3 text-[11px] text-slate-400 mt-1 flex-wrap">
                          {entity.lastSeen ? (
                            <span className="flex items-center gap-1 text-slate-400">
                              <Clock className="w-3 h-3 text-slate-500" />
                              {t("Zuletzt gesehen:", "Last seen:")}{" "}
                              <strong className="text-slate-300">
                                {new Date(entity.lastSeen).toLocaleString()}
                              </strong>
                              {entity.lastCamera && (
                                <span className="flex items-center gap-0.5 text-slate-500">
                                  (<CameraIcon className="w-2.5 h-2.5 inline" /> {entity.lastCamera})
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="text-slate-400 italic">
                              {t("Noch nicht von Kameras erfasst", "Not spotted by cameras yet")}
                            </span>
                          )}
                          {entity.notes && (
                            <span className="text-slate-400 truncate max-w-xs">• {entity.notes}</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 self-end sm:self-center shrink-0">
                      <button
                        type="button"
                        onClick={() => startEdit(entity)}
                        className="btn btn-xs btn-ghost text-slate-400 hover:text-white rounded-lg p-1.5"
                        title={t("Bearbeiten", "Edit")}
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(entity.id)}
                        className="btn btn-xs btn-ghost text-rose-400 hover:text-rose-300 hover:bg-rose-950/30 rounded-lg p-1.5"
                        title={t("Löschen", "Delete")}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-800/90 px-6 py-3 bg-slate-950/40 text-xs text-slate-400">
          <span>{t("Tipp: Unbekannte Kennzeichen können auch direkt aus dem Protokoll übernommen werden.", "Tip: Unknown plates can also be saved directly from the activity log.")}</span>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-xs btn-ghost text-slate-300 hover:text-white"
          >
            {t("Schließen", "Close")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
