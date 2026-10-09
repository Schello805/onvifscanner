"use client";

import React, { createContext, useContext, useState, useCallback } from "react";
import { CheckCircle2, AlertTriangle, AlertCircle, Info, X } from "lucide-react";

type ToastType = "success" | "error" | "info" | "warning";

type ToastItem = {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
};

type ToastContextType = {
  toast: {
    success: (message: string, duration?: number) => void;
    error: (message: string, duration?: number) => void;
    warning: (message: string, duration?: number) => void;
    info: (message: string, duration?: number) => void;
  };
};

const ToastContext = createContext<ToastContextType | null>(null);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback((message: string, type: ToastType, duration = 4000) => {
    const id = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    setToasts((prev) => [...prev, { id, message, type, duration }]);

    if (duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
    }
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toastMethods = {
    success: (msg: string, dur?: number) => addToast(msg, "success", dur),
    error: (msg: string, dur?: number) => addToast(msg, "error", dur),
    warning: (msg: string, dur?: number) => addToast(msg, "warning", dur),
    info: (msg: string, dur?: number) => addToast(msg, "info", dur),
  };

  return (
    <ToastContext.Provider value={{ toast: toastMethods }}>
      {children}
      {/* Toast Container */}
      <aside aria-label="Benachrichtigungen" className="fixed bottom-4 right-4 z-[99999] flex max-w-sm sm:max-w-md w-full flex-col gap-2.5 pointer-events-none p-3 sm:p-0">
        {toasts.map((t) => {
          let bgClass = "bg-slate-900 border-white/10 text-white";
          let icon = <Info className="h-5 w-5 text-sky-400 shrink-0" />;

          if (t.type === "success") {
            bgClass = "bg-emerald-950/90 border-emerald-500/40 text-emerald-100 shadow-[0_8px_25px_rgba(16,185,129,0.25)]";
            icon = <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />;
          } else if (t.type === "error") {
            bgClass = "bg-rose-950/90 border-rose-500/40 text-rose-100 shadow-[0_8px_25px_rgba(244,63,94,0.25)]";
            icon = <AlertCircle className="h-5 w-5 text-rose-400 shrink-0" />;
          } else if (t.type === "warning") {
            bgClass = "bg-amber-950/90 border-amber-500/40 text-amber-100 shadow-[0_8px_25px_rgba(245,158,11,0.25)]";
            icon = <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0" />;
          }

          return (
            <div
              key={t.id}
              role="alert"
              className={`pointer-events-auto flex items-start gap-3 rounded-xl border p-3.5 backdrop-blur-xl shadow-2xl transition-all duration-300 animate-in fade-in slide-in-from-bottom-3 ${bgClass}`}
            >
              {icon}
              <div className="flex-1 text-xs sm:text-sm font-medium leading-snug">
                {t.message}
              </div>
              <button
                type="button"
                onClick={() => removeToast(t.id)}
                className="rounded-lg p-0.5 text-white/50 hover:text-white transition-colors shrink-0"
                aria-label="Schließen"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </aside>
    </ToastContext.Provider>
  );
}
