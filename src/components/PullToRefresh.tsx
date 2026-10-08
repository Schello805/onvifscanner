"use client";

import { useEffect, useState } from "react";

export function PullToRefresh({ children }: { children: React.ReactNode }) {
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [startY, setStartY] = useState(0);
  const [isPulling, setIsPulling] = useState(false);

  useEffect(() => {
    // Nur auf Touch-Geräten aktivieren
    if (typeof window === "undefined" || !("ontouchstart" in window)) return;

    const handleTouchStart = (e: TouchEvent) => {
      // Nur wenn wir ganz oben sind
      if (window.scrollY <= 0) {
        setStartY(e.touches[0].clientY);
        setIsPulling(true);
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isPulling) return;
      
      const currentY = e.touches[0].clientY;
      const diff = currentY - startY;

      // Wenn der Nutzer nach unten zieht und ganz oben ist
      if (diff > 0 && window.scrollY <= 0) {
        // Standard-Scroll/Bounce auf iOS verhindern
        if (e.cancelable) e.preventDefault();
        
        // Widerstand simulieren (diff * 0.4) und max 120px
        setPullDistance(Math.min(diff * 0.4, 120));
      } else {
        setPullDistance(0);
      }
    };

    const handleTouchEnd = () => {
      if (!isPulling) return;
      setIsPulling(false);
      
      if (pullDistance > 60) {
        setIsRefreshing(true);
        // Seite neu laden (aktualisiert Bilder & Zustand)
        window.location.reload();
      } else {
        setPullDistance(0);
      }
    };

    document.addEventListener("touchstart", handleTouchStart, { passive: true });
    // non-passive ist wichtig, damit preventDefault() klappt
    document.addEventListener("touchmove", handleTouchMove, { passive: false });
    document.addEventListener("touchend", handleTouchEnd, { passive: true });

    return () => {
      document.removeEventListener("touchstart", handleTouchStart);
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("touchend", handleTouchEnd);
    };
  }, [isPulling, pullDistance, startY]);

  return (
    <div className="relative w-full">
      {/* Der Lade-Indikator, der von oben hereinrutscht */}
      <div 
        className="fixed top-0 left-0 right-0 z-[100] flex items-end justify-center overflow-hidden transition-all duration-200 ease-out pointer-events-none"
        style={{ 
          height: isRefreshing ? '80px' : `${pullDistance}px`,
          opacity: Math.min(pullDistance / 50, 1)
        }}
      >
        <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-slate-800 shadow-[0_0_20px_rgba(0,0,0,0.5)] border border-slate-700 text-white">
          {isRefreshing ? (
             <svg className="animate-spin h-5 w-5 text-indigo-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
          ) : (
            <svg className={`h-5 w-5 text-slate-300 transition-transform ${pullDistance > 60 ? 'rotate-180 text-indigo-400' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 14l-7 7m0 0l-7-7m7 7V3"></path></svg>
          )}
        </div>
      </div>
      
      {/* Der Inhalt der App, der nach unten weicht */}
      <div 
        className="w-full transition-transform duration-200 ease-out"
        style={{ transform: `translateY(${isRefreshing ? 80 : pullDistance}px)` }}
      >
        {children}
      </div>
    </div>
  );
}
