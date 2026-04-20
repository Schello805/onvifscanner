import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import pkg from "../../package.json";

export const metadata: Metadata = {
  title: "ONVIFscanner",
  description: "Lokaler ONVIF/RTSP Scanner für dein Netzwerk."
};

const repoUrl = process.env.NEXT_PUBLIC_REPO_URL ?? "https://github.com/";

function Footer() {
  return (
    <footer className="border-t border-slate-800/70 py-10 text-sm text-slate-300">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <div className="font-medium text-slate-200">
            ONVIFscanner <span className="text-slate-400">v{pkg.version}</span>
          </div>
          <div className="text-slate-400">
            Local-first Scan von ONVIF/RTSP im autorisierten Netzwerk.
          </div>
        </div>
        <nav className="flex flex-wrap gap-x-4 gap-y-2">
          <Link className="hover:text-white" href="/impressum">
            Impressum
          </Link>
          <Link className="hover:text-white" href="/datenschutz">
            Datenschutz
          </Link>
          <Link className="hover:text-white" href="/cookies">
            Cookiehinweis
          </Link>
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>
        <div className="min-h-screen">
          <header className="border-b border-slate-800/70">
            <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="grid h-9 w-9 place-items-center rounded-lg bg-slate-800 text-white">
                  <span className="text-base font-semibold">O</span>
                </div>
                <div>
                  <div className="text-base font-semibold leading-tight">
                    ONVIFscanner
                  </div>
                  <div className="text-xs text-slate-400">
                    WS-Discovery + optionaler IP/Port-Scan
                  </div>
                </div>
              </div>
              <a
                className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
                href={repoUrl}
                target="_blank"
                rel="noreferrer"
              >
                Repo
              </a>
            </div>
          </header>
          <main className="mx-auto w-full max-w-5xl px-5 py-10">
            {children}
          </main>
          <Footer />
        </div>
      </body>
    </html>
  );
}
