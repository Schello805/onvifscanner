"use client";

import React, { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { Lock, Eye, EyeOff, ShieldCheck, Languages } from "lucide-react";
import { useLanguage } from "./LanguageProvider";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { lang, toggleLang, t } = useLanguage();
  const [checking, setChecking] = useState(true);
  const [authEnabled, setAuthEnabled] = useState(false);
  const [authenticated, setAuthenticated] = useState(true);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/status", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setAuthEnabled(Boolean(data.authEnabled));
      setAuthenticated(Boolean(data.authenticated));
    } catch {
      // keep current state on transient network glitch
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void checkStatus();
    const onAuthChange = () => {
      void checkStatus();
    };
    window.addEventListener("onvifscanner:auth-changed", onAuthChange);
    return () => window.removeEventListener("onvifscanner:auth-changed", onAuthChange);
  }, [checkStatus]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!password.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          data.error ||
            t("Falsches Passwort oder PIN.", "Incorrect password or PIN.")
        );
        return;
      }
      setPassword("");
      setAuthenticated(true);
      window.dispatchEvent(new CustomEvent("onvifscanner:wall-updated"));
    } catch {
      setError(t("Verbindungsfehler bei der Anmeldung.", "Connection error during login."));
    } finally {
      setSubmitting(false);
    }
  }

  if (!checking && authEnabled && !authenticated) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-950 px-4 py-8 text-slate-100">
        <div className="w-full max-w-md rounded-3xl border border-slate-800/90 bg-slate-900/90 p-6 sm:p-8 shadow-2xl shadow-black/60 backdrop-blur-xl">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="relative h-11 w-11 overflow-hidden rounded-2xl border border-slate-700/70 bg-slate-950 shadow-md">
                <Image
                  src="/logo.png"
                  alt="ONVIFscanner NVR"
                  fill
                  className="object-cover"
                  sizes="44px"
                  priority
                />
              </div>
              <div>
                <h1 className="text-base font-bold text-white">ONVIFscanner NVR</h1>
                <p className="text-xs text-slate-400">
                  {t("Geschützter Zugriff", "Protected Access")}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={toggleLang}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10"
            >
              <Languages className="h-3.5 w-3.5 text-indigo-400" />
              <span className="uppercase">{lang}</span>
            </button>
          </div>

          <div className="mb-5 flex items-center gap-2.5 rounded-2xl border border-indigo-500/25 bg-indigo-500/10 px-3.5 py-2.5 text-xs text-indigo-200">
            <ShieldCheck className="h-4 w-4 shrink-0 text-indigo-400" />
            <span>
              {t(
                "Bitte gib das App-Passwort oder die PIN ein, um auf Kameras und Aufnahmen zuzugreifen.",
                "Please enter the app password or PIN to access cameras and recordings."
              )}
            </span>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-300">
                {t("App-Passwort / PIN", "App Password / PIN")}
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoFocus
                  className="w-full rounded-xl border border-slate-700/80 bg-slate-950 py-2.5 pl-10 pr-10 text-sm text-white placeholder-slate-600 focus:border-indigo-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                  aria-label={t("Passwort anzeigen", "Show password")}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-200">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !password.trim()}
              className="w-full rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-600/25 transition hover:bg-indigo-500 disabled:opacity-50"
            >
              {submitting
                ? t("Prüfe...", "Verifying...")
                : t("Entsperren", "Unlock")}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
