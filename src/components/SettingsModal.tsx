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
  HardDrive,
  CheckCircle2,
  Download,
  Upload,
  BellRing,
  Database,
  FileJson,
  Car,
  AlertTriangle,
  Globe,
  Clock,
  Sparkles,
  Sliders,
  Cloud,
} from "lucide-react";
import { useToast } from "./ToastProvider";
import { useLanguage } from "./LanguageProvider";
import { useBodyScrollLock } from "@/lib/useBodyScrollLock";
import { KnownEntitiesModal } from "./camera/KnownEntitiesModal";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

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
  timezone: string;
  motionMinAreaPercent: number;
  motionPixelThreshold: number;
  offsiteBackupEnabled?: boolean;
  offsiteBackupUrl?: string;
  offsiteBackupUsername?: string;
  offsiteBackupPassword?: string;
};

type TabType = "general" | "notifications" | "security" | "entities" | "backup";

const COMMON_TIMEZONES = [
  { value: "Europe/Berlin", label: "Europe/Berlin (Deutschland, Österreich, Schweiz - MEZ/MESZ)" },
  { value: "Europe/Vienna", label: "Europe/Vienna (Wien, Österreich)" },
  { value: "Europe/Zurich", label: "Europe/Zurich (Zürich/Bern, Schweiz)" },
  { value: "Europe/London", label: "Europe/London (London, Vereinigtes Königreich - GMT/BST)" },
  { value: "Europe/Paris", label: "Europe/Paris (Paris, Frankreich)" },
  { value: "Europe/Rome", label: "Europe/Rome (Rom, Italien)" },
  { value: "Europe/Madrid", label: "Europe/Madrid (Madrid, Spanien)" },
  { value: "Europe/Amsterdam", label: "Europe/Amsterdam (Amsterdam, Niederlande)" },
  { value: "Europe/Warsaw", label: "Europe/Warsaw (Warschau, Polen)" },
  { value: "Europe/Athens", label: "Europe/Athens (Athen, Griechenland - OEZ/OESZ)" },
  { value: "UTC", label: "UTC (Koordinierte Weltzeit / Coordinated Universal Time)" },
  { value: "America/New_York", label: "America/New_York (New York, US Eastern Time)" },
  { value: "America/Chicago", label: "America/Chicago (Chicago, US Central Time)" },
  { value: "America/Denver", label: "America/Denver (Denver, US Mountain Time)" },
  { value: "America/Los_Angeles", label: "America/Los_Angeles (Los Angeles, US Pacific Time)" },
  { value: "Asia/Dubai", label: "Asia/Dubai (Dubai, VAE)" },
  { value: "Asia/Tokyo", label: "Asia/Tokyo (Tokio, Japan)" },
  { value: "Australia/Sydney", label: "Australia/Sydney (Sydney, Australien)" },
];

export function SettingsModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const { lang, setLang, t } = useLanguage();
  const [activeTab, setActiveTab] = useState<TabType>("general");
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
    timezone: "Europe/Berlin",
    motionMinAreaPercent: 1.5,
    motionPixelThreshold: 18,
    offsiteBackupEnabled: false,
    offsiteBackupUrl: "",
    offsiteBackupUsername: "",
    offsiteBackupPassword: "",
  });
  const [newAppPassword, setNewAppPassword] = useState("");
  const [showAppPassword, setShowAppPassword] = useState(false);
  const [showTelegramToken, setShowTelegramToken] = useState(false);
  const [disableAppPassword, setDisableAppPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTestingNtfy, setIsTestingNtfy] = useState(false);
  const [isTestingTelegram, setIsTestingTelegram] = useState(false);
  const [liveClock, setLiveClock] = useState<string>("");

  // Web-Push
  const [isSecureContext, setIsSecureContext] = useState(true);
  const [isPushSupported, setIsPushSupported] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [pushDeviceCount, setPushDeviceCount] = useState<number | null>(null);
  const [pushLoading, setPushLoading] = useState(false);
  const [pushTesting, setPushTesting] = useState(false);

  // Backup & Restore
  const [backupFile, setBackupFile] = useState<File | null>(null);
  const [backupParsed, setBackupParsed] = useState<any | null>(null);
  const [restoreMode, setRestoreMode] = useState<"merge" | "replace">("merge");
  const [isRestoring, setIsRestoring] = useState(false);
  const [isDownloadingBackup, setIsDownloadingBackup] = useState(false);
  const [isKnownEntitiesOpen, setIsKnownEntitiesOpen] = useState(false);

  useBodyScrollLock(isOpen);

  // Live ticking clock in selected timezone
  useEffect(() => {
    if (!isOpen) return;
    const updateClock = () => {
      try {
        const tz = data.timezone || "Europe/Berlin";
        const now = new Date();
        const formatted = new Intl.DateTimeFormat(lang === "en" ? "en-US" : "de-DE", {
          timeZone: tz,
          dateStyle: "medium",
          timeStyle: "medium",
        }).format(now);
        setLiveClock(formatted);
      } catch {
        setLiveClock(new Date().toLocaleTimeString());
      }
    };
    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, [data.timezone, isOpen, lang]);

  const checkPushStatus = useCallback(async () => {
    if (typeof window === "undefined") return;

    try {
      const res = await fetch("/api/push");
      if (res.ok) {
        const json = await res.json();
        setPushDeviceCount(json.activeCount ?? 0);
      } else {
        setPushDeviceCount(0);
      }
    } catch {
      setPushDeviceCount(0);
    }

    const isSecure =
      window.isSecureContext ??
      (window.location.protocol === "https:" ||
        window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1");
    setIsSecureContext(Boolean(isSecure));

    const supported =
      Boolean(isSecure) &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;
    setIsPushSupported(supported);
    if (!supported) return;

    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        const sub = await reg.pushManager.getSubscription();
        setIsSubscribed(Boolean(sub));
      }
    } catch {
      // ignore
    }
  }, []);

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
        timezone: json.timezone || "Europe/Berlin",
        motionMinAreaPercent: json.motionMinAreaPercent != null ? Number(json.motionMinAreaPercent) : 1.5,
        motionPixelThreshold: json.motionPixelThreshold != null ? Number(json.motionPixelThreshold) : 18,
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
      void checkPushStatus();
    }
  }, [isOpen, loadSettings, checkPushStatus]);

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
          timezone: data.timezone || "Europe/Berlin",
          motionMinAreaPercent: data.motionMinAreaPercent,
          motionPixelThreshold: data.motionPixelThreshold,
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
      if (!res.ok)
        throw new Error(
          response.error || t("Testnachricht konnte nicht gesendet werden.", "Test notification could not be sent.")
        );
      toast.success(t("ntfy Testnachricht wurde erfolgreich gesendet.", "ntfy test notification sent successfully."));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("Testnachricht konnte nicht gesendet werden.", "Test notification could not be sent.")
      );
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
      if (!res.ok)
        throw new Error(
          response.error || t("Testnachricht konnte nicht gesendet werden.", "Test notification could not be sent.")
        );
      toast.success(t("Telegram Testnachricht wurde erfolgreich gesendet.", "Telegram test notification sent successfully."));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("Testnachricht konnte nicht gesendet werden.", "Test notification could not be sent.")
      );
    } finally {
      setIsTestingTelegram(false);
    }
  }

  // Web-Push Handlers
  async function handleSubscribePush() {
    setPushLoading(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        throw new Error(
          t(
            "Berechtigung für Benachrichtigungen wurde im Browser verweigert.",
            "Notification permission was denied in your browser."
          )
        );
      }

      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      const res = await fetch("/api/push");
      const json = await res.json();
      if (!res.ok || !json.vapidPublicKey) {
        throw new Error(
          json.error || t("VAPID Public Key konnte nicht abgerufen werden.", "Failed to fetch VAPID key.")
        );
      }

      const appServerKey = urlBase64ToUint8Array(json.vapidPublicKey);
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: appServerKey,
      });

      const saveRes = await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "subscribe",
          subscription: sub.toJSON(),
          userAgent: navigator.userAgent,
        }),
      });
      const saveJson = await saveRes.json();
      if (!saveRes.ok) throw new Error(saveJson.error || "Fehler beim Speichern des Push-Abonnements.");

      setIsSubscribed(true);
      setPushDeviceCount(saveJson.activeCount ?? ((pushDeviceCount || 0) + 1));
      toast.success(
        t("Web-Push für dieses Gerät erfolgreich aktiviert!", "Web push successfully enabled for this device!")
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("Fehler bei der Push-Aktivierung.", "Error enabling push."));
    } finally {
      setPushLoading(false);
    }
  }

  async function handleUnsubscribePush() {
    setPushLoading(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          const endpoint = sub.endpoint;
          await sub.unsubscribe();
          await fetch("/api/push", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "unsubscribe", endpoint }),
          });
        }
      }
      setIsSubscribed(false);
      setPushDeviceCount((prev) => Math.max(0, (prev || 1) - 1));
      toast.success(t("Web-Push für dieses Gerät deaktiviert.", "Web push disabled for this device."));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("Fehler beim Deaktivieren.", "Error disabling push."));
    } finally {
      setPushLoading(false);
    }
  }

  async function handleTestPush() {
    setPushTesting(true);
    try {
      const res = await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Test fehlgeschlagen");
      if (json.sentCount === 0) {
        toast.warning(
          t(
            "Kein aktives Push-Gerät registriert. Bitte aktiviere Push zuerst auf diesem Gerät.",
            "No active push devices registered. Please enable push on this device first."
          )
        );
      } else {
        toast.success(
          t(`Test-Push an ${json.sentCount} Gerät(e) gesendet!`, `Test push sent to ${json.sentCount} device(s)!`)
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("Test-Push fehlgeschlagen.", "Test push failed."));
    } finally {
      setPushTesting(false);
    }
  }

  // Backup & Restore Handlers
  async function handleDownloadBackup() {
    setIsDownloadingBackup(true);
    try {
      const res = await fetch("/api/system/backup");
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Backup fehlgeschlagen");
      }
      const blob = await res.blob();
      const dateStr = new Date().toISOString().split("T")[0];
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `onvifscanner-backup-${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast.success(t("Backup erfolgreich heruntergeladen!", "Backup downloaded successfully!"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("Backup-Download fehlgeschlagen.", "Backup download failed."));
    } finally {
      setIsDownloadingBackup(false);
    }
  }

  function handleBackupFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBackupFile(file);
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        if (!json.version || (!json.cameras && !json.storageTargets)) {
          throw new Error("Ungültiges Backup-Format");
        }
        setBackupParsed(json);
        toast.success(
          t(
            `Backup geladen: ${json.cameras?.length || 0} Kamera(s) gefunden.`,
            `Backup loaded: ${json.cameras?.length || 0} camera(s) found.`
          )
        );
      } catch {
        setBackupFile(null);
        setBackupParsed(null);
        toast.error(
          t("Die Datei ist kein gültiges ONVIFscanner-Backup.", "The file is not a valid ONVIFscanner backup.")
        );
      }
    };
    reader.readAsText(file);
  }

  async function handleRestoreBackup() {
    if (!backupParsed) return;
    if (restoreMode === "replace") {
      const ok = window.confirm(
        t(
          "Achtung: Im Modus 'Ersetzen' werden alle aktuellen Kameras, die nicht in der Sicherung enthalten sind, gelöscht! Fortfahren?",
          "Warning: In 'Replace' mode, all current cameras not present in the backup will be deleted! Proceed?"
        )
      );
      if (!ok) return;
    }
    setIsRestoring(true);
    try {
      const res = await fetch("/api/system/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: restoreMode,
          backup: backupParsed,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Wiederherstellung fehlgeschlagen");

      toast.success(
        t(`Erfolgreich ${json.count} Kamera(s) wiederhergestellt!`, `Successfully restored ${json.count} camera(s)!`)
      );
      setBackupFile(null);
      setBackupParsed(null);
      window.dispatchEvent(new CustomEvent("onvifscanner:wall-updated"));
      await loadSettings();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("Wiederherstellung fehlgeschlagen.", "Restore failed."));
    } finally {
      setIsRestoring(false);
    }
  }

  if (!isOpen) return null;

  const hasActiveNotifications = Boolean(
    isSubscribed || (data.telegramEnabled && data.telegramBotToken && data.telegramChatId) || data.ntfyTopic
  );

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center px-3 pt-[max(3.5rem,calc(env(safe-area-inset-top,0px)+1rem))] pb-[max(1rem,calc(env(safe-area-inset-bottom,0px)+0.75rem))] sm:p-5">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-md animate-in fade-in" onClick={onClose} />

      {/* Modal Container */}
      <div className="relative flex max-h-[82dvh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl bg-slate-900 border border-slate-700/70 shadow-2xl animate-in zoom-in-95 fade-in slide-in-from-bottom-4 sm:max-h-[calc(100dvh-3rem)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4 bg-slate-900/90">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-500/15 text-indigo-400 rounded-2xl border border-indigo-500/20 shadow-inner">
              <Settings2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-100 tracking-tight flex items-center gap-2">
                {t("Einstellungen", "Settings")}
                <span className="text-[10px] uppercase font-semibold text-indigo-400 px-2 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/20">
                  NVR
                </span>
              </h2>
              <p className="text-xs text-slate-400 hidden sm:block">
                {t(
                  "Sprache, Zeitzone, Benachrichtigungen & Sicherheit",
                  "Language, timezone, notifications & security"
                )}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="rounded-xl p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-100 transition-colors"
            aria-label={t("Schließen", "Close")}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation Bar */}
        <div className="flex items-center gap-1.5 px-4 sm:px-6 py-2.5 border-b border-slate-800/80 bg-slate-950/50 overflow-x-auto no-scrollbar">
          <button
            type="button"
            onClick={() => setActiveTab("general")}
            className={`group flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all shrink-0 ${
              activeTab === "general"
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
            }`}
          >
            <Globe className="w-4 h-4" />
            <span>{t("Allgemein", "General")}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("notifications")}
            className={`group flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all shrink-0 ${
              activeTab === "notifications"
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
            }`}
          >
            <Bell className="w-4 h-4" />
            <span>{t("Benachrichtigungen", "Notifications")}</span>
            {hasActiveNotifications && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("security")}
            className={`group flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all shrink-0 ${
              activeTab === "security"
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
            }`}
          >
            <Shield className="w-4 h-4" />
            <span>{t("Sicherheit", "Security")}</span>
            {data.authEnabled && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("entities")}
            className={`group flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all shrink-0 ${
              activeTab === "entities"
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
            }`}
          >
            <Car className="w-4 h-4" />
            <span>{t("Fahrzeuge & KI", "Vehicles & AI")}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("backup")}
            className={`group flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all shrink-0 ${
              activeTab === "backup"
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
            }`}
          >
            <Database className="w-4 h-4" />
            <span>{t("Backup", "Backup")}</span>
          </button>
        </div>

        {/* Content Area */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5 sm:p-6 bg-slate-900/60">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <span className="loading loading-spinner loading-lg text-indigo-500"></span>
              <span className="text-xs text-slate-400">{t("Einstellungen werden geladen...", "Loading settings...")}</span>
            </div>
          ) : (
            <div className="space-y-6">
              {/* ───────────────── TAB: GENERAL (Sprache, Zeitzone, Cleanup) ───────────────── */}
              {activeTab === "general" && (
                <div className="space-y-6 animate-in fade-in duration-200">
                  {/* LANGUAGE CARD */}
                  <div className="rounded-2xl border border-slate-800/90 bg-slate-950/50 p-5 space-y-4 shadow-sm">
                    <div className="flex items-center gap-2.5">
                      <div className="p-1.5 rounded-xl bg-indigo-500/15 text-indigo-400 border border-indigo-500/20">
                        <Languages className="w-4 h-4" />
                      </div>
                      <div>
                        <span className="font-semibold text-slate-100 text-sm">
                          {t("Sprache / Language", "Language / Sprache")}
                        </span>
                        <p className="text-[11px] text-slate-400">
                          {t("Wähle deine bevorzugte Anzeigesprache", "Select your preferred display language")}
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                      {/* German Option */}
                      <button
                        type="button"
                        onClick={() => setLang("de")}
                        className={`flex items-center justify-between p-3.5 rounded-xl border transition-all text-left ${
                          lang === "de"
                            ? "border-indigo-500 bg-indigo-600/15 text-white ring-1 ring-indigo-500/50 shadow-sm"
                            : "border-slate-800 bg-slate-900/50 text-slate-300 hover:border-slate-700 hover:bg-slate-900"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-2xl" role="img" aria-label="Deutschland">
                            🇩🇪
                          </span>
                          <div>
                            <div className="text-xs font-bold text-slate-100">Deutsch</div>
                            <div className="text-[10px] text-slate-400">Deutsche Benutzeroberfläche</div>
                          </div>
                        </div>
                        {lang === "de" && <CheckCircle2 className="w-4 h-4 text-indigo-400 shrink-0" />}
                      </button>

                      {/* English Option */}
                      <button
                        type="button"
                        onClick={() => setLang("en")}
                        className={`flex items-center justify-between p-3.5 rounded-xl border transition-all text-left ${
                          lang === "en"
                            ? "border-indigo-500 bg-indigo-600/15 text-white ring-1 ring-indigo-500/50 shadow-sm"
                            : "border-slate-800 bg-slate-900/50 text-slate-300 hover:border-slate-700 hover:bg-slate-900"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-2xl" role="img" aria-label="English">
                            🇬🇧
                          </span>
                          <div>
                            <div className="text-xs font-bold text-slate-100">English</div>
                            <div className="text-[10px] text-slate-400">English user interface</div>
                          </div>
                        </div>
                        {lang === "en" && <CheckCircle2 className="w-4 h-4 text-indigo-400 shrink-0" />}
                      </button>
                    </div>
                  </div>

                  {/* TIMEZONE & LIVE CLOCK CARD */}
                  <div className="rounded-2xl border border-slate-800/90 bg-slate-950/50 p-5 space-y-4 shadow-sm">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="p-1.5 rounded-xl bg-amber-500/15 text-amber-400 border border-amber-500/20">
                          <Clock className="w-4 h-4" />
                        </div>
                        <div>
                          <span className="font-semibold text-slate-100 text-sm">
                            {t("Zeitzone & Uhrzeit", "Timezone & Local Clock")}
                          </span>
                          <p className="text-[11px] text-slate-400">
                            {t(
                              "Bestimmt die Zeitangaben für Ereignisse, Aufnahmen und Zeitpläne",
                              "Defines timestamps for events, recordings, and motion schedules"
                            )}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Timezone Select */}
                    <div className="space-y-1.5 pt-1">
                      <label className="text-[11px] font-medium text-slate-400 block">
                        {t("System-Zeitzone (IANA)", "System Timezone (IANA)")}
                      </label>
                      <select
                        className="select select-bordered select-sm w-full bg-slate-900 border-slate-800 text-slate-200 text-xs rounded-xl focus:border-indigo-500"
                        value={data.timezone}
                        onChange={(e) => setData({ ...data, timezone: e.target.value })}
                      >
                        {COMMON_TIMEZONES.map((tz) => (
                          <option key={tz.value} value={tz.value}>
                            {tz.label}
                          </option>
                        ))}
                        {!COMMON_TIMEZONES.some((tz) => tz.value === data.timezone) && (
                          <option value={data.timezone}>{data.timezone} (Benutzerdefiniert)</option>
                        )}
                      </select>
                    </div>

                    {/* Live Clock Preview Badge */}
                    <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-3.5 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-2.5 w-2.5 relative">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                        </span>
                        <div>
                          <div className="text-[10px] uppercase font-bold tracking-wider text-emerald-400">
                            {t("Aktuelle NVR-Uhrzeit", "Current NVR Local Time")}
                          </div>
                          <div className="text-sm sm:text-base font-bold font-mono text-slate-100">
                            {liveClock || "..."}
                          </div>
                        </div>
                      </div>
                      <div className="text-right hidden sm:block">
                        <span className="text-[10px] font-mono text-slate-400 bg-slate-900 px-2 py-1 rounded-md border border-slate-800">
                          {data.timezone}
                        </span>
                      </div>
                    </div>

                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      {t(
                        "Alle Zeitstempel im Wiedergabemenü, im Dateinamen der MP4-Videos und in Push-Nachrichten richten sich nach dieser Zeitzone.",
                        "All timestamps in playback, MP4 video filenames, and push notifications follow this timezone."
                      )}
                    </p>
                  </div>

                  {/* MOTION DETECTION THRESHOLD CARD */}
                  <div className="rounded-2xl border border-slate-800/90 bg-slate-950/50 p-5 space-y-4 shadow-sm">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="p-1.5 rounded-xl bg-purple-500/15 text-purple-400 border border-purple-500/20">
                          <Sliders className="w-4 h-4" />
                        </div>
                        <div>
                          <span className="font-semibold text-slate-100 text-sm">
                            {t("Bewegungserkennung (Server-Bildanalyse)", "Motion Detection (Server Analysis)")}
                          </span>
                          <p className="text-[11px] text-slate-400">
                            {t(
                              "Schwellenwert für Bildveränderungen (Prozent & Pixel), ab wann Bewegung ausgelöst wird",
                              "Threshold for frame changes (percentage & pixels) before motion is triggered"
                            )}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Minimum Motion Area (% of frame) */}
                    <div className="space-y-2 pt-1">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold text-slate-200">
                          {t("Mindest-Bewegungsfläche (% vom Bildschirm)", "Minimum Motion Area (% of screen)")}
                        </label>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-purple-400 font-mono">
                            {data.motionMinAreaPercent}%
                          </span>
                          <span className="text-[10px] text-slate-400 bg-slate-900 px-2 py-0.5 rounded-md border border-slate-800 font-mono">
                            ≈ {Math.round(207.36 * (data.motionMinAreaPercent || 1.5))} Pixel (bei 192×108)
                          </span>
                        </div>
                      </div>

                      {/* Slider */}
                      <input
                        type="range"
                        min={0.2}
                        max={10.0}
                        step={0.1}
                        value={data.motionMinAreaPercent}
                        onChange={(e) => setData({ ...data, motionMinAreaPercent: Number(e.target.value) })}
                        className="range range-primary range-sm w-full"
                        aria-label="Mindest-Bewegungsfläche"
                      />

                      {/* Quick Presets Buttons */}
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {[
                          { val: 0.5, label: "0.5% (Sehr fein)" },
                          { val: 1.0, label: "1.0% (Fein)" },
                          { val: 1.5, label: "1.5% (Standard)" },
                          { val: 2.5, label: "2.5% (Mittel)" },
                          { val: 3.5, label: "3.5% (Empfohlen)" },
                          { val: 5.0, label: "5.0% (Person nah)" },
                          { val: 8.0, label: "8.0% (Groß)" },
                        ].map((preset) => (
                          <button
                            key={preset.val}
                            type="button"
                            onClick={() => setData({ ...data, motionMinAreaPercent: preset.val })}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
                              Math.abs((data.motionMinAreaPercent || 1.5) - preset.val) < 0.05
                                ? "bg-purple-600 text-white shadow-sm shadow-purple-600/30"
                                : "bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
                            }`}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>

                      <p className="text-[11px] text-slate-400 leading-relaxed pt-1">
                        {t(
                          "Bewegungen, die kleiner als dieser Schwellenwert sind (wie z. B. wackelnde Kissen, Zweige, flatternde Blätter oder fliegende Insekten), werden ignoriert. Bei z. B. 3–4% lösen Personen und Autos zuverlässig aus.",
                          "Movements smaller than this threshold (e.g. swaying cushions, twigs, fluttering leaves, or insects) are ignored. At 3-4%, humans and vehicles still trigger reliably."
                        )}
                      </p>
                    </div>

                    {/* Pixel Difference Threshold */}
                    <div className="border-t border-slate-800/80 pt-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <label className="text-xs font-semibold text-slate-200 block">
                            {t("Pixel-Änderungsschwelle (Helligkeit/Farbe)", "Pixel Change Threshold (Brightness/Color)")}
                          </label>
                          <span className="text-[10px] text-slate-400 block">
                            {t("Wie deutlich sich ein einzelner Pixel verändern muss (10 = empfindlich, 35 = robust)", "How much a single pixel must change (10 = sensitive, 35 = robust)")}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-200 font-mono">
                            {data.motionPixelThreshold} / 255
                          </span>
                        </div>
                      </div>

                      <input
                        type="range"
                        min={10}
                        max={40}
                        step={1}
                        value={data.motionPixelThreshold}
                        onChange={(e) => setData({ ...data, motionPixelThreshold: Number(e.target.value) })}
                        className="range range-xs range-secondary w-full"
                        aria-label="Pixel-Änderungsschwelle"
                      />
                    </div>
                  </div>

                  {/* AUTO CLEANUP CARD */}
                  <div className="rounded-2xl border border-slate-800/90 bg-slate-950/50 p-5 space-y-3 shadow-sm">
                    <div className="flex items-center gap-2.5">
                      <div className="p-1.5 rounded-xl bg-sky-500/15 text-sky-400 border border-sky-500/20">
                        <HardDrive className="w-4 h-4" />
                      </div>
                      <div>
                        <span className="font-semibold text-slate-100 text-sm">
                          {t("Speicher-Bereinigung", "Storage Cleanup")}
                        </span>
                        <p className="text-[11px] text-slate-400">
                          {t("Automatische Speicherplatzverwaltung", "Automatic disk space management")}
                        </p>
                      </div>
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
                            "Löscht älteste Aufnahmen automatisch, wenn der freie Speicherplatz unter den Schwellenwert des Speicherziels fällt.",
                            "Automatically deletes oldest recordings when free storage falls below the target threshold."
                          )}
                        </span>
                      </div>
                    </label>
                  </div>
                </div>
              )}

              {/* ───────────────── TAB: NOTIFICATIONS (Web-Push, Telegram, ntfy) ───────────────── */}
              {activeTab === "notifications" && (
                <div className="space-y-6 animate-in fade-in duration-200">
                  {/* WEB-PUSH CARD */}
                  <div className="rounded-2xl border border-purple-500/30 bg-slate-950/50 p-5 space-y-4 shadow-sm relative overflow-hidden">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="p-1.5 rounded-xl bg-purple-500/20 text-purple-400 border border-purple-500/30">
                          <BellRing className="w-4 h-4" />
                        </div>
                        <div>
                          <span className="font-semibold text-slate-100 text-sm flex items-center gap-1.5">
                            Web-Push (Browser & Smartphone PWA)
                            {isSubscribed && <span className="inline-block w-2 h-2 rounded-full bg-purple-400"></span>}
                          </span>
                        </div>
                      </div>

                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                          isSubscribed
                            ? "border border-purple-500/40 bg-purple-500/15 text-purple-300"
                            : "border border-slate-700 bg-slate-800/80 text-slate-400"
                        }`}
                      >
                        {isSubscribed ? (
                          <>
                            <CheckCircle2 className="w-3 h-3 text-purple-400" />
                            {t("Aktiv auf diesem Gerät", "Active on this device")}
                          </>
                        ) : (
                          t("Nicht abonniert", "Not subscribed")
                        )}
                      </span>
                    </div>

                    <p className="text-xs text-slate-400 leading-relaxed">
                      {t(
                        "Direkte Benachrichtigungen im Browser oder auf dem Smartphone (PWA) ohne Drittanbieter. Auf iOS: Einmalig über 'Zum Home-Bildschirm' installieren.",
                        "Direct push notifications in your browser or phone (PWA) without third-party services. On iOS: Install via 'Add to Home Screen' first."
                      )}
                    </p>

                    {!isSecureContext ? (
                      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-[11px] text-amber-200 leading-relaxed space-y-1">
                        <div className="font-semibold flex items-center gap-1.5 text-amber-300">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          <span>{t("HTTPS erforderlich für Web-Push", "HTTPS required for Web-Push")}</span>
                        </div>
                        <p className="text-slate-300 text-[11px]">
                          {t(
                            "Browser erlauben Web-Push ausschließlich über HTTPS (oder localhost). Bei unverschlüsseltem HTTP sperrt der Browser die Push-Funktion.",
                            "Browsers restrict Web-Push to HTTPS (or localhost). On unencrypted HTTP, push is blocked."
                          )}
                        </p>
                        <p className="text-amber-200/90 text-[11px] font-medium pt-0.5">
                          💡 {t("Tipp: Nutze für HTTP alternativ Telegram oder ntfy.", "Tip: Use Telegram or ntfy as an alternative over HTTP.")}
                        </p>
                      </div>
                    ) : null}

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/60">
                      <div className="text-[11px] text-slate-400">
                        {pushDeviceCount !== null && (
                          <span>
                            {t("Registrierte Geräte:", "Registered devices:")}{" "}
                            <strong className="text-slate-200 font-semibold">{pushDeviceCount}</strong>
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {isSubscribed ? (
                          <button
                            type="button"
                            onClick={handleUnsubscribePush}
                            disabled={pushLoading}
                            className="btn btn-xs border border-rose-500/30 bg-rose-500/15 text-rose-200 hover:bg-rose-500/25 disabled:opacity-40 rounded-lg"
                          >
                            {pushLoading ? <span className="loading loading-spinner loading-xs" /> : t("Deaktivieren", "Disable")}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={handleSubscribePush}
                            disabled={pushLoading || !isPushSupported}
                            className="btn btn-xs border border-purple-500/50 bg-purple-600 hover:bg-purple-500 !text-white font-semibold disabled:opacity-40 rounded-lg gap-1.5 shadow-sm"
                          >
                            {pushLoading ? <span className="loading loading-spinner loading-xs" /> : <BellRing className="w-3 h-3 text-white" />}
                            <span>{t("Auf diesem Gerät aktivieren", "Enable on this device")}</span>
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={handleTestPush}
                          disabled={pushTesting || ((pushDeviceCount ?? 0) === 0 && !isSubscribed)}
                          className="btn btn-xs border border-purple-500/30 bg-purple-500/15 text-purple-200 hover:bg-purple-500/25 disabled:opacity-40 rounded-lg gap-1.5"
                        >
                          {pushTesting ? <span className="loading loading-spinner loading-xs" /> : <Send className="h-3 w-3" />}
                          <span>{t("Test-Push", "Test Push")}</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* TELEGRAM CARD */}
                  <div className="rounded-2xl border border-sky-500/30 bg-slate-950/50 p-5 space-y-4 shadow-sm relative overflow-hidden">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="p-1.5 rounded-xl bg-sky-500/20 text-sky-400 border border-sky-500/30">
                          <Send className="w-4 h-4" />
                        </div>
                        <div>
                          <span className="font-semibold text-slate-100 text-sm flex items-center gap-1.5">
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
                        "Erhalte Alarmbenachrichtigungen inklusive Schnappschuss direkt über einen Telegram-Bot.",
                        "Receive alarm notifications including snapshot images directly via Telegram bot."
                      )}
                    </p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                              className="text-slate-500 hover:text-slate-300 p-1"
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
                        <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-400">
                          {t(
                            "Benachrichtigt, wenn eine Kamera die Verbindung verliert oder wieder erreichbar ist.",
                            "Alerts when a camera goes offline or recovers connection."
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
                        {isTestingTelegram ? <span className="loading loading-spinner loading-xs" /> : <Send className="h-3 w-3" />}
                        <span>{t("Telegram Testen", "Test Telegram")}</span>
                      </button>
                    </div>
                  </div>

                  {/* NTFY CARD */}
                  <div className="rounded-2xl border border-emerald-500/30 bg-slate-950/50 p-5 space-y-4 shadow-sm relative overflow-hidden">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="p-1.5 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                          <Bell className="w-4 h-4" />
                        </div>
                        <span className="font-semibold text-slate-100 text-sm flex items-center gap-1.5">
                          ntfy
                          {data.ntfyTopic && <span className="inline-block w-2 h-2 rounded-full bg-emerald-400"></span>}
                        </span>
                      </div>
                    </div>

                    <p className="text-xs text-slate-400 leading-relaxed">
                      {t(
                        "Kostenloser Open-Source Push-Dienst. Ohne Server-Angabe wird ntfy.sh genutzt.",
                        "Free open-source push service. Defaults to ntfy.sh if left empty."
                      )}
                    </p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-medium text-slate-400 mb-1">Server</label>
                        <input
                          type="text"
                          className="input input-bordered input-sm w-full bg-slate-900 border-slate-800 text-slate-200 text-xs rounded-xl focus:border-emerald-500"
                          placeholder="https://ntfy.sh"
                          value={data.ntfyServer || ""}
                          onChange={(e) => setData({ ...data, ntfyServer: e.target.value })}
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-medium text-slate-400 mb-1">Topic</label>
                        <input
                          type="text"
                          className="input input-bordered input-sm w-full bg-slate-900 border-slate-800 text-slate-200 text-xs rounded-xl focus:border-emerald-500"
                          placeholder={t("mein-geheimes-topic-123", "my-secret-topic-123")}
                          value={data.ntfyTopic || ""}
                          onChange={(e) => setData({ ...data, ntfyTopic: e.target.value })}
                        />
                      </div>
                    </div>

                    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-800/80 bg-slate-900/60 p-3 hover:bg-slate-900 transition-colors">
                      <input
                        type="checkbox"
                        className="toggle toggle-success toggle-xs mt-0.5 shrink-0"
                        checked={data.ntfyCameraStatusEnabled}
                        onChange={(e) => setData({ ...data, ntfyCameraStatusEnabled: e.target.checked })}
                      />
                      <div>
                        <strong className="block text-xs font-medium text-slate-200">
                          {t("Online-/Offline-Meldungen", "Online / Offline Alerts")}
                        </strong>
                        <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-400">
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
                        {isTestingNtfy ? <span className="loading loading-spinner loading-xs" /> : <Send className="h-3 w-3" />}
                        <span>{t("ntfy Testen", "Test ntfy")}</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ───────────────── TAB: SECURITY (Passwort, PIN, Webhook) ───────────────── */}
              {activeTab === "security" && (
                <div className="space-y-6 animate-in fade-in duration-200">
                  {/* APP AUTHENTICATION CARD */}
                  <div className="rounded-2xl border border-slate-800/90 bg-slate-950/50 p-5 space-y-4 shadow-sm">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="p-1.5 rounded-xl bg-amber-500/15 text-amber-400 border border-amber-500/20">
                          <Shield className="w-4 h-4" />
                        </div>
                        <div>
                          <span className="font-semibold text-slate-100 text-sm">
                            {t("Sicherheit & Zugriffsschutz", "Security & Access Protection")}
                          </span>
                          <p className="text-[11px] text-slate-400">
                            {t("Passwort- oder PIN-Schutz für die Web-Oberfläche", "Password or PIN protection for the web interface")}
                          </p>
                        </div>
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
                        "Protects the web interface and API endpoints with a password or PIN. Camera passwords are encrypted with AES-256-GCM."
                      )}
                    </p>

                    <div className="space-y-1.5 pt-1">
                      <label className="text-[11px] font-medium text-slate-400 block">
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
                            className="text-slate-500 hover:text-slate-300 p-1"
                          >
                            {showAppPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                        )}
                      </label>
                    </div>

                    {data.authEnabled && !data.envAuthLocked && (
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/60">
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
                          <span className="text-xs">{t("Schutz deaktivieren", "Disable protection")}</span>
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
                  </div>

                  {/* WEBHOOK TOKEN CARD */}
                  <div className="rounded-2xl border border-slate-800/90 bg-slate-950/50 p-5 space-y-4 shadow-sm">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="p-1.5 rounded-xl bg-indigo-500/15 text-indigo-400 border border-indigo-500/20">
                          <RefreshCw className="w-4 h-4" />
                        </div>
                        <div>
                          <span className="font-semibold text-slate-100 text-sm">
                            {t("Webhook-Token", "Webhook Token")}
                          </span>
                          <p className="text-[11px] text-slate-400">
                            {t("Zur Absicherung von Alarm-Webhooks (Smart Home, Kameras)", "Secures alarm webhooks from cameras or smart home devices")}
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={generateRandomToken}
                        className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 font-semibold px-2.5 py-1 rounded-lg border border-indigo-500/30 bg-indigo-500/10 hover:bg-indigo-500/20 transition-colors"
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
                  </div>
                </div>
              )}

              {/* ───────────────── TAB: ENTITIES (Fahrzeuge & Kennzeichen) ───────────────── */}
              {activeTab === "entities" && (
                <div className="space-y-6 animate-in fade-in duration-200">
                  <div className="rounded-2xl border border-slate-800/90 bg-slate-950/50 p-6 space-y-4 shadow-sm">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-2xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                          <Car className="w-5 h-5" />
                        </div>
                        <div>
                          <span className="font-bold text-slate-100 text-base">
                            {t("Kennzeichen & Fahrzeuge", "License Plates & Vehicles")}
                          </span>
                          <p className="text-xs text-slate-400">
                            {t(
                              "Automatische Kennzeichenerkennung (OCR) & personalisierte Benachrichtigungen",
                              "Automatic license plate recognition (OCR) & personalized alerts"
                            )}
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => setIsKnownEntitiesOpen(true)}
                        className="btn btn-sm border border-emerald-500/40 bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 rounded-xl gap-2 font-semibold"
                      >
                        <Car className="w-4 h-4" />
                        <span>{t("Fahrzeuge verwalten...", "Manage vehicles...")}</span>
                      </button>
                    </div>

                    <p className="text-xs text-slate-300 leading-relaxed pt-2">
                      {t(
                        "Hinterlege eigene Fahrzeuge, Familie oder Lieferdienste für automatische Erkennung und gezielte Alarmierung bei Ankunft. Erkennt die Kamera ein hinterlegtes Kennzeichen, wird der Name (z. B. 'Familie Mustermann') direkt im Push-Alarm und in der Wiedergabe-Zeitleiste angezeigt.",
                        "Register family, personal, or delivery vehicles for automatic recognition and personalized arrival alerts. When a registered plate is seen, the name is displayed directly in push notifications and the playback timeline."
                      )}
                    </p>
                  </div>
                </div>
              )}

              {/* ───────────────── TAB: BACKUP (Export & Import) ───────────────── */}
              {activeTab === "backup" && (
                <div className="space-y-6 animate-in fade-in duration-200">
                  <div className="rounded-2xl border border-slate-800/90 bg-slate-950/50 p-6 space-y-5 shadow-sm">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-2xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                        <Database className="w-5 h-5" />
                      </div>
                      <div>
                        <span className="font-bold text-slate-100 text-base">
                          {t("Backup & Wiederherstellung", "Backup & Restore")}
                        </span>
                        <p className="text-xs text-slate-400">
                          {t(
                            "Sichere alle Kameras, Zugangsdaten und Einstellungen als JSON-Datei",
                            "Backup or restore all cameras, credentials, and settings as a JSON file"
                          )}
                        </p>
                      </div>
                    </div>

                    {/* Export */}
                    <div className="flex items-center justify-between gap-3 p-4 rounded-xl border border-slate-800/80 bg-slate-900/60">
                      <div>
                        <div className="text-xs font-semibold text-slate-200">
                          {t("Konfiguration sichern", "Backup Configuration")}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {t("JSON-Export aller Daten & Passwörter", "JSON export of all data & passwords")}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={handleDownloadBackup}
                        disabled={isDownloadingBackup}
                        className="btn btn-sm border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-xl gap-2 font-medium shrink-0"
                      >
                        {isDownloadingBackup ? <span className="loading loading-spinner loading-xs" /> : <Download className="w-4 h-4 text-emerald-400" />}
                        <span>{t("Backup herunterladen", "Download Backup")}</span>
                      </button>
                    </div>

                    {/* Import */}
                    <div className="p-4 rounded-xl border border-slate-800/80 bg-slate-900/60 space-y-3">
                      <div>
                        <div className="text-xs font-semibold text-slate-200">
                          {t("Backup einspielen", "Restore Backup")}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {t("JSON-Sicherungsdatei auswählen", "Select JSON backup file")}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <label className="btn btn-sm border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl gap-2 cursor-pointer">
                          <Upload className="w-4 h-4 text-sky-400 shrink-0" />
                          <span className="truncate max-w-[250px]">
                            {backupFile ? backupFile.name : t("Datei wählen...", "Choose file...")}
                          </span>
                          <input type="file" accept=".json,application/json" className="hidden" onChange={handleBackupFileChange} />
                        </label>
                        {backupFile && (
                          <button
                            type="button"
                            onClick={() => {
                              setBackupFile(null);
                              setBackupParsed(null);
                            }}
                            className="btn btn-sm btn-ghost text-slate-500 hover:text-slate-300 px-2"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </div>

                      {backupParsed && (
                        <div className="rounded-xl border border-indigo-500/30 bg-indigo-950/20 p-4 space-y-3 mt-2">
                          <div className="flex items-center justify-between text-xs text-indigo-200">
                            <span className="font-semibold flex items-center gap-1.5">
                              <FileJson className="w-4 h-4 text-indigo-400" />
                              {t("Sicherung geladen", "Backup Loaded")}
                            </span>
                            <span className="text-[11px] text-indigo-300/80">
                              {backupParsed.cameras?.length || 0} {t("Kameras", "cameras")}, {backupParsed.storageTargets?.length || 0} {t("Speicher", "storage")}
                            </span>
                          </div>

                          <div className="space-y-1.5">
                            <label className="text-[11px] font-medium text-slate-400 block">
                              {t("Wiederherstellungs-Modus", "Restore Mode")}
                            </label>
                            <div className="grid grid-cols-2 gap-2">
                              <button
                                type="button"
                                onClick={() => setRestoreMode("merge")}
                                className={`py-2 px-3 text-left rounded-xl border text-xs transition-all ${
                                  restoreMode === "merge"
                                    ? "border-indigo-500/60 bg-indigo-600/20 text-indigo-200 font-medium"
                                    : "border-slate-800 bg-slate-900/60 text-slate-400 hover:text-slate-300"
                                }`}
                              >
                                <div className="font-semibold text-xs">{t("Zusammenführen", "Merge")}</div>
                                <div className="text-[10px] text-slate-400">{t("Aktualisiert & fügt hinzu", "Updates & adds")}</div>
                              </button>
                              <button
                                type="button"
                                onClick={() => setRestoreMode("replace")}
                                className={`py-2 px-3 text-left rounded-xl border text-xs transition-all ${
                                  restoreMode === "replace"
                                    ? "border-rose-500/60 bg-rose-600/20 text-rose-200 font-medium"
                                    : "border-slate-800 bg-slate-900/60 text-slate-400 hover:text-slate-300"
                                }`}
                              >
                                <div className="font-semibold text-xs">{t("Ersetzen", "Replace")}</div>
                                <div className="text-[10px] text-slate-400">{t("Überschreibt alle Kameras", "Overwrites all cameras")}</div>
                              </button>
                            </div>
                          </div>

                          <div className="pt-2 flex justify-end">
                            <button
                              type="button"
                              onClick={handleRestoreBackup}
                              disabled={isRestoring}
                              className={`btn btn-sm rounded-xl gap-2 text-white font-medium ${
                                restoreMode === "replace" ? "bg-rose-600 hover:bg-rose-500" : "bg-indigo-600 hover:bg-indigo-500"
                              }`}
                            >
                              {isRestoring ? <span className="loading loading-spinner loading-xs" /> : <Upload className="w-4 h-4" />}
                              <span>
                                {restoreMode === "replace"
                                  ? t("Alles ersetzen & importieren", "Replace all & import")
                                  : t("Jetzt wiederherstellen", "Restore now")}
                              </span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Cloud / Offsite WebDAV Backup */}
                  <div className="rounded-2xl border border-slate-800/90 bg-slate-950/50 p-6 space-y-5 shadow-sm">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-2xl bg-sky-500/15 text-sky-400 border border-sky-500/20">
                          <Cloud className="w-5 h-5" />
                        </div>
                        <div>
                          <h3 className="text-sm font-semibold text-slate-100">
                            {t("Automatisches Offsite- & Cloud-Backup", "Automatic Offsite & Cloud Backup")}
                          </h3>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {t("Sichert neue Ereignisclips sofort per WebDAV auf Nextcloud, ownCloud oder NAS", "Mirrors new motion clips immediately via WebDAV to Nextcloud or NAS")}
                          </p>
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        className="toggle toggle-info toggle-sm"
                        checked={data.offsiteBackupEnabled ?? false}
                        onChange={(e) => setData({ ...data, offsiteBackupEnabled: e.target.checked })}
                      />
                    </div>

                    {data.offsiteBackupEnabled && (
                      <div className="space-y-3.5 pt-2 border-t border-slate-800/70 animate-in fade-in duration-150">
                        <div>
                          <label className="text-[11px] font-medium text-slate-400 block mb-1">
                            {t("WebDAV-Zielordner URL", "WebDAV Target Folder URL")}
                          </label>
                          <input
                            type="text"
                            placeholder="https://cloud.example.com/remote.php/dav/files/benutzer/NVR_Backups"
                            value={data.offsiteBackupUrl || ""}
                            onChange={(e) => setData({ ...data, offsiteBackupUrl: e.target.value })}
                            className="input input-sm w-full bg-slate-900 border-slate-800 text-xs text-slate-200"
                          />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="text-[11px] font-medium text-slate-400 block mb-1">
                              {t("Benutzername", "Username")}
                            </label>
                            <input
                              type="text"
                              placeholder="benutzername"
                              value={data.offsiteBackupUsername || ""}
                              onChange={(e) => setData({ ...data, offsiteBackupUsername: e.target.value })}
                              className="input input-sm w-full bg-slate-900 border-slate-800 text-xs text-slate-200"
                            />
                          </div>
                          <div>
                            <label className="text-[11px] font-medium text-slate-400 block mb-1">
                              {t("Passwort / App-Token", "Password / App Token")}
                            </label>
                            <input
                              type="password"
                              placeholder="••••••••"
                              value={data.offsiteBackupPassword || ""}
                              onChange={(e) => setData({ ...data, offsiteBackupPassword: e.target.value })}
                              className="input input-sm w-full bg-slate-900 border-slate-800 text-xs text-slate-200"
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-800 px-6 py-4 bg-slate-950/70">
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
              className="btn btn-sm bg-indigo-600 hover:bg-indigo-500 text-white border-none min-w-[130px] rounded-xl font-semibold shadow-lg shadow-indigo-600/30 gap-2"
              onClick={handleSave}
              disabled={isSaving || isLoading}
            >
              {isSaving ? (
                <span className="loading loading-spinner loading-xs"></span>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  {t("Speichern", "Save")}
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      <KnownEntitiesModal isOpen={isKnownEntitiesOpen} onClose={() => setIsKnownEntitiesOpen(false)} />
    </div>
  );
}
