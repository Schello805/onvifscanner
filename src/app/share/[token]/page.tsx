import { getValidShareLink } from "@/lib/shareLinks";
import { Download, ShieldCheck, Clock, Video } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function SharedClipPage({
  params,
}: {
  params: { token: string };
}) {
  const link = await getValidShareLink(params.token);

  if (!link) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-slate-950 p-4 text-white">
        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900/90 p-6 text-center shadow-2xl backdrop-blur-md">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20 mb-4">
            <Clock className="h-7 w-7" />
          </div>
          <h1 className="text-xl font-bold text-white mb-2">Link abgelaufen</h1>
          <p className="text-sm text-slate-400">
            Dieser Video-Teilen-Link ist nicht mehr gültig oder wurde automatisch gelöscht.
          </p>
        </div>
      </main>
    );
  }

  const streamUrl = `/api/share/${link.token}`;
  const expiryDate = new Date(link.expiresAt).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-950 p-3 sm:p-6 text-white">
      <div className="w-full max-w-3xl overflow-hidden rounded-2xl border border-white/15 bg-slate-900/90 shadow-2xl backdrop-blur-xl">
        <header className="flex items-center justify-between border-b border-white/10 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/15 text-amber-400 border border-amber-500/30">
              <Video className="h-4 w-4" />
            </div>
            <div>
              <h1 className="text-sm sm:text-base font-bold text-white">{link.cameraName}</h1>
              <p className="text-[11px] text-slate-400">Freigegebene NVR-Aufnahme</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-slate-400 bg-white/5 border border-white/10 px-2.5 py-1 rounded-full">
            <Clock className="h-3.5 w-3.5 text-amber-400" />
            <span>Gültig bis {expiryDate}</span>
          </div>
        </header>

        <div className="relative aspect-video w-full bg-black">
          <video
            src={streamUrl}
            controls
            autoPlay
            playsInline
            className="h-full w-full object-contain"
          />
        </div>

        <footer className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-white/10 bg-slate-950/60 px-4 py-3 sm:px-6 text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            <span>Sicherer temporärer Freigabelink · ONVIFscanner</span>
          </div>
          <a
            href={streamUrl}
            download={`${link.cameraName}_aufnahme.mp4`}
            className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 py-1.5 text-xs font-semibold text-black hover:bg-amber-400 transition-colors"
          >
            <Download className="h-4 w-4" />
            <span>Video herunterladen</span>
          </a>
        </footer>
      </div>
    </main>
  );
}
