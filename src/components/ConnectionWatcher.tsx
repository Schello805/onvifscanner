"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

export function ConnectionWatcher() {
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    // Only start polling after initial load
    const timeout = setTimeout(() => {
      const interval = setInterval(async () => {
        try {
          const res = await fetch("/api/health", { 
            cache: "no-store",
            // Longer timeout to prevent false positives when network is busy
            signal: AbortSignal.timeout(10000) 
          });
          
          if (!res.ok) throw new Error("HTTP error");
          
          // If we were offline and now we are back online, reload the page to get fresh state
          if (isOffline) {
            window.location.reload();
          }
        } catch (error) {
          // Fetch failed (network error, connection refused, or timeout)
          if (!isOffline) {
            setIsOffline(true);
          }
        }
      }, 4000);

      return () => clearInterval(interval);
    }, 5000);

    return () => clearTimeout(timeout);
  }, [isOffline]);

  if (!isOffline) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-slate-950/90 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="loader mb-6"></div>
      <h1 className="text-2xl font-bold tracking-tight text-white mb-2">
        Verbindung verloren
      </h1>
      <p className="text-sm text-slate-400 max-w-md text-center">
        Der Server (ONVIFscanner) wird gerade neu gestartet oder ist offline. <br/>
        Bitte habe einen Moment Geduld, diese Seite lädt automatisch neu, sobald das System wieder erreichbar ist.
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
