"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  Radar,
  LayoutGrid,
  Radio,
  Film,
  HardDrive,
  Menu,
  X,
  ExternalLink,
  ChevronRight,
  Sparkles,
  RefreshCw,
} from "lucide-react";

type NavItem = {
  href: string;
  label: string;
  mobileLabel: string;
  description: string;
  icon: typeof Radar;
  color: string;
  activeBg: string;
  activeBorder: string;
  activeText: string;
  dotColor: string;
  matchExact?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  {
    href: "/",
    label: "Monitore",
    mobileLabel: "Monitore",
    description: "Live-Kameraansicht, Raster & Aufnahmesteuerung",
    icon: LayoutGrid,
    color: "text-emerald-400",
    activeBg: "bg-emerald-500/15",
    activeBorder: "border-emerald-500/40",
    activeText: "text-emerald-200",
    dotColor: "bg-emerald-500",
    matchExact: true,
  },
  {
    href: "/scanner",
    label: "Scanner",
    mobileLabel: "Scanner",
    description: "Netzwerk nach ONVIF & RTSP Kameras durchsuchen",
    icon: Radar,
    color: "text-indigo-400",
    activeBg: "bg-indigo-500/15",
    activeBorder: "border-indigo-500/40",
    activeText: "text-indigo-200",
    dotColor: "bg-indigo-500",
  },
  {
    href: "/wiedergabe",
    label: "Wiedergabe",
    mobileLabel: "Wiedergabe",
    description: "Video-Archiv durchsuchen, Player & Downloads",
    icon: Film,
    color: "text-amber-400",
    activeBg: "bg-amber-500/15",
    activeBorder: "border-amber-500/40",
    activeText: "text-amber-200",
    dotColor: "bg-amber-500",
  },
  {
    href: "/nvr/storage",
    label: "Speicher",
    mobileLabel: "Speicher",
    description: "Festplatten, NAS, Speicherziele & Quotas",
    icon: HardDrive,
    color: "text-cyan-400",
    activeBg: "bg-cyan-500/15",
    activeBorder: "border-cyan-500/40",
    activeText: "text-cyan-200",
    dotColor: "bg-cyan-500",
  },
];

interface NavigationProps {
  repoUrl?: string;
}

export function Navigation({
  repoUrl = "https://github.com/Schello805/onvifscanner",
}: NavigationProps) {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [recordingCount, setRecordingCount] = useState<number>(0);

  // Poll active recording count every 15s to keep navigation live
  useEffect(() => {
    let mounted = true;
    const checkRecordings = async () => {
      try {
        const res = await fetch("/api/nvr/cameras", { cache: "no-store" });
        const data = await res.json();
        if (mounted && data.cameras && Array.isArray(data.cameras)) {
          const count = data.cameras.filter((c: any) => c.recordEnabled).length;
          setRecordingCount(count);
        }
      } catch {}
    };

    void checkRecordings();
    const interval = setInterval(checkRecordings, 15000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  // Close mobile drawer on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  // Detect fullscreen mode to hide bottom bar
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  // Prevent background scrolling when mobile drawer is open
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileMenuOpen]);

  const isItemActive = (item: NavItem) => {
    if (item.matchExact) {
      return pathname === item.href;
    }
    if (item.href === "/") {
      return pathname === "/" || pathname.startsWith("/wall") || pathname.startsWith("/recordings") || pathname.startsWith("/aufnahmen");
    }
    return pathname.startsWith(item.href);
  };

  return (
    <>
      {/* ─── DESKTOP & MOBILE TOP HEADER ──────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-slate-800/80 bg-slate-950/85 backdrop-blur-xl shadow-lg shadow-black/20">
        <div className="mx-auto flex w-full max-w-none items-center justify-between gap-3 px-4 py-2.5 sm:w-[94%] sm:px-5 sm:py-3 lg:w-[90%]">
          {/* Brand Logo & Name */}
          <Link
            href="/"
            className="group flex min-w-0 items-center gap-2.5 transition-opacity hover:opacity-90 sm:gap-3"
            title="Zur Startseite / Monitore"
          >
            <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-xl border border-slate-700/60 bg-slate-900 shadow-md shadow-black/40 ring-1 ring-white/10 group-hover:border-indigo-500/50 transition-colors">
              <Image
                src="/logo.png"
                alt="ONVIFscanner"
                fill
                className="object-cover"
                sizes="36px"
                priority
              />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-bold tracking-tight text-white sm:text-base">
                  ONVIFscanner
                </span>
                <span className="hidden sm:inline-flex items-center rounded-full border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-medium text-indigo-300">
                  PRO
                </span>
              </div>
              <div className="hidden truncate text-xs text-slate-400 min-[430px]:block">
                Kamera-Manager & NVR
              </div>
            </div>
          </Link>

          {/* Desktop Navigation Links */}
          <nav className="hidden md:flex items-center gap-1 rounded-2xl border border-white/10 bg-white/[0.03] p-1 shadow-inner backdrop-blur-md">
            {NAV_ITEMS.map((item) => {
              const active = isItemActive(item);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`group relative flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-medium transition-all duration-200 ${
                    active
                      ? `${item.activeBg} ${item.activeText} border ${item.activeBorder} shadow-sm font-semibold`
                      : "text-slate-300 hover:bg-white/5 hover:text-white border border-transparent"
                  }`}
                >
                  <Icon
                    className={`h-4 w-4 transition-transform group-hover:scale-110 ${
                      active ? item.color : "text-slate-400 group-hover:text-slate-200"
                    }`}
                  />
                  <span>{item.label}</span>
                  {item.href === "/" && recordingCount > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/25 border border-rose-500/50 px-1.5 py-0.5 text-[10px] font-bold text-rose-300 shadow-sm animate-pulse">
                      <span className="h-1.5 w-1.5 rounded-full bg-rose-500"></span>
                      <span>{recordingCount} REC</span>
                    </span>
                  )}
                  {active && (
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${item.dotColor} animate-pulse`}
                    />
                  )}
                </Link>
              );
            })}
          </nav>

          {/* Header Right Actions */}
          <div className="flex items-center gap-2">
            {/* Desktop GitHub link */}
            <a
              className="hidden lg:inline-flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:border-slate-700 hover:bg-slate-800 hover:text-white"
              href={repoUrl}
              target="_blank"
              rel="noreferrer"
            >
              <span>GitHub</span>
              <ExternalLink className="h-3 w-3 opacity-60" />
            </a>

            {/* Mobile Menu Button */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen((open) => !open)}
              className="inline-flex md:hidden items-center justify-center rounded-xl border border-white/10 bg-white/5 p-2 text-slate-300 transition-colors hover:bg-white/10 hover:text-white active:scale-95"
              aria-label={mobileMenuOpen ? "Menü schließen" : "Menü öffnen"}
              aria-expanded={mobileMenuOpen}
            >
              {mobileMenuOpen ? (
                <X className="h-5 w-5" />
              ) : (
                <Menu className="h-5 w-5" />
              )}
            </button>
          </div>
        </div>

      </header>
        {/* ─── MOBILE SLIDE-DOWN DRAWER ────────────────────────────── */}
        {mobileMenuOpen && (
          <div className="md:hidden fixed inset-x-0 top-[57px] bottom-0 z-50 bg-slate-950/95 backdrop-blur-2xl flex flex-col justify-between border-t border-white/10 p-4 overflow-y-auto animate-in fade-in slide-in-from-top-3 duration-200">
            <div className="space-y-4">
              <div className="flex items-center justify-between px-2 pt-1">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Navigation
                </span>
                <span className="text-[11px] text-slate-400">
                  Alle Seiten & Module
                </span>
              </div>
              <div className="grid gap-2">
                {NAV_ITEMS.map((item) => {
                  const active = isItemActive(item);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileMenuOpen(false)}
                      className={`flex items-center justify-between gap-3 rounded-2xl border p-3.5 transition-all active:scale-[0.98] ${
                        active
                          ? `${item.activeBg} ${item.activeBorder} text-white shadow-lg`
                          : "border-white/5 bg-white/[0.02] text-slate-300 hover:border-white/10 hover:bg-white/5"
                      }`}
                    >
                      <div className="flex items-center gap-3.5 min-w-0">
                        <div
                          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${
                            active
                              ? `${item.activeBorder} ${item.activeBg}`
                              : "border-white/10 bg-white/5"
                          }`}
                        >
                          <Icon
                            className={`h-5 w-5 ${
                              active ? item.color : "text-slate-400"
                            }`}
                          />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm text-white">
                              {item.label}
                            </span>
                            {item.href === "/" && recordingCount > 0 && (
                              <span className="rounded-full bg-rose-500/25 border border-rose-500/50 px-2 py-0.5 text-[10px] font-bold text-rose-300 animate-pulse">
                                ● {recordingCount} REC aktiv
                              </span>
                            )}
                            {active && (
                              <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                                Aktiv
                              </span>
                            )}
                          </div>
                          <p className="truncate text-xs text-slate-400 mt-0.5">
                            {item.description}
                          </p>
                        </div>
                      </div>
                      <ChevronRight
                        className={`h-4 w-4 shrink-0 transition-transform ${
                          active ? item.color : "text-slate-600"
                        }`}
                      />
                    </Link>
                  );
                })}
              </div>
            </div>
            <div className="pt-6 pb-20 border-t border-white/10 space-y-3">
              <button
                type="button"
                onClick={() => {
                  if (typeof window !== "undefined") {
                    if ("caches" in window) {
                      caches.keys().then((keys) => {
                        keys.forEach((k) => caches.delete(k));
                      }).catch(() => {});
                    }
                    const url = new URL(window.location.href);
                    url.searchParams.set("_v", Date.now().toString());
                    window.location.replace(url.toString());
                  }
                }}
                className="w-full flex items-center justify-center gap-2 rounded-xl border border-indigo-500/30 bg-indigo-500/10 py-2.5 text-xs font-semibold text-indigo-300 hover:bg-indigo-500/20 hover:text-white transition-colors active:scale-98"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>App aktualisieren (Cache leeren)</span>
              </button>
              <a
                href={repoUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 py-2.5 text-xs font-medium text-slate-300 hover:bg-white/10 hover:text-white"
              >
                <span>GitHub Repository</span>
                <ExternalLink className="h-3.5 w-3.5 opacity-70" />
              </a>
              <p className="text-center text-[11px] text-slate-400">
                Tipp: Einmal nach unten ziehen (Pull-to-Refresh) aktualisiert die App ebenfalls.
              </p>
            </div>
          </div>
        )}


      {/* ─── MOBILE BOTTOM NAVIGATION BAR ─────────────────────────── */}
      {!isFullscreen && (
        <nav
          className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-slate-800/80 bg-slate-950/90 backdrop-blur-2xl px-2 pt-1.5 pb-[max(0.6rem,env(safe-area-inset-bottom,0px))] shadow-[0_-8px_30px_rgba(0,0,0,0.7)]"
          aria-label="Mobile Schnellnavigation"
        >
          <div className="grid grid-cols-4 gap-1">
            {NAV_ITEMS.map((item) => {
              const active = isItemActive(item);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`group relative flex flex-col items-center justify-center rounded-2xl py-1.5 px-1 transition-all duration-200 active:scale-95 touch-manipulation ${
                    active
                      ? `${item.activeBg} text-white shadow-sm`
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {/* Subtle active top glow pill */}
                  {active && (
                    <span
                      className={`absolute -top-1.5 h-1 w-6 rounded-full ${item.dotColor} shadow-[0_0_8px_rgba(255,255,255,0.4)]`}
                    />
                  )}

                  <div className="relative">
                    <Icon
                      className={`h-5 w-5 transition-transform duration-200 group-hover:scale-110 ${
                        active ? `${item.color} scale-105` : "text-slate-400"
                      }`}
                    />
                    {item.href === "/" && recordingCount > 0 && (
                      <span className="absolute -top-1 -right-1.5 flex h-2.5 w-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-80"></span>
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500 border border-slate-950"></span>
                      </span>
                    )}
                  </div>
                  <span
                    className={`mt-1 text-[10px] tracking-tight truncate max-w-full leading-none transition-colors ${
                      active ? "font-bold text-white" : "font-medium text-slate-400"
                    }`}
                  >
                    {item.mobileLabel}
                  </span>
                </Link>
              );
            })}
          </div>
        </nav>
      )}
    </>
  );
}
