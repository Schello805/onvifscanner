import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import "./globals.css";
import pkg from "../../package.json";
import { VersionStatus } from "./VersionStatus";
import { SplashScreen } from "@/components/SplashScreen";
import { ConnectionWatcher } from "@/components/ConnectionWatcher";
import { PullToRefresh } from "@/components/PullToRefresh";

export const metadata: Metadata = {
  title: "ONVIFscanner",
  description: "Lokaler ONVIF/RTSP Scanner für dein Netzwerk.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "Scanner",
    statusBarStyle: "black-translucent"
  },
};

const repoUrl =
  process.env.NEXT_PUBLIC_REPO_URL ?? "https://github.com/Schello805/onvifscanner";

function Footer() {
  return (
    <footer className="border-t border-slate-800/70 py-10 text-sm text-slate-300">
      <div className="mx-auto flex w-full max-w-none flex-col gap-3 px-4 sm:w-[94%] sm:flex-row sm:items-center sm:justify-between sm:px-5 lg:w-[90%]">
        <div className="flex flex-col gap-1">
          <div className="font-medium text-slate-200">
            ONVIFscanner <VersionStatus currentVersion={pkg.version} />
          </div>
          <div className="text-slate-400">
            Local-first Scan von ONVIF/RTSP im eigenen Heimnetz/LAN.
          </div>
        </div>
        <nav className="flex flex-wrap gap-x-4 gap-y-2">
          <a
            className="hover:text-white"
            href={repoUrl}
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
        </nav>
      </div>
    </footer>
  );
}

import { ToastProvider } from "@/components/ToastProvider";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" data-theme="dracula">
      <body>
        <ToastProvider>
          <SplashScreen />
          <ConnectionWatcher />
          <PullToRefresh>
            <div className="min-h-screen flex flex-col">
              <header className="border-b border-slate-800/70">
                <div className="mx-auto flex w-full max-w-none items-center justify-between gap-3 px-4 py-3 sm:w-[94%] sm:px-5 sm:py-4 lg:w-[90%]">
                  <Link href="/" className="flex min-w-0 items-center gap-2.5 sm:gap-3">
                    <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-lg border border-slate-800 bg-slate-950">
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
                      <div className="truncate text-sm font-semibold leading-tight sm:text-base">
                        ONVIFscanner
                      </div>
                      <div className="hidden truncate text-xs text-slate-400 min-[390px]:block">
                        WS-Discovery + optionaler IP/Port-Scan
                      </div>
                    </div>
                  </Link>
                  <nav className="relative z-20 flex shrink-0 items-center gap-1.5 sm:gap-2">
                    <Link className="touch-manipulation block cursor-pointer shrink-0 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm font-medium text-indigo-200 hover:bg-indigo-500/20 active:scale-95 transition-transform" href="/wall">
                      <span className="sm:hidden">Wall</span><span className="hidden sm:inline">Kamera-Wall</span>
                    </Link>
                    <Link className="touch-manipulation block cursor-pointer shrink-0 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm font-medium text-rose-200 hover:bg-rose-500/20 active:scale-95 transition-transform flex items-center gap-1.5" href="/recordings">
                      <span className="inline-block w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span>
                      <span>Aufnahmen</span>
                    </Link>
                    <Link className="touch-manipulation block cursor-pointer shrink-0 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm font-medium text-cyan-200 hover:bg-cyan-500/20 active:scale-95 transition-transform" href="/nvr/storage">
                      <span>Speicher</span>
                    </Link>
                    <a
                      className="hidden rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 lg:block"
                      href={repoUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Repo
                    </a>
                  </nav>
                </div>
              </header>
              <main className="mx-auto flex-1 w-full max-w-none px-2 py-5 sm:w-[94%] sm:px-5 sm:py-8 lg:w-[90%] lg:py-10">
                {children}
              </main>
              <Footer />
            </div>
          </PullToRefresh>
        </ToastProvider>
      </body>
    </html>
  );
}
