"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

export function SplashScreen() {
  const [show, setShow] = useState(true);
  const [fade, setFade] = useState(false);

  useEffect(() => {
    // Die App ist client-seitig hydriert. 
    // Wir zeigen den Splash-Screen für 1.2 Sekunden und blenden ihn dann sanft aus.
    const timer1 = setTimeout(() => setFade(true), 1200);
    const timer2 = setTimeout(() => setShow(false), 1700);
    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
    };
  }, []);

  if (!show) return null;

  return (
    <div
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center bg-slate-950 transition-opacity duration-500 ${
        fade ? "opacity-0" : "opacity-100"
      }`}
    >
      <div className="relative mb-6 h-28 w-28 overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 shadow-2xl animate-pulse">
        <Image
          src="/logo.png"
          alt="ONVIFscanner"
          fill
          className="object-cover"
          sizes="112px"
          priority
        />
      </div>
      <h1 className="text-3xl font-bold tracking-tight text-white">
        ONVIF<span className="text-indigo-500">scanner</span>
      </h1>
      <p className="mt-3 text-sm text-slate-400">System wird geladen...</p>
      
      <div className="mt-10 flex items-center justify-center gap-2">
        <div className="h-2.5 w-2.5 animate-[bounce_1s_infinite_-0.3s] rounded-full bg-indigo-500"></div>
        <div className="h-2.5 w-2.5 animate-[bounce_1s_infinite_-0.15s] rounded-full bg-indigo-500"></div>
        <div className="h-2.5 w-2.5 animate-bounce rounded-full bg-indigo-500"></div>
      </div>
    </div>
  );
}
