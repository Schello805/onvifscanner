"use client";

import React, { createContext, useContext } from "react";
import { Toaster, toast as sonnerToast } from "sonner";

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
  const toastMethods = {
    success: (msg: string, dur?: number) => sonnerToast.success(msg, { duration: dur }),
    error: (msg: string, dur?: number) => sonnerToast.error(msg, { duration: dur }),
    warning: (msg: string, dur?: number) => sonnerToast.warning(msg, { duration: dur }),
    info: (msg: string, dur?: number) => sonnerToast.info(msg, { duration: dur }),
  };

  return (
    <ToastContext.Provider value={{ toast: toastMethods }}>
      {children}
      <Toaster theme="dark" richColors position="bottom-right" expand={true} />
    </ToastContext.Provider>
  );
}
