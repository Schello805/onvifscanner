"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  X,
  Settings2,
  Bell,
  Save,
  Send,
  Languages,
  Shield,
  KeyRound,
  LogOut,
  RefreshCw,
  Eye,
  EyeOff,
  MessageSquare,
  HardDrive,
  CheckCircle2,
} from "lucide-react";
import { useToast } from "./ToastProvider";
import { useLanguage } from "./LanguageProvider";
import { useBodyScrollLock } from "@/lib/useBodyScrollLock";

type SettingsData = {
  ntfyTopic: string | null;
  ntfyServer: string | null;
  ntfyCameraStatusEnabled: boolean;
  telegramBotToken: string | null;
  telegramChatId: string | null;
  telegramEnabled: boolean;
  telegramCameraStatusEnabled: boolean;
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
    telegramBotToken: "",
    telegramChatId: "",
    telegramEnabled: true,
    telegramCameraStatusEnabled: false,
    autoCleanup: true,
    authEnabled: false,
    envAuthLocked: false,
    webhookToken: "",
  });
  const [newAppPassword, setNewAppPassword] = useState("");
  const [showAppPassword, setShowAppPassword] = useState(false);
  const [showTelegramToken, setShowTelegramToken] = useState(false);
  const [disableAppPassword, setDisableAppPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTestingNtfy, setIsTestingNtfy] = useState(false);
  const [isTestingTelegram, setIsTestingTelegram] = useState(false);
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
        telegramBotToken: json.telegramBotToken || "",
        telegramChatId: json.telegramChatId || "",
        telegramEnabled: json.telegramEnabled ?? true,
        telegramCameraStatusEnabled: Boolean(json.telegramCameraStatusEnabled),
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
          telegramBotToken: data.telegramBotToken?.trim() || null,
          telegramChatId: data.telegramChatId?.trim() || null,
          telegramEnabled: data.telegramEnabled,
          telegramCameraStatusEnabled: data.telegramCameraStatusEnabled,
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

  async function handleTestNtfy() {
    if (!data.ntfyTopic?.trim()) {
      toast.error(t("Bitte zuerst ein ntfy-Topic eingeben.", "Please enter an ntfy topic first."));
      return;
    }
    setIsTestingNtfy(true);
    try {
      const res = await fetch("/api/settings/test-notification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "ntfy",
          ntfyTopic: data.ntfyTopic.trim(),
          ntfyServer: data.ntfyServer?.trim() || null,
        }),
      });
      const response = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(response.error || t("Testnachricht konnte nicht gesendet werden.", "Test notification could not be sent."));
      toast.success(t("ntfy Testnachricht wurde erfolgreich gesendet.", "ntfy test notification sent successfully."));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Testnachricht konnte nicht gesendet werden.", "Test notification could not be sent."));
    } finally {
      setIsTestingNtfy(false);
    }
  }

  async function handleTestTelegram() {
    if (!data.telegramBotToken?.trim() || !data.telegramChatId?.trim()) {
      toast.error(t("Bitte zuerst Bot-Token und Chat-ID eingeben.", "Please enter both bot token and chat ID first."));
      return;
    }
    setIsTestingTelegram(true);
    try {
      const res = await fetch("/api/settings/test-notification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "telegram",
          telegramBotToken: data.telegramBotToken.trim(),
          telegramChatId: data.telegramChatId.trim(),
        }),
      });
      const response = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(response.error || t("Testnachricht konnte nicht gesendet werden.", "Test notification could not be sent."));
      toast.success(t("Telegram Testnachricht wurde erfolgreich gesendet.", "Telegram test notification sent successfully."));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Testnachricht konnte nicht gesendet werden.", "Test notification could not be sent."));
    } finally {
      setIsTestingTelegram(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center p-3 sm:p-5">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-slate-950/75 backdrop-blur-md animate-in fade-in" 
        onClick={onClose}
      />

      {/* Modal Container */}
      <div className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-slate-900 border border-slate-700/60 shadow-2xl animate-in zoom-in-95 fade-in slide-in-from-bottom-4">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800/90 px-6 py-4 bg-slate-900/80">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-500/15 text-indigo-400 rounded-xl border border-indigo-500/20">
              <Settings2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-100 tracking-tight">
                {t("Globale Einstellungen", "Global Settings")}
              </h2>
              <p className="text-xs text-slate-400 hidden sm:block">
                {t("Sicherheit, Benachrichtigungen & Systemeinstellungen", "Security, Notifications & System Settings")}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Quick Language Toggle */}
            <div className="flex items-center bg-slate-950/70 border border-slate-800 rounded-xl p-0.5">
              <button
                type="button"
                onClick={() => setLang("de")}
                className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-all ${
                  lang === "de"
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "text-slate-400 hover:text-slate-200"
                }`}
                title="Deutsch"
              >
                🇩🇪 DE
              </button>
              <button
                type="button"
                onClick={() => setLang("en")}
                className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-all ${
                  lang === "en"
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "text-slate-400 hover:text-slate-200"
                }`}
                title="English"
              >
                🇬🇧 EN
              </button>
            </div>

            <button
              onClick={onClose}
              className="rounded-xl p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Area - 2 Column Grid on MD+ */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5 sm:p-6">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <span className="loading loading-spinner loading-lg text-indigo-500"></span>
              <span className="text-xs text-slate-400">{t("Einstellungen werden geladen...", "Loading settings...")}</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
              
              {/* LEFT COLUMN: Security & System */}
              <div className="space-y-6">
                
                {/* Security & Access Protection Card */}
                <div className="rounded-2xl border border-slate-800/90 bg-slate-950/40 p-5 space-y-4 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="p-1.5 rounded-lg bg-amber-500/15 text-amber-400 border border-amber-500/20">
                        <Shield className="w-4 h-4" />
                      </div>
                      <span className="font-semibold text-slate-200 text-sm">
                        {t("Sicherheit & Zugriffsschutz", "Security & Access Protection")}
                      </span>
                    </div>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                        data.authEnabled && !disableAppPassword
                          ? "border border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                          : "border border-slate-700 bg-slate-800/80 text-slate-400"
                      }`}
                    >
                      {data.authEnabled && !disableAppPassword ? (
                        <>
                          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                          {t("Aktiv", "Active")}
                        </>
                      ) : (
                        t("Deaktiviert", "Disabled")
                      )}
                    </span>
                  </div>

                  <p className="text-xs text-slate-400 leading-relaxed">
                    {t(
                      "Schützt die Web-Oberfläche und alle API-Befehle mit einem Passwort oder einer PIN. Kamera-Passwörter werden mit AES-256-GCM verschlüsselt gespeichert.",
                      "Protects the web interface and API endpoints with a password or PIN. Camera passwords are stored encrypted using AES-256-GCM."
                    )}
                  </p>

                  <div className="space-y-1.5">
                    <label className="text-[11px] font-medium text-slate-400">
                      {t("App-Passwort / PIN", "App Password / PIN")}
                    </label>
                    <label className="input input-bordered input-sm flex items-center gap-2 bg-slate-900 border-slate-800 focus-within:border-indigo-500 rounded-xl">
                      <KeyRound className="w-4 h-4 text-slate-500 shrink-0" />
                      <input
                        type={showAppPassword ? "text" : "password"}
                        className="grow text-slate-200 text-xs"
                        placeholder={
                          data.authEnabled
                            ? t("Neues Passwort (leer = unverändert)", "New password (empty = keep)")
                            : t("Passwort oder PIN festlegen...", "Set password or PIN...")
                        }
                        value={newAppPassword}
                        onChange={(e) => {
                          setNewAppPassword(e.target.value);
                          if (e.target.value.trim()) setDisableAppPassword(false);
                        }}
                      />
                      {newAppPassword && (
                        <button
                          type="button"
                          onClick={() => setShowAppPassword((s) => !s)}
                          className="text-slate-500 hover:text-slate-300 transition-colors p-1"
                          title={showAppPassword ? t("Passwort verbergen", "Hide password") : t("Passwort anzeigen", "Show password")}
                        >
                          {showAppPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      )}
                    </label>
                  </div>

                  {data.authEnabled && !data.envAuthLocked && (
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-800/60">
                      <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
                        <input
                          type="checkbox"
                          className="checkbox checkbox-xs checkbox-warning rounded"
                          checked={disableAppPassword}
                          onChange={(e) => {
                            setDisableAppPassword(e.target.checked);
                            if (e.target.checked) setNewAppPassword("");
                          }}
                        />
                        <span className="text-xs">
                          {t("Schutz deaktivieren", "Disable protection")}
                        </span>
                      </label>
                      <button
                        type="button"
                        onClick={handleLogout}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-200 hover:bg-amber-500/20 transition-colors"
                      >
                        <LogOut className="h-3 w-3" />
                        <span>{t("Jetzt sperren", "Lock now")}</span>
                      </button>
                    </div>
                  )}

                  {/* Webhook Token */}
                  <div className="pt-2 border-t border-slate-800/60 space-y-1.5">
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span className="text-[11px] font-medium">{t("Webhook-Token", "Webhook Token")}</span>
                      <button
                        type="button"
                        onClick={generateRandomToken}
                        className="inline-flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300 font-medium transition-colors"
                      >
                        <RefreshCw className="h-3 w-3" />
                        <span>{t("Generieren", "Generate")}</span>
                      </button>
                    </div>
                    <input
                      type="text"
                      className="input input-bordered input-sm w-full bg-slate-900 border-slate-800 text-slate-200 font-mono text-xs rounded-xl"
                      placeholder={t("Leer = kein Token erforderlich", "Empty = no token required")}
                      value={data.webhookToken}
                      onChange={(e) => setData({ ...data, webhookToken: e.target.value })}
                    />
                    <p className="text-[10px] text-slate-500 leading-normal">
                      {t("Zur Absicherung von Alarm-Webhooks z. B. für Kameras oder Smart Home.", "Secures alarm webhooks from cameras or smart home devices.")}
                    </p>
                  </div>
                </div>

                {/* Storage & System Card */}
                <div className="rounded-2xl border border-slate-800/90 bg-slate-950/40 p-5 space-y-3.5 shadow-sm">
                  <div className="flex items-center gap-2.5">
                    <div className="p-1.5 rounded-lg bg-sky-500/15 text-sky-400 border border-sky-500/20">
                      <HardDrive className="w-4 h-4" />
                    </div>
                    <span className="font-semibold text-slate-200 text-sm">
                      {t("Speicher & System", "Storage & System")}
                    </span>
                  </div>

                  <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-800/80 bg-slate-900/60 p-3 hover:bg-slate-900 transition-colors">
                    <input 
                      type="checkbox" 
                      className="toggle toggle-primary toggle-sm mt-0.5 shrink-0"
                      checked={data.autoCleanup}
                      onChange={(e) => setData({ ...data, autoCleanup: e.target.checked })}
                    />
                    <div>
                      <strong className="block text-xs font-semibold text-slate-200">
                        {t("Automatischer Cleanup", "Automatic Cleanup")}
                      </strong>
                      <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-400">
                        {t(
                          "Löscht alte Aufnahmen automatisch, wenn der Speicherplatz unter das definierte Minimum fällt.",
                          "Automatically deletes oldest recordings when free storage falls below the threshold."
                        )}
                      </span>
                    </div>
                  </label>
                </div>

              </div>

              {/* RIGHT COLUMN: Notifications (Telegram & ntfy) */}
              <div className="space-y-6">

                {/* Section Header */}
                <div className="flex items-center justify-between pb-1">
                  <div className="flex items-center gap-2">
                    <Bell className="w-4 h-4 text-emerald-400" />
                    <h3 className="font-semibold text-slate-200 text-sm">
                      {t("Benachrichtigungskanäle", "Notification Channels")}
                    </h3>
                  </div>
                  <span className="text-[11px] text-slate-500">
                    {t("Push & Alarmierung", "Push & Alerts")}
                  </span>
                </div>

                {/* TELEGRAM CARD */}
                <div className="rounded-2xl border border-sky-500/30 bg-slate-950/40 p-5 space-y-4 shadow-sm relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-sky-500/5 rounded-full blur-2xl pointer-events-none" />
                  
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="p-1.5 rounded-lg bg-sky-500/20 text-sky-400 border border-sky-500/30">
                        <Send className="w-4 h-4" />
                      </div>
                      <div>
                        <span className="font-semibold text-slate-200 text-sm flex items-center gap-1.5">
                          Telegram
                          {data.telegramBotToken && data.telegramChatId && (
                            <span className="inline-block w-2 h-2 rounded-full bg-sky-400"></span>
                          )}
                        </span>
                      </div>
                    </div>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <span className="text-xs text-slate-400">
                        {data.telegramEnabled ? t("Aktiv", "Active") : t("Inaktiv", "Inactive")}
                      </span>
                      <input
                        type="checkbox"
                        className="toggle toggle-info toggle-xs"
                        checked={data.telegramEnabled}
                        onChange={(e) => setData({ ...data, telegramEnabled: e.target.checked })}
                      />
                    </label>
                  </div>

                  <p className="text-xs text-slate-400 leading-relaxed">
                    {t(
                      "Trage deinen Telegram Bot-Token und deine Chat-ID ein. Benachrichtigungen werden direkt auf dein Smartphone oder in deinen Kanal gesendet. Bei Bewegungen wird nach Möglichkeit ein aktuelles Kamerabild mitgesendet.",
                      "Enter your Telegram bot token and chat ID. Notifications will be delivered straight to your phone or channel. When motion is detected, a snapshot will be attached if available."
                    )}
                  </p>

                  <div className="space-y-2.5">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-400 mb-1">
                        {t("Bot-Token", "Bot Token")}
                      </label>
                      <label className="input input-bordered input-sm flex items-center gap-2 bg-slate-900 border-slate-800 focus-within:border-sky-500 rounded-xl">
                        <input
                          type={showTelegramToken ? "text" : "password"}
                          className="grow text-slate-200 text-xs font-mono"
                          placeholder="123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ"
                          value={data.telegramBotToken || ""}
                          onChange={(e) => setData({ ...data, telegramBotToken: e.target.value })}
                        />
                        {data.telegramBotToken && (
                          <button
                            type="button"
                            onClick={() => setShowTelegramToken((s) => !s)}
                            className="text-slate-500 hover:text-slate-300 transition-colors p-1"
                          >
                            {showTelegramToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                        )}
                      </label>
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-slate-400 mb-1">
                        {t("Chat-ID", "Chat ID")}
                      </label>
                      <input
                        type="text"
                        className="input input-bordered input-sm w-full bg-slate-900 border-slate-800 text-slate-200 font-mono text-xs rounded-xl focus:border-sky-500"
                        placeholder="123456789 oder -1001234567890"
                        value={data.telegramChatId || ""}
                        onChange={(e) => setData({ ...data, telegramChatId: e.target.value })}
                      />
                    </div>
                  </div>

                  {/* Telegram Online/Offline Checkbox */}
                  <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-800/80 bg-slate-900/60 p-3 hover:bg-slate-900 transition-colors">
                    <input
                      type="checkbox"
                      className="toggle toggle-info toggle-xs mt-0.5 shrink-0"
                      checked={data.telegramCameraStatusEnabled}
                      onChange={(e) => setData({ ...data, telegramCameraStatusEnabled: e.target.checked })}
                    />
                    <div>
                      <strong className="block text-xs font-medium text-slate-200">
                        {t("Online-/Offline-Meldungen", "Online / Offline Alerts")}
                      </strong>
                      <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-500">
                        {t(
                          "Sendet über Telegram eine Nachricht, wenn eine Kamera offline oder wieder online geht.",
                          "Sends a Telegram notification whenever a camera goes offline or comes back online."
                        )}
                      </span>
                    </div>
                  </label>

                  <div className="flex justify-end pt-1">
                    <button
                      type="button"
                      onClick={handleTestTelegram}
                      disabled={isTestingTelegram || !data.telegramBotToken?.trim() || !data.telegramChatId?.trim()}
                      className="btn btn-xs border border-sky-500/30 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20 disabled:opacity-40 rounded-lg gap-1.5"
                    >
                      {isTestingTelegram ? (
                        <span className="loading loading-spinner loading-xs" />
                      ) : (
                        <Send className="h-3 w-3" />
                      )}
                      <span>{t("Telegram Testen", "Test Telegram")}</span>
                    </button>
                  </div>
                </div>

                {/* NTFY CARD */}
                <div className="rounded-2xl border border-emerald-500/30 bg-slate-950/40 p-5 space-y-4 shadow-sm relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 rounded-full blur-2xl pointer-events-none" />

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                        <Bell className="w-4 h-4" />
                      </div>
                      <span className="font-semibold text-slate-200 text-sm flex items-center gap-1.5">
                        ntfy
                        {data.ntfyTopic && (
                          <span className="inline-block w-2 h-2 rounded-full bg-emerald-400"></span>
                        )}
                      </span>
                    </div>
                  </div>

                  <p className="text-xs text-slate-400 leading-relaxed">
                    {t(
                      "Trage deinen ntfy-Server und das Topic ein. Bei Bewegungen wird nach Möglichkeit ein aktuelles Kamerabild mitgesendet. Ohne Server wird ntfy.sh verwendet.",
                      "Enter your ntfy server and topic. When motion is detected, a snapshot is attached if available. Defaults to ntfy.sh if left empty."
                    )}
                  </p>

                  <div className="space-y-2.5">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-400 mb-1">
                        Server
                      </label>
                      <input
                        type="text"
                        className="input input-bordered input-sm w-full bg-slate-900 border-slate-800 text-slate-200 text-xs rounded-xl focus:border-emerald-500"
                        placeholder="https://ntfy.sh"
                        value={data.ntfyServer || ""}
                        onChange={(e) => setData({ ...data, ntfyServer: e.target.value })}
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-slate-400 mb-1">
                        Topic
                      </label>
                      <input
                        type="text"
                        className="input input-bordered input-sm w-full bg-slate-900 border-slate-800 text-slate-200 text-xs rounded-xl focus:border-emerald-500"
                        placeholder={t("mein-geheimes-topic-123", "my-secret-topic-123")}
                        value={data.ntfyTopic || ""}
                        onChange={(e) => setData({ ...data, ntfyTopic: e.target.value })}
                      />
                    </div>
                  </div>

                  {/* ntfy Online/Offline Checkbox */}
                  <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-800/80 bg-slate-900/60 p-3 hover:bg-slate-900 transition-colors">
                    <input
                      type="checkbox"
                      className="toggle toggle-success toggle-xs mt-0.5 shrink-0"
                      checked={data.ntfyCameraStatusEnabled}
                      onChange={(event) => setData({ ...data, ntfyCameraStatusEnabled: event.target.checked })}
                    />
                    <div>
                      <strong className="block text-xs font-medium text-slate-200">
                        {t("Online-/Offline-Meldungen", "Online / Offline Alerts")}
                      </strong>
                      <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-500">
                        {t(
                          "Sendet über ntfy eine Nachricht, wenn eine Kamera offline oder wieder online geht.",
                          "Sends an ntfy notification whenever a camera goes offline or comes back online."
                        )}
                      </span>
                    </div>
                  </label>

                  <div className="flex justify-end pt-1">
                    <button
                      type="button"
                      onClick={handleTestNtfy}
                      disabled={isTestingNtfy || !data.ntfyTopic?.trim()}
                      className="btn btn-xs border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-40 rounded-lg gap-1.5"
                    >
                      {isTestingNtfy ? (
                        <span className="loading loading-spinner loading-xs" />
                      ) : (
                        <Send className="h-3 w-3" />
                      )}
                      <span>{t("ntfy Testen", "Test ntfy")}</span>
                    </button>
                  </div>
                </div>

              </div>

            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-800/90 px-6 py-4 bg-slate-950/40">
          <span className="text-xs text-slate-500 hidden sm:inline">
            ONVIFscanner NVR
          </span>
          <div className="flex items-center gap-3 ml-auto">
            <button 
              type="button"
              className="btn btn-sm btn-ghost text-slate-400 hover:text-white rounded-xl"
              onClick={onClose}
            >
              {t("Abbrechen", "Cancel")}
            </button>
            <button 
              type="button"
              className="btn btn-sm bg-indigo-600 hover:bg-indigo-500 text-white border-none min-w-[130px] rounded-xl font-medium shadow-md shadow-indigo-600/20 gap-1.5"
              onClick={handleSave}
              disabled={isSaving || isLoading}
            >
              {isSaving ? (
                <span className="loading loading-spinner loading-xs"></span>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" />
                  {t("Speichern", "Save")}
                </>
              )}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
