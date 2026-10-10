import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import pkg from "../../package.json";
import { VersionStatus } from "./VersionStatus";
import { SplashScreen } from "@/components/SplashScreen";
import { ConnectionWatcher } from "@/components/ConnectionWatcher";
import { PullToRefresh } from "@/components/PullToRefresh";
import { ToastProvider } from "@/components/ToastProvider";
import { Navigation } from "@/components/Navigation";

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
    <footer className="border-t border-slate-800/80 py-8 text-sm text-slate-300 pb-28 md:pb-10 bg-slate-950/40">
      <div className="mx-auto flex w-full max-w-none flex-col gap-4 px-4 sm:w-[94%] sm:flex-row sm:items-center sm:justify-between sm:px-5 lg:w-[90%]">
        <div className="flex flex-col gap-1">
          <div className="font-semibold text-slate-200 flex items-center gap-2">
            <span>ONVIFscanner</span>
            <VersionStatus currentVersion={pkg.version} />
          </div>
          <div className="text-xs text-slate-400">
            Local-first Scan von ONVIF & RTSP Kameras im LAN mit NVR-Aufzeichnung.
          </div>
        </div>
        <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
          <Link href="/" className="text-slate-400 hover:text-white transition-colors">
            Scanner
          </Link>
          <Link href="/monitore" className="text-slate-400 hover:text-white transition-colors">
            Monitore
          </Link>
          <Link href="/wiedergabe" className="text-slate-400 hover:text-white transition-colors">
            Wiedergabe
          </Link>
          <Link href="/nvr/storage" className="text-slate-400 hover:text-white transition-colors">
            Speicher
          </Link>
          <a
            className="text-slate-400 hover:text-white transition-colors"
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" data-theme="dracula">
      <body>
        <ToastProvider>
          <SplashScreen />
          <ConnectionWatcher />
          <PullToRefresh>
            <div className="min-h-screen flex flex-col">
              <Navigation repoUrl={repoUrl} />
              <main className="mx-auto flex-1 w-full max-w-none px-2 py-4 sm:w-[94%] sm:px-5 sm:py-6 lg:w-[90%] lg:py-8 pb-24 md:pb-8">
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
