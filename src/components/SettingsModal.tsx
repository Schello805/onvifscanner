"use client";

import React, { useCallback, useEffect, useState } from "react";
import { X, Settings2, Bell, Save, Send } from "lucide-react";
import { useToast } from "./ToastProvider";
import { useBodyScrollLock } from "@/lib/useBodyScrollLock";

type SettingsData = {
  ntfyTopic: string | null;
  ntfyServer: string | null;
  ntfyCameraStatusEnabled: boolean;
  autoCleanup: boolean;
};

export function SettingsModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [data, setData] = useState<SettingsData>({
    ntfyTopic: "",
    ntfyServer: "",
    ntfyCameraStatusEnabled: false,
    autoCleanup: true,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTestingNotification, setIsTestingNotification] = useState(false);
  useBodyScrollLock(isOpen);

  const loadSettings = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error("Failed to load");
      const json = await res.json();
      setData({
        ntfyTopic: json.ntfyTopic || "",
        ntfyServer: json.ntfyServer || "",
        ntfyCameraStatusEnabled: Boolean(json.ntfyCameraStatusEnabled),
        autoCleanup: json.autoCleanup ?? true,
      });
    } catch (e) {
      toast.error("Fehler beim Laden der Einstellungen.");
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (isOpen) {
      void loadSettings();
    }
  }, [isOpen, loadSettings]);

  async function handleSave() {
    setIsSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ntfyTopic: data.ntfyTopic?.trim() || null,
          ntfyServer: data.ntfyServer?.trim() || null,
          ntfyCameraStatusEnabled: data.ntfyCameraStatusEnabled,
          autoCleanup: data.autoCleanup,
        }),
      });

      if (!res.ok) throw new Error("Failed to save");
      toast.success("Einstellungen gespeichert!");
      onClose();
    } catch (e) {
      toast.error("Fehler beim Speichern.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleTestNotification() {
    if (!data.ntfyTopic?.trim()) {
      toast.error("Bitte zuerst ein ntfy-Topic eingeben.");
      return;
    }
    setIsTestingNotification(true);
    try {
      const res = await fetch("/api/settings/test-notification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ntfyTopic: data.ntfyTopic.trim(),
          ntfyServer: data.ntfyServer?.trim() || null,
        }),
      });
      const response = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(response.error || "Testnachricht konnte nicht gesendet werden.");
      toast.success("Testnachricht wurde erfolgreich gesendet.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Testnachricht konnte nicht gesendet werden.");
    } finally {
      setIsTestingNotification(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-slate-950/60 backdrop-blur-md animate-in fade-in" 
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-slate-900 border border-slate-700/60 shadow-2xl animate-in zoom-in-95 fade-in slide-in-from-bottom-4">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4 bg-slate-900/50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-500/20 rounded-lg text-indigo-400">
              <Settings2 className="w-5 h-5" />
            </div>
            <h2 className="text-lg font-semibold text-slate-100">Globale Einstellungen</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-6 space-y-6">
          {isLoading ? (
            <div className="flex justify-center py-10">
              <span className="loading loading-spinner text-indigo-500"></span>
            </div>
          ) : (
            <>
              {/* Ntfy Push Settings */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-slate-300 font-medium mb-1">
                  <Bell className="w-4 h-4 text-emerald-400" />
                  <span>Push-Benachrichtigungen (ntfy)</span>
                </div>
                <div className="text-sm text-slate-400 mb-2 leading-relaxed">
                  Trage deinen ntfy-Server und das Topic ein. Push wird anschließend für jede gewünschte Kamera einzeln in deren Bearbeiten-Dialog aktiviert. Bei Bewegungen wird nach Möglichkeit ein aktuelles Kamerabild mitgesendet. Ohne Server wird ntfy.sh verwendet.
                </div>
                <label className="input input-bordered flex items-center gap-2 bg-slate-950 border-slate-800 focus-within:border-indigo-500">
                  <span className="text-slate-500 select-none">Server</span>
                  <input
                    type="text"
                    className="grow text-slate-200"
                    placeholder="https://ntfy.sh"
                    value={data.ntfyServer || ""}
                    onChange={(e) => setData({ ...data, ntfyServer: e.target.value })}
                  />
                </label>
                <label className="input input-bordered flex items-center gap-2 bg-slate-950 border-slate-800 focus-within:border-indigo-500">
                  <span className="text-slate-500 select-none">Topic</span>
                  <input
                    type="text"
                    className="grow text-slate-200"
                    placeholder="mein-geheimes-topic-123"
                    value={data.ntfyTopic || ""}
                    onChange={(e) => setData({ ...data, ntfyTopic: e.target.value })}
                  />
                </label>
                <button
                  type="button"
                  onClick={handleTestNotification}
                  disabled={isTestingNotification || !data.ntfyTopic?.trim()}
                  className="btn btn-sm border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-40"
                >
                  {isTestingNotification ? (
                    <span className="loading loading-spinner loading-xs" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                  Testnachricht senden
                </button>
                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-slate-950/60 p-3.5">
                  <input
                    type="checkbox"
                    className="toggle toggle-success toggle-sm mt-0.5 shrink-0"
                    checked={data.ntfyCameraStatusEnabled}
                    onChange={(event) => setData({ ...data, ntfyCameraStatusEnabled: event.target.checked })}
                  />
                  <span>
                    <strong className="block text-sm font-medium text-slate-200">Online-/Offline-Meldungen</strong>
                    <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">
                      Sendet über ntfy eine Nachricht, wenn eine Kamera offline oder wieder online geht. Gilt für alle gespeicherten Kameras.
                    </span>
                  </span>
                </label>
              </div>

              <hr className="border-slate-800" />

              {/* General Settings */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-slate-300 font-medium mb-1">
                  <Settings2 className="w-4 h-4 text-sky-400" />
                  <span>Speicher & System</span>
                </div>
                
                <label className="label cursor-pointer justify-start gap-4 p-0">
                  <input 
                    type="checkbox" 
                    className="toggle toggle-primary"
                    checked={data.autoCleanup}
                    onChange={(e) => setData({ ...data, autoCleanup: e.target.checked })}
                  />
                  <span className="label-text text-slate-300 font-medium">Automatischer Cleanup</span>
                </label>
                <div className="text-xs text-slate-500 pl-14">
                  Löscht alte Aufnahmen automatisch, wenn der Speicherplatz knapp wird.
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 border-t border-slate-800 px-6 py-4 bg-slate-950/30">
          <button 
            className="btn btn-ghost text-slate-300 hover:text-white"
            onClick={onClose}
          >
            Abbrechen
          </button>
          <button 
            className="btn bg-indigo-600 hover:bg-indigo-500 text-white border-none min-w-[120px]"
            onClick={handleSave}
            disabled={isSaving || isLoading}
          >
            {isSaving ? (
              <span className="loading loading-spinner loading-sm"></span>
            ) : (
              <><Save className="w-4 h-4 mr-1" /> Speichern</>
            )}
          </button>
        </div>

      </div>
    </div>
  );
}
