"use client";

import { useEffect, useRef, useState } from "react";
import { useLanguage } from "./LanguageProvider";

const FAILURE_THRESHOLD = 3;

export function ConnectionWatcher() {
  const { t } = useLanguage();
  const [isOffline, setIsOffline] = useState(false);
  const failCountRef = useRef(0);
  const isOfflineRef = useRef(false);
  const serverInfoRef = useRef<{ version?: string; uptimeSeconds?: number } | null>(null);

  useEffect(() => {
    isOfflineRef.current = isOffline;
  }, [isOffline]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;

    const checkHealth = async () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }

      try {
        const res = await fetch("/api/health", {
          cache: "no-store",
          signal: AbortSignal.timeout(10000),
        });

        if (!res.ok) throw new Error("HTTP error");

        const data = (await res.json().catch(() => null)) as {
          version?: string;
          uptimeSeconds?: number;
        } | null;

        failCountRef.current = 0;

        const prevServer = serverInfoRef.current;
        const serverRestarted = Boolean(
          prevServer &&
            data &&
            ((prevServer.version && data.version && prevServer.version !== data.version) ||
              (typeof prevServer.uptimeSeconds === "number" &&
                typeof data.uptimeSeconds === "number" &&
                data.uptimeSeconds + 5 < prevServer.uptimeSeconds))
        );

        if (data) {
          serverInfoRef.current = {
            version: data.version,
            uptimeSeconds: data.uptimeSeconds,
          };
        }

        if (isOfflineRef.current) {
          if (serverRestarted) {
            window.location.reload();
          } else {
            isOfflineRef.current = false;
            setIsOffline(false);
            window.dispatchEvent(new CustomEvent("onvifscanner:wall-updated"));
          }
        }
      } catch {
        if (typeof document !== "undefined" && document.visibilityState === "hidden") {
          return;
        }
        failCountRef.current += 1;
        if (!isOfflineRef.current && failCountRef.current >= FAILURE_THRESHOLD) {
          isOfflineRef.current = true;
          setIsOffline(true);
        }
      }
    };

    const timeout = setTimeout(() => {
      void checkHealth();
      interval = setInterval(() => {
        void checkHealth();
      }, 5000);
    }, 5000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        failCountRef.current = 0;
        void checkHealth();
      }
    };

    const handleOnline = () => {
      failCountRef.current = 0;
      void checkHealth();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);

    return () => {
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  if (!isOffline) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-slate-950/90 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="loader mb-6"></div>
      <h1 className="text-2xl font-bold tracking-tight text-white mb-2">
        {t("Verbindung verloren", "Connection lost")}
      </h1>
      <p className="text-sm text-slate-400 max-w-md text-center">
        {t(
          "Der Server (ONVIFscanner) wird gerade neu gestartet oder ist offline.",
          "The server (ONVIFscanner) is restarting or currently offline."
        )}{" "}
        <br />
        {t(
          "Bitte habe einen Moment Geduld, die Verbindung wird automatisch wiederhergestellt, sobald das System erreichbar ist.",
          "Please wait a moment, the connection will be restored automatically as soon as the system is reachable."
        )}
      </p>
      <style jsx>{`
        .loader {
          width: 48px;
          height: 48px;
          border: 5px solid #1e293b;
          border-bottom-color: #6366f1;
          border-radius: 50%;
          display: inline-block;
          box-sizing: border-box;
          animation: rotation 1s linear infinite;
        }
        @keyframes rotation {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
