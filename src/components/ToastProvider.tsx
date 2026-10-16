"use client";

import React, { createContext, useContext, useMemo } from "react";
import { Toaster, toast as sonnerToast } from "sonner";
import { useLanguage } from "./LanguageProvider";

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
  const { tr } = useLanguage();

  const toastMethods = useMemo(
    () => ({
      success: (msg: string, dur?: number) => sonnerToast.success(tr(msg), { duration: dur }),
      error: (msg: string, dur?: number) => sonnerToast.error(tr(msg), { duration: dur }),
      warning: (msg: string, dur?: number) => sonnerToast.warning(tr(msg), { duration: dur }),
      info: (msg: string, dur?: number) => sonnerToast.info(tr(msg), { duration: dur }),
    }),
    [tr]
  );

  return (
    <ToastContext.Provider value={{ toast: toastMethods }}>
      {children}
      <Toaster theme="dark" richColors position="bottom-right" expand={true} />
    </ToastContext.Provider>
  );
}
