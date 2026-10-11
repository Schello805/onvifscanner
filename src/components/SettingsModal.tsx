"use client";

import React, { useState, useEffect } from "react";
import { X, Settings2, Bell, Save } from "lucide-react";
import { useToast } from "./ToastProvider";

type SettingsData = {
  ntfyTopic: string | null;
  ntfyServer: string | null;
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
    autoCleanup: true,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadSettings();
    }
  }, [isOpen]);

  async function loadSettings() {
    setIsLoading(true);
    try {
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error("Failed to load");
      const json = await res.json();
      setData({
        ntfyTopic: json.ntfyTopic || "",
        ntfyServer: json.ntfyServer || "",
        autoCleanup: json.autoCleanup ?? true,
      });
    } catch (e) {
      toast.error("Fehler beim Laden der Einstellungen.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSave() {
    setIsSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ntfyTopic: data.ntfyTopic?.trim() || null,
          ntfyServer: data.ntfyServer?.trim() || null,
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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-slate-950/60 backdrop-blur-md animate-in fade-in" 
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-lg overflow-hidden rounded-2xl bg-slate-900 border border-slate-700/60 shadow-2xl animate-in zoom-in-95 fade-in slide-in-from-bottom-4">
        
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
        <div className="p-6 space-y-6">
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
                  Trage deinen ntfy-Server und das Topic ein, um bei Bewegungserkennung sofort eine Push-Nachricht auf dein Smartphone zu erhalten. Ohne Server wird ntfy.sh verwendet.
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
