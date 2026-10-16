"use client";

import React, { useCallback, useEffect, useState } from "react";
import { X, Settings2, Bell, Save, Send, Languages, Shield, KeyRound, LogOut, RefreshCw } from "lucide-react";
import { useToast } from "./ToastProvider";
import { useLanguage } from "./LanguageProvider";
import { useBodyScrollLock } from "@/lib/useBodyScrollLock";

type SettingsData = {
  ntfyTopic: string | null;
  ntfyServer: string | null;
  ntfyCameraStatusEnabled: boolean;
  autoCleanup: boolean;
  authEnabled: boolean;
  envAuthLocked: boolean;
  webhookToken: string;
};

export function SettingsModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const { lang, setLang, t } = useLanguage();
  const [data, setData] = useState<SettingsData>({
    ntfyTopic: "",
    ntfyServer: "",
    ntfyCameraStatusEnabled: false,
    autoCleanup: true,
    authEnabled: false,
    envAuthLocked: false,
    webhookToken: "",
  });
  const [newAppPassword, setNewAppPassword] = useState("");
  const [disableAppPassword, setDisableAppPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTestingNotification, setIsTestingNotification] = useState(false);
  useBodyScrollLock(isOpen);

  const loadSettings = useCallback(async () => {
    setIsLoading(true);
    setNewAppPassword("");
    setDisableAppPassword(false);
    try {
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error("Failed to load");
      const json = await res.json();
      setData({
        ntfyTopic: json.ntfyTopic || "",
        ntfyServer: json.ntfyServer || "",
        ntfyCameraStatusEnabled: Boolean(json.ntfyCameraStatusEnabled),
        autoCleanup: json.autoCleanup ?? true,
        authEnabled: Boolean(json.authEnabled),
        envAuthLocked: Boolean(json.envAuthLocked),
        webhookToken: json.webhookToken || "",
      });
    } catch {
      toast.error(t("Fehler beim Laden der Einstellungen.", "Failed to load settings."));
    } finally {
      setIsLoading(false);
    }
  }, [toast, t]);

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
          newAppPassword: newAppPassword.trim() || undefined,
          disableAppPassword: disableAppPassword || undefined,
          webhookToken: data.webhookToken.trim(),
        }),
      });

      if (!res.ok) throw new Error("Failed to save");
      window.dispatchEvent(new CustomEvent("onvifscanner:auth-changed"));
      toast.success(t("Einstellungen gespeichert!", "Settings saved!"));
      onClose();
    } catch {
      toast.error(t("Fehler beim Speichern.", "Failed to save."));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      onClose();
      window.dispatchEvent(new CustomEvent("onvifscanner:auth-changed"));
      toast.success(t("Sitzung gesperrt.", "Session locked."));
    } catch {
      toast.error(t("Fehler beim Abmelden.", "Failed to log out."));
    }
  }

  function generateRandomToken() {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let token = "";
    const bytes = new Uint8Array(24);
    window.crypto.getRandomValues(bytes);
    for (let i = 0; i < bytes.length; i++) {
      token += chars[bytes[i] % chars.length];
    }
    setData((prev) => ({ ...prev, webhookToken: token }));
  }

  async function handleTestNotification() {
    if (!data.ntfyTopic?.trim()) {
      toast.error(t("Bitte zuerst ein ntfy-Topic eingeben.", "Please enter an ntfy topic first."));
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
      if (!res.ok) throw new Error(response.error || t("Testnachricht konnte nicht gesendet werden.", "Test notification could not be sent."));
      toast.success(t("Testnachricht wurde erfolgreich gesendet.", "Test notification sent successfully."));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Testnachricht konnte nicht gesendet werden.", "Test notification could not be sent."));
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
            <h2 className="text-lg font-semibold text-slate-100">
              {t("Globale Einstellungen", "Global Settings")}
            </h2>
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
              {/* Language Selector */}
              <div className="space-y-2.5">
                <div className="flex items-center gap-2 text-slate-300 font-medium">
                  <Languages className="w-4 h-4 text-indigo-400" />
                  <span>{t("Sprache / Language", "Language / Sprache")}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setLang("de")}
                    className={`rounded-xl border px-3 py-2 text-xs font-semibold transition-all ${
                      lang === "de"
                        ? "border-indigo-500/60 bg-indigo-500/20 text-indigo-200 shadow-sm"
                        : "border-slate-800 bg-slate-950/60 text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    🇩🇪 Deutsch
                  </button>
                  <button
                    type="button"
                    onClick={() => setLang("en")}
                    className={`rounded-xl border px-3 py-2 text-xs font-semibold transition-all ${
                      lang === "en"
                        ? "border-indigo-500/60 bg-indigo-500/20 text-indigo-200 shadow-sm"
                        : "border-slate-800 bg-slate-950/60 text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    🇬🇧 English
                  </button>
                </div>
              </div>

              <hr className="border-slate-800" />

              {/* Security & Access Protection */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-slate-300 font-medium">
                    <Shield className="w-4 h-4 text-amber-400" />
                    <span>{t("Sicherheit & Zugriffsschutz", "Security & Access Protection")}</span>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      data.authEnabled && !disableAppPassword
                        ? "border border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                        : "border border-slate-700 bg-slate-800/80 text-slate-400"
                    }`}
                  >
                    {data.authEnabled && !disableAppPassword
                      ? t("Passwortschutz aktiv", "Password active")
                      : t("Kein Passwort", "No password")}
                  </span>
                </div>

                <div className="text-xs text-slate-400 leading-relaxed">
                  {t(
                    "Schützt die Web-Oberfläche und alle API-Befehle mit einem Passwort oder einer PIN. Kamera-Passwörter werden zudem mit AES-256 verschlüsselt gespeichert.",
                    "Protects the web interface and all API commands with a password or PIN. Camera passwords are also stored encrypted with AES-256."
                  )}
                </div>

                <label className="input input-bordered flex items-center gap-2 bg-slate-950 border-slate-800 focus-within:border-indigo-500">
                  <KeyRound className="w-4 h-4 text-slate-500 shrink-0" />
                  <input
                    type="password"
                    className="grow text-slate-200 text-sm"
                    placeholder={
                      data.authEnabled
                        ? t("Neues App-Passwort / PIN (leer = unverändert)", "New App Password / PIN (empty = keep)")
                        : t("App-Passwort oder PIN festlegen...", "Set App Password or PIN...")
                    }
                    value={newAppPassword}
                    onChange={(e) => {
                      setNewAppPassword(e.target.value);
                      if (e.target.value.trim()) setDisableAppPassword(false);
                    }}
                  />
                </label>

                {data.authEnabled && !data.envAuthLocked && (
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
                      <input
                        type="checkbox"
                        className="checkbox checkbox-xs checkbox-warning"
                        checked={disableAppPassword}
                        onChange={(e) => {
                          setDisableAppPassword(e.target.checked);
                          if (e.target.checked) setNewAppPassword("");
                        }}
                      />
                      <span>
                        {t("App-Passwortschutz beim Speichern deaktivieren", "Disable app password protection on save")}
                      </span>
                    </label>
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-200 hover:bg-amber-500/20"
                    >
                      <LogOut className="h-3.5 w-3.5" />
                      <span>{t("Sitzung jetzt sperren", "Lock session now")}</span>
                    </button>
                  </div>
                )}

                <div className="pt-2">
                  <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
                    <span>{t("Webhook-Token (optional für /api/events/webhook?token=...)", "Webhook Token (optional for /api/events/webhook?token=...)")}</span>
                    <button
                      type="button"
                      onClick={generateRandomToken}
                      className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 font-medium"
                    >
                      <RefreshCw className="h-3 w-3" />
                      <span>{t("Generieren", "Generate")}</span>
                    </button>
                  </div>
                  <input
                    type="text"
                    className="input input-bordered input-sm w-full bg-slate-950 border-slate-800 text-slate-200 font-mono text-xs"
                    placeholder={t("Leer = kein Token erforderlich", "Empty = no token required")}
                    value={data.webhookToken}
                    onChange={(e) => setData({ ...data, webhookToken: e.target.value })}
                  />
                </div>
              </div>

              <hr className="border-slate-800" />

              {/* Ntfy Push Settings */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-slate-300 font-medium mb-1">
                  <Bell className="w-4 h-4 text-emerald-400" />
                  <span>{t("Push-Benachrichtigungen (ntfy)", "Push Notifications (ntfy)")}</span>
                </div>
                <div className="text-sm text-slate-400 mb-2 leading-relaxed">
                  {t(
                    "Trage deinen ntfy-Server und das Topic ein. Push wird anschließend für jede gewünschte Kamera einzeln in deren Bearbeiten-Dialog aktiviert. Bei Bewegungen wird nach Möglichkeit ein aktuelles Kamerabild mitgesendet. Ohne Server wird ntfy.sh verwendet.",
                    "Enter your ntfy server and topic. Push notifications can then be enabled individually for each camera in its edit dialog. When motion is detected, a current snapshot is attached if available. Defaults to ntfy.sh if server is left empty."
                  )}
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
                    placeholder={t("mein-geheimes-topic-123", "my-secret-topic-123")}
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
                  {t("Testnachricht senden", "Send test notification")}
                </button>
                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-slate-950/60 p-3.5">
                  <input
                    type="checkbox"
                    className="toggle toggle-success toggle-sm mt-0.5 shrink-0"
                    checked={data.ntfyCameraStatusEnabled}
                    onChange={(event) => setData({ ...data, ntfyCameraStatusEnabled: event.target.checked })}
                  />
                  <span>
                    <strong className="block text-sm font-medium text-slate-200">
                      {t("Online-/Offline-Meldungen", "Online / Offline Alerts")}
                    </strong>
                    <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">
                      {t(
                        "Sendet über ntfy eine Nachricht, wenn eine Kamera offline oder wieder online geht. Gilt für alle gespeicherten Kameras.",
                        "Sends an ntfy notification whenever a camera goes offline or comes back online. Applies to all saved cameras."
                      )}
                    </span>
                  </span>
                </label>
              </div>

              <hr className="border-slate-800" />

              {/* General Settings */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-slate-300 font-medium mb-1">
                  <Settings2 className="w-4 h-4 text-sky-400" />
                  <span>{t("Speicher & System", "Storage & System")}</span>
                </div>
                
                <label className="label cursor-pointer justify-start gap-4 p-0">
                  <input 
                    type="checkbox" 
                    className="toggle toggle-primary"
                    checked={data.autoCleanup}
                    onChange={(e) => setData({ ...data, autoCleanup: e.target.checked })}
                  />
                  <span className="label-text text-slate-300 font-medium">
                    {t("Automatischer Cleanup", "Automatic Cleanup")}
                  </span>
                </label>
                <div className="text-xs text-slate-500 pl-14">
                  {t(
                    "Löscht alte Aufnahmen automatisch, wenn der Speicherplatz knapp wird.",
                    "Automatically deletes old recordings when disk space runs low."
                  )}
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
            {t("Abbrechen", "Cancel")}
          </button>
          <button 
            className="btn bg-indigo-600 hover:bg-indigo-500 text-white border-none min-w-[120px]"
            onClick={handleSave}
            disabled={isSaving || isLoading}
          >
            {isSaving ? (
              <span className="loading loading-spinner loading-sm"></span>
            ) : (
              <><Save className="w-4 h-4 mr-1" /> {t("Speichern", "Save")}</>
            )}
          </button>
        </div>

      </div>
    </div>
  );
}
