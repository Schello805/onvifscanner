"use client";

import { useMemo, useRef, useState } from "react";
import type {
  ScanRequest,
  ScanResponse,
  ScanTargetPreset
} from "@/lib/types";

const defaultPorts = "80,443,554,8554,8000,8080,8899";
const THUMB_SUCCESS_MAX = 6;

function parsePorts(input: string): number[] {
  const ports = input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n) && n > 0 && n <= 65535);
  return Array.from(new Set(ports));
}

export default function HomePage() {
  const [preset, setPreset] = useState<ScanTargetPreset>("ws-discovery");
  const [cidr, setCidr] = useState("192.168.1.0/24");
  const [ports, setPorts] = useState(defaultPorts);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [copyWithCreds, setCopyWithCreds] = useState(true);
  const [includeThumbnails, setIncludeThumbnails] = useState(true);
  const [thumbnailsOnExpandOnly, setThumbnailsOnExpandOnly] = useState(true);
  const [verboseLog, setVerboseLog] = useState(true);
  const [deepProbe, setDeepProbe] = useState(false);
  const [timeoutMs, setTimeoutMs] = useState(1200);
  const [concurrency, setConcurrency] = useState(128);
  const [ack, setAck] = useState(true);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ScanResponse | null>(null);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [thumbnailLog, setThumbnailLog] = useState<Record<string, string>>({});
  const [thumbnailState, setThumbnailState] = useState<
    Record<string, "idle" | "loading" | "ok" | "fail">
  >({});
  const [thumbStoppedEarly, setThumbStoppedEarly] = useState(false);
  const [expandedIps, setExpandedIps] = useState<Record<string, boolean>>({});
  const runNonceRef = useRef(0);
  const activeRunNonceRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const latestResultsRef = useRef<Record<string, { ip: string; urls: string[] }>>({});
  const thumbQueueRef = useRef<string[]>([]);
  const thumbInFlightRef = useRef(0);
  const thumbSuccessRef = useRef(0);
  const thumbStopRef = useRef(false);
  const thumbPumpRef = useRef(false);
  const thumbRequestedRef = useRef<Set<string>>(new Set());
  const initialThumbIpsRef = useRef<Set<string>>(new Set());

  function InfoTip(props: { tip: string }) {
    return (
      <span className="tooltip tooltip-bottom" data-tip={props.tip}>
        <span
          className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full border border-white/20 bg-white/5 text-[10px] font-bold text-slate-300"
          aria-label="Info"
        >
          i
        </span>
      </span>
    );
  }

  function apiUrl(path: string): string {
    return new URL(path, window.location.origin).toString();
  }

  function getThumbUrlsForIp(ip: string): string[] {
    return latestResultsRef.current[ip]?.urls ?? [
      `http://${ip}/ISAPI/Streaming/channels/101/picture`,
      `http://${ip}/ISAPI/Streaming/channels/102/picture`
    ];
  }

  function indexResultsForThumbs(json: ScanResponse) {
    const map: Record<string, { ip: string; urls: string[] }> = {};
    for (const r of json.results) {
      const urls = Array.from(
        new Set(
          [
            ...(r.onvif?.snapshotUris?.map((u) => u.uri).filter(Boolean) ?? []),
            `http://${r.ip}/ISAPI/Streaming/channels/101/picture`,
            `http://${r.ip}/ISAPI/Streaming/channels/102/picture`
          ].filter(Boolean)
        )
      ).slice(0, 4);
      map[r.ip] = { ip: r.ip, urls };
    }
    latestResultsRef.current = map;
  }

  async function fetchThumbnail(ip: string): Promise<void> {
    if (thumbStopRef.current) return;
    if (thumbnailState[ip] === "loading" || thumbnailState[ip] === "ok") return;

    const urls = getThumbUrlsForIp(ip).slice(0, 4);
    if (!urls.length) return;

    setThumbnailState((prev) => ({ ...prev, [ip]: "loading" }));
    try {
      const ac = new AbortController();
      const t = window.setTimeout(() => ac.abort(), 3500);
      const thumbRes = await fetch(apiUrl("/api/thumbnail"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          urls,
          size: 200,
          timeoutMs: 1500,
          fastAuth: true,
          credentials:
            username.trim() && password
              ? { username: username.trim(), password }
              : undefined
        }),
        signal: ac.signal
      }).finally(() => window.clearTimeout(t));

      // Ignore outdated scan runs.
      if (activeRunNonceRef.current !== runNonceRef.current) return;

      if (!thumbRes.ok) {
        try {
          const ct = (thumbRes.headers.get("content-type") ?? "").toLowerCase();
          if (ct.includes("application/json")) {
            const j = (await thumbRes.json().catch(() => null)) as any;
            if (j?.error) {
              const lines = [String(j.error), ...(Array.isArray(j.log) ? j.log : [])];
              setThumbnailLog((prev) => ({
                ...prev,
                [ip]: lines.slice(0, verboseLog ? 60 : 12).join("\n")
              }));
            } else {
              const txt = JSON.stringify(j).slice(0, 1200);
              setThumbnailLog((prev) => ({ ...prev, [ip]: txt }));
            }
          } else {
            const txt = await thumbRes.text();
            setThumbnailLog((prev) => ({ ...prev, [ip]: txt.slice(0, 1200) }));
          }
        } catch {
          // ignore
        }
        setThumbnailState((prev) => ({ ...prev, [ip]: "fail" }));

        for (const candidate of urls) {
          if (runNonceRef.current !== activeRunNonceRef.current) return;
          if (!candidate.includes("/ISAPI/")) continue;
          const ok = await tryLoadImageDirect(candidate, 2500);
          if (!ok) continue;
          setThumbnails((prev) => ({ ...prev, [ip]: candidate }));
          setThumbnailLog((prev) => ({ ...prev, [ip]: `OK (direct): ${candidate}` }));
          setThumbnailState((prev) => ({ ...prev, [ip]: "ok" }));
          thumbSuccessRef.current += 1;
          if (thumbSuccessRef.current >= THUMB_SUCCESS_MAX) {
            thumbStopRef.current = true;
            setThumbStoppedEarly(true);
            thumbQueueRef.current = [];
          }
          return;
        }
        return;
      }

      const blob = await thumbRes.blob();
      if (!blob.size) return;
      const objectUrl = URL.createObjectURL(blob);
      if (runNonceRef.current !== activeRunNonceRef.current) {
        try {
          URL.revokeObjectURL(objectUrl);
        } catch {
          // ignore
        }
        return;
      }
      setThumbnails((prev) => {
        const existing = prev[ip];
        if (existing) {
          try {
            if (existing.startsWith("blob:")) URL.revokeObjectURL(existing);
          } catch {
            // ignore
          }
        }
        return { ...prev, [ip]: objectUrl };
      });
      const src = thumbRes.headers.get("x-thumbnail-source");
      if (src) setThumbnailLog((prev) => ({ ...prev, [ip]: `OK: ${src}` }));
      setThumbnailState((prev) => ({ ...prev, [ip]: "ok" }));
      thumbSuccessRef.current += 1;
      if (thumbSuccessRef.current >= THUMB_SUCCESS_MAX) {
        thumbStopRef.current = true;
        setThumbStoppedEarly(true);
        thumbQueueRef.current = [];
      }
    } catch {
      setThumbnailState((prev) => ({ ...prev, [ip]: "fail" }));
    }
  }

  function pumpThumbQueue() {
    if (thumbPumpRef.current) return;
    thumbPumpRef.current = true;

    const tick = () => {
      const maxConcurrency = 2;
      while (
        !thumbStopRef.current &&
        thumbInFlightRef.current < maxConcurrency &&
        thumbQueueRef.current.length > 0
      ) {
        const ip = thumbQueueRef.current.shift()!;
        thumbInFlightRef.current += 1;
        void fetchThumbnail(ip).finally(() => {
          thumbInFlightRef.current = Math.max(0, thumbInFlightRef.current - 1);
          tick();
        });
      }

      if (
        thumbStopRef.current ||
        (thumbInFlightRef.current === 0 && thumbQueueRef.current.length === 0)
      ) {
        thumbPumpRef.current = false;
      }
    };

    tick();
  }

  function enqueueThumb(ip: string) {
    if (!includeThumbnails) return;
    if (thumbStopRef.current) return;
    if (thumbnailState[ip] === "ok" || thumbnailState[ip] === "loading") return;
    if (thumbRequestedRef.current.has(ip)) return;
    thumbRequestedRef.current.add(ip);
    if (!thumbQueueRef.current.includes(ip)) thumbQueueRef.current.push(ip);
    pumpThumbQueue();
  }

  async function tryLoadImageDirect(url: string, timeoutMs: number): Promise<boolean> {
    return await new Promise<boolean>((resolve) => {
      const img = new Image();
      let done = false;
      const t = window.setTimeout(() => {
        if (done) return;
        done = true;
        try {
          img.src = "";
        } catch {
          // ignore
        }
        resolve(false);
      }, timeoutMs);

      img.onload = () => {
        if (done) return;
        done = true;
        window.clearTimeout(t);
        resolve(true);
      };
      img.onerror = () => {
        if (done) return;
        done = true;
        window.clearTimeout(t);
        resolve(false);
      };

      // Avoid leaking referrer into camera logs.
      img.referrerPolicy = "no-referrer";
      img.src = url;
    });
  }

  const request: ScanRequest = useMemo(
    () => ({
      preset,
      cidr: preset === "cidr" ? cidr : undefined,
      ports: preset === "cidr" ? parsePorts(ports) : undefined,
      credentials:
        username.trim() || password.trim()
          ? { username: username.trim(), password }
          : undefined,
      timeoutMs,
      concurrency,
      deepProbe,
      includeThumbnails,
      acknowledgeAuthorizedNetwork: ack
    }),
    [
      ack,
      cidr,
      concurrency,
      deepProbe,
      includeThumbnails,
      password,
      ports,
      preset,
      timeoutMs,
      username
    ]
  );

  async function runScan() {
    runNonceRef.current += 1;
    const runNonce = runNonceRef.current;
    activeRunNonceRef.current = runNonce;
    abortRef.current?.abort();
    const abortController = new AbortController();
    abortRef.current = abortController;
    setError(null);
    setLoading(true);
    setData(null);
    setExpandedIps({});
    setThumbStoppedEarly(false);

    const resetThumbs = () => {
      setThumbnails((prev) => {
        for (const v of Object.values(prev)) {
          try {
            if (v.startsWith("blob:")) URL.revokeObjectURL(v);
          } catch {
            // ignore
          }
        }
        return {};
      });
      setThumbnailLog({});
      setThumbnailState({});
      thumbQueueRef.current = [];
      thumbInFlightRef.current = 0;
      thumbSuccessRef.current = 0;
      thumbStopRef.current = false;
      thumbRequestedRef.current = new Set();
      initialThumbIpsRef.current = new Set();
      setThumbStoppedEarly(false);
    };

    function enqueueInitialThumbs(json: ScanResponse) {
      if (!includeThumbnails) return;
      const count = thumbnailsOnExpandOnly ? 4 : 12;
      const ips = json.results.map((r) => r.ip).slice(0, count);
      for (const ip of ips) {
        initialThumbIpsRef.current.add(ip);
        enqueueThumb(ip);
      }
    }

    try {
      resetThumbs();
      const res = await fetch(apiUrl("/api/scan"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
        signal: abortController.signal
      });
      const json = (await res.json().catch(() => ({}))) as ScanResponse;
      if (!res.ok) throw new Error(json.error ?? "Scan fehlgeschlagen.");
      setData(json);
      indexResultsForThumbs(json);
      enqueueInitialThumbs(json);
    } catch (e) {
      if (abortController.signal.aborted) {
        setError("Scan abgebrochen.");
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setLoading(false);
    }
  }

  function stopScan() {
    abortRef.current?.abort();
  }

  function handleDetailsToggle(ip: string, open: boolean) {
    setExpandedIps((prev) => ({ ...prev, [ip]: open }));
    if (!includeThumbnails) return;
    if (!thumbnailsOnExpandOnly) return;
    if (!open) return;
    // Enqueue thumbnail when a row is expanded.
    enqueueThumb(ip);
  }

  function addCredsIfWanted(url: string): string {
    if (!copyWithCreds) return url;
    if (!username.trim()) return url;
    if (!password) return url;
    try {
      const u = new URL(url);
      if (u.username || u.password) return url;
      u.username = username.trim();
      u.password = password;
      return u.toString();
    } catch {
      // non-standard URLs (some RTSP variants) are left untouched
      return url;
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const el = document.createElement("textarea");
      el.value = text;
      el.style.position = "fixed";
      el.style.left = "-9999px";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
  }

  function UrlRow(props: { label: string; url: string; isApi?: boolean }) {
    const effective = addCredsIfWanted(props.url);
    return (
      <div className="flex items-center gap-2">
        <div className="w-28 shrink-0 text-xs text-slate-400">{props.label}</div>
        {props.isApi ? (
          <span
            className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-500"
            title={props.url}
          >
            {props.url}
          </span>
        ) : (
          <a
            className="min-w-0 flex-1 truncate font-mono text-[11px] text-indigo-300 hover:text-indigo-200"
            href={props.url}
            target="_blank"
            rel="noreferrer"
            title={props.url}
          >
            {props.url}
          </a>
        )}
        <button
          className="rounded-md border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-slate-200 hover:bg-slate-900"
          onClick={() => copy(effective)}
          type="button"
        >
          Kopieren
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="glass-panel overflow-hidden relative rounded-2xl p-5 md:p-6">
        {/* Decorative background glow */}
        <div className="absolute top-0 right-0 -mr-20 -mt-20 w-48 h-48 rounded-full bg-indigo-500/10 blur-[60px] pointer-events-none" />
        
	        <div className="relative z-10 flex flex-col border-b border-white/5 pb-4 mb-4 gap-4">
	          <div>
	            <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-white/70 tracking-tight">Kameras im Netzwerk finden</h1>
	            <p className="mt-1 text-xs text-slate-400 font-medium max-w-xl leading-relaxed">
	              WS-Discovery ist am zuverlässigsten für ONVIF. Falls du RTSP/HTTP außerhalb des eigenen Subnetzes testen willst, wechsle auf den CIDR-Scan.
	            </p>
	          </div>
	        </div>

        <div className="relative z-10 grid gap-6 md:grid-cols-12">
          
          <div className="md:col-span-5 flex flex-col gap-3">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-indigo-400">Scan-Einstellungen</h3>
            <div className="grid gap-3 grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400 ml-1">Modus</span>
                <select
                  className="glass-input rounded-lg px-3 py-1.5 text-sm select-none"
                  value={preset}
                  onChange={(e) => {
                    const next = e.target.value as ScanTargetPreset;
                    setPreset(next);
                    setDeepProbe(next === "cidr");
                  }}
                >
                  <option value="ws-discovery" className="bg-slate-900 text-white">WS-Discovery</option>
                  <option value="cidr" className="bg-slate-900 text-white">CIDR Scan</option>
                </select>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400 ml-1">Timeout (ms)</span>
                <input
                  className="glass-input rounded-lg px-3 py-1.5 text-sm outline-none"
                  type="number"
                  min={200}
                  max={10000}
                  step={100}
                  value={timeoutMs}
                  onChange={(e) => setTimeoutMs(Number(e.target.value))}
                />
              </label>
            </div>

            {preset === "cidr" && (
              <div className="grid gap-3 grid-cols-2 md:grid-cols-3 mt-1">
                <label className="flex flex-col gap-1.5 md:col-span-1">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400 ml-1">CIDR</span>
                  <input
                    className="glass-input rounded-lg px-3 py-1.5 text-sm outline-none"
                    value={cidr}
                    onChange={(e) => setCidr(e.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1.5 md:col-span-1">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400 ml-1">Ports</span>
                  <input
                    className="glass-input rounded-lg px-3 py-1.5 text-sm outline-none"
                    value={ports}
                    onChange={(e) => setPorts(e.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1.5 md:col-span-1">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400 ml-1">Concurrency</span>
                  <input
                    className="glass-input rounded-lg px-3 py-1.5 text-sm outline-none"
                    type="number"
                    min={1}
                    value={concurrency}
                    onChange={(e) => setConcurrency(Number(e.target.value))}
                  />
                </label>
              </div>
            )}
          </div>

          <div className="md:col-span-7 flex flex-col gap-3">
             <h3 className="text-[10px] font-bold uppercase tracking-widest text-indigo-400">Authentifizierung</h3>
             <div className="grid gap-3 grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400 ml-1">Benutzername</span>
                  <input
                    className="glass-input rounded-lg px-3 py-1.5 text-sm outline-none"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="admin"
                    autoComplete="username"
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400 ml-1">Passwort</span>
                  <input
                    className="glass-input rounded-lg px-3 py-1.5 text-sm outline-none"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                  />
                </label>
             </div>
             
	             <div className="flex flex-col sm:flex-row gap-3 sm:items-center mt-2">
	                <label className="flex items-center gap-2.5 cursor-pointer group hover:opacity-80 transition-opacity">
                  <div className="w-4 h-4 shrink-0 rounded bg-white/5 border border-white/20 flex items-center justify-center relative overflow-hidden group-hover:border-indigo-500/50 transition-colors">
                    {copyWithCreds && <svg className="w-3 h-3 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                    <input type="checkbox" className="absolute inset-0 opacity-0 cursor-pointer" checked={copyWithCreds} onChange={(e) => setCopyWithCreds(e.target.checked)} />
                  </div>
                  <span className="text-[11px] text-slate-300">
                    Credentials beim Kopieren anhängen
                    <InfoTip tip='Wenn aktiv, werden beim Kopieren Benutzername+Passwort in die URL eingebettet (z. B. "http://user:pass@ip/..."). Vorsicht: sensibel.' />
                  </span>
                </label>

                <label className="flex items-center gap-2.5 cursor-pointer group hover:opacity-80 transition-opacity">
                  <div className="w-4 h-4 shrink-0 rounded bg-white/5 border border-white/20 flex items-center justify-center relative overflow-hidden group-hover:border-indigo-500/50 transition-colors">
                    {includeThumbnails && <svg className="w-3 h-3 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                    <input type="checkbox" className="absolute inset-0 opacity-0 cursor-pointer" checked={includeThumbnails} onChange={(e) => setIncludeThumbnails(e.target.checked)} />
                  </div>
                  <span className="text-[11px] text-slate-300">
                    Vorschau-Bilder laden (langsamer)
                    <InfoTip tip="Lädt Snapshot/ISAPI-Bilder als 200×200 Vorschau. Manche Kameras benötigen Digest/Basic Auth. Das kann dauern." />
                  </span>
                </label>

                <label className="flex items-center gap-2.5 cursor-pointer group hover:opacity-80 transition-opacity">
                  <div className="w-4 h-4 shrink-0 rounded bg-white/5 border border-white/20 flex items-center justify-center relative overflow-hidden group-hover:border-indigo-500/50 transition-colors">
                    {thumbnailsOnExpandOnly && <svg className="w-3 h-3 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                    <input
                      type="checkbox"
                      className="absolute inset-0 opacity-0 cursor-pointer"
                      checked={thumbnailsOnExpandOnly}
                      onChange={(e) => setThumbnailsOnExpandOnly(e.target.checked)}
                      disabled={!includeThumbnails}
                    />
                  </div>
                  <span className={`text-[11px] ${includeThumbnails ? "text-slate-300" : "text-slate-500"}`}>
                    Previews nur bei geöffneten Details
                    <InfoTip tip="Wenn aktiv, werden Vorschauen erst geladen, wenn du eine Kamera-Zeile aufklappst. Das ist viel schneller und schont die Kameras." />
                  </span>
                </label>

                <label className="flex items-center gap-2.5 cursor-pointer group hover:opacity-80 transition-opacity">
                  <div className="w-4 h-4 shrink-0 rounded bg-white/5 border border-white/20 flex items-center justify-center relative overflow-hidden group-hover:border-indigo-500/50 transition-colors">
                    {verboseLog && <svg className="w-3 h-3 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                    <input type="checkbox" className="absolute inset-0 opacity-0 cursor-pointer" checked={verboseLog} onChange={(e) => setVerboseLog(e.target.checked)} />
                  </div>
                  <span className="text-[11px] text-slate-300">
                    Verbose Log
                    <InfoTip tip="Zeigt im Log mehr Details (z. B. Digest/401, Timeout, genutzte Snapshot-URL). Hilft beim Debuggen, kann aber mehr Text erzeugen." />
                  </span>
                </label>

                <label className="flex items-center gap-2.5 cursor-pointer group hover:opacity-80 transition-opacity">
                  <div className="w-4 h-4 shrink-0 rounded bg-white/5 border border-white/20 flex items-center justify-center relative overflow-hidden group-hover:border-indigo-500/50 transition-colors">
                    {deepProbe && <svg className="w-3 h-3 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                    <input type="checkbox" className="absolute inset-0 opacity-0 cursor-pointer" checked={deepProbe} onChange={(e) => setDeepProbe(e.target.checked)} />
                  </div>
                  <span className="text-[11px] text-slate-300">
                    Erweiterte Analyse (ONVIF/RTSP prüfen)
                    <InfoTip tip="Führt zusätzliche ONVIF-SOAP-Abfragen und RTSP-Tests aus, um echte Stream/Snapshot-URLs zu finden. Kann deutlich länger dauern." />
                  </span>
                </label>
                
                <label className="flex items-center gap-2.5 cursor-pointer group hover:opacity-80 transition-opacity">
                  <div className="w-4 h-4 shrink-0 rounded bg-white/5 border border-white/20 flex items-center justify-center relative overflow-hidden group-hover:border-indigo-500/50 transition-colors">
                    {ack && <svg className="w-3 h-3 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                    <input type="checkbox" className="absolute inset-0 opacity-0 cursor-pointer" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                  </div>
	                  <span className="text-[11px] text-slate-300">
                      Netzwerk-Berechtigung bestätigt
                      <InfoTip tip="Nur im eigenen/autorisierten Netzwerk scannen. Bitte nicht in fremden Netzen verwenden." />
                    </span>
	                </label>
	             </div>

               <div className="mt-5 flex items-center gap-3">
                 <button
                   className="w-full group relative inline-flex h-10 items-center justify-center overflow-hidden rounded-lg bg-indigo-600 px-6 font-medium text-white shadow-lg transition-all duration-300 disabled:pointer-events-none disabled:opacity-50 hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2 focus:ring-offset-slate-900"
                   onClick={runScan}
                   disabled={loading || !ack}
                   title={!ack ? "Bitte zuerst die Netzwerk-Berechtigung bestätigen." : undefined}
                 >
                   <div className="absolute inset-0 flex h-full w-full justify-center [transform:skew(-12deg)_translateX(-100%)] group-hover:duration-1000 group-hover:[transform:skew(-12deg)_translateX(100%)]">
                     <div className="relative h-full w-8 bg-white/20" />
                   </div>
                   <span className="relative flex items-center gap-2 text-sm">
                     {loading ? (
                       <svg
                         className="animate-spin -ml-1 mr-2 h-3.5 w-3.5 text-white"
                         xmlns="http://www.w3.org/2000/svg"
                         fill="none"
                         viewBox="0 0 24 24"
                       >
                         <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                         <path
                           className="opacity-75"
                           fill="currentColor"
                           d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                         ></path>
                       </svg>
                     ) : (
                       <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                         <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                       </svg>
                     )}
                     {loading ? "Sucht…" : "Scan Starten"}
                   </span>
                 </button>
                 {loading ? (
                   <button
                     className="inline-flex h-10 shrink-0 items-center justify-center rounded-lg border border-red-500/40 bg-red-950/30 px-4 text-sm font-medium text-red-200 hover:bg-red-950/50"
                     onClick={stopScan}
                     type="button"
                   >
                     Stop
                   </button>
                 ) : null}
               </div>

               {loading ? (
                 <div className="mt-3 rounded-lg border border-white/10 bg-black/20 p-3 text-xs text-slate-300">
                   Scan läuft… (Safari-kompatibler Modus ohne Live-Streaming)
                 </div>
               ) : null}
	          </div>
	          
	        </div>

        {error ? (
          <div className="mt-5 rounded-lg border border-red-900/50 bg-red-950/40 p-4 text-sm text-red-200">
            {error}
          </div>
        ) : null}
      </section>

      <section className="glass-panel overflow-hidden relative rounded-3xl p-8 mt-4">
        <div className="relative z-10">
          <div className="flex items-end justify-between border-b border-white/10 pb-4">
            <h2 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 to-cyan-400 tracking-tight">Ergebnisse</h2>
            {data?.meta ? (
              <div className="px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs font-semibold flex items-center gap-2 shadow-[0_0_15px_rgba(16,185,129,0.1)]">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                {data.results.length} Gerät(e) • {data.meta.durationMs}ms
                {includeThumbnails ? (
                  <span className="text-slate-300/80">
                    • Preview{" "}
                    {Object.values(thumbnailState).filter((s) => s === "ok").length}/
                    {Math.min(12, data.results.length)}
                  </span>
                ) : null}
                {thumbStoppedEarly ? (
                  <span className="text-slate-400/90">
                    • Stop nach {THUMB_SUCCESS_MAX} OK
                  </span>
                ) : null}
              </div>
            ) : (
              <div className="text-xs text-slate-500 font-medium uppercase tracking-wider">Warte auf Eingabe</div>
            )}
          </div>

          {!data ? (
            <div className="mt-12 mb-8 flex flex-col items-center justify-center text-center opacity-60">
              <div className="w-20 h-20 mb-4 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-3xl shadow-xl">
                🔎
              </div>
              <div className="text-slate-300 font-medium">Noch kein Scan ausgeführt</div>
              <div className="text-sm text-slate-500 mt-1">Starte oben den Suchlauf, um Geräte zu finden.</div>
            </div>
          ) : (
            <div className="mt-6 overflow-hidden rounded-2xl border border-white/10 bg-black/20 backdrop-blur-md shadow-2xl">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="bg-white/5 border-b border-white/10 text-xs font-bold uppercase tracking-widest text-slate-400">
                    <th className="py-3 pr-4 pl-4">Preview</th>
                  <th className="py-3 pr-4">Gerät (IP & Ports)</th>
                  <th className="py-3 pr-4">Hersteller & Modell</th>
                  <th className="py-3 pr-4 w-1/2">URLs & Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                  {data.results.map((r, i) => (
                    <tr key={r.ip} className={`align-top transition-colors hover:bg-white/[0.03] ${i % 2 === 0 ? 'bg-white/[0.01]' : 'bg-transparent'}`}>
                      <td className="p-4 align-middle">
                        {thumbnails[r.ip] ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={thumbnails[r.ip]}
                            alt={`Preview ${r.ip}`}
                            className="h-14 w-24 rounded-lg border border-white/10 object-cover shadow-lg"
                          />
                        ) : (
                          <div className="flex h-14 w-24 items-center justify-center rounded-lg border border-white/5 bg-white/5 text-[10px] font-medium uppercase tracking-wider text-slate-600">
                            {(() => {
                              const log = thumbnailLog[r.ip] ?? "";
                              const lower = log.toLowerCase();
                              if (thumbnailState[r.ip] === "loading") return "Lädt…";
                              if (lower.includes("digest") && lower.includes("401")) return "Digest nötig";
                              if (lower.includes("401")) return "Auth nötig";
                              if (
                                includeThumbnails &&
                                thumbnailsOnExpandOnly &&
                                !expandedIps[r.ip] &&
                                !initialThumbIpsRef.current.has(r.ip)
                              ) {
                                return "Aufklappen";
                              }
                              return "Kein Bild";
                            })()}
                          </div>
                        )}
                      </td>
                      
                      <td className="p-4 align-middle">
                        <div className="font-mono text-sm text-slate-200">{r.ip}</div>
                        <div className="mt-1 text-xs text-slate-500 font-medium">
                          {r.openTcpPorts?.length ? `Ports: ${r.openTcpPorts.join(", ")}` : "—"}
                        </div>
                      </td>

                      <td className="p-4 align-middle">
                        <div className="flex flex-col gap-1.5">
                          {r.onvif?.ok && (r.onvif.deviceInformation?.manufacturer || r.onvif.deviceInformation?.model) ? (
                            <span className="text-sm font-bold text-white tracking-wide">
                              {[r.onvif.deviceInformation.manufacturer, r.onvif.deviceInformation.model]
                                .filter(Boolean)
                                .join(" ")}
                            </span>
                          ) : (
                            <span className="text-sm font-medium text-slate-500">Unbekannt</span>
                          )}
                          <div className="flex items-center gap-2">
                            {r.onvif?.ok ? (
                              <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-400 border border-emerald-500/30">ONVIF</span>
                            ) : r.onvif?.discoveryOnly ? (
                              <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-300 border border-white/10">ONVIF?</span>
                            ) : r.onvif ? (
                              <span title={r.onvif.error} className="rounded bg-red-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-red-400 border border-red-500/30">Kein ONVIF</span>
                            ) : null}
                            
                            {r.rtsp?.ok ? (
                              <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-400 border border-emerald-500/30">RTSP</span>
                            ) : r.rtsp?.discoveryOnly ? (
                              <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-300 border border-white/10">RTSP?</span>
                            ) : r.rtsp ? (
                              <span title={r.rtsp.error} className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 border border-white/10">RTSP Fehler</span>
                            ) : null}
                          </div>
                        </div>
                      </td>

                      <td className="p-4">
                        <details
                          className="group rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm shadow-xl transition-all open:bg-black/40"
                          onToggle={(e) =>
                            handleDetailsToggle(
                              r.ip,
                              (e.currentTarget as HTMLDetailsElement).open
                            )
                          }
                        >
                          <summary className="cursor-pointer select-none text-sm font-semibold text-slate-300 hover:text-white transition flex items-center justify-between">
                            URLs & Log einblenden
                            <span className="text-indigo-400 transition-transform group-open:rotate-180">▼</span>
                          </summary>

                          <div className="mt-5 flex flex-col gap-5 border-t border-white/5 pt-4">
                            {/* Status */}
                            <div className="flex flex-col gap-2.5">
                              <div className="text-[11px] font-bold uppercase tracking-widest text-slate-300 pb-1">Status</div>
                              <div className="text-xs text-slate-400">
                                {r.onvif
                                  ? r.onvif.ok
                                    ? "ONVIF: OK"
                                    : r.onvif.discoveryOnly
                                      ? "ONVIF: gefunden (ungetestet)"
                                    : `ONVIF: Fehler${r.onvif.error ? ` (${r.onvif.error})` : ""}`
                                  : "ONVIF: —"}
                                {" • "}
                                {r.rtsp
                                  ? r.rtsp.ok
                                    ? "RTSP: OK"
                                    : r.rtsp.discoveryOnly
                                      ? "RTSP: Kandidaten (ungetestet)"
                                    : `RTSP: Fehler${r.rtsp.error ? ` (${r.rtsp.error})` : ""}`
                                  : "RTSP: —"}
                              </div>
                            </div>

                            {/* Media / Streams */}
                            <div className="flex flex-col gap-2.5">
                              <div className="text-[11px] font-bold uppercase tracking-widest text-cyan-400 pb-1">Media & Streams</div>
                              {r.onvif?.rtspUris?.length ? (
                                r.onvif.rtspUris.map((u, idx) => (
                                  <UrlRow
                                    key={`${u.uri}-onvif-${idx}`}
                                    label={u.profileName ? `RTSP (${u.profileName})` : `RTSP ${idx + 1}`}
                                    url={u.uri}
                                  />
                                ))
                              ) : (
                                <div className="text-xs text-slate-500">
                                  Keine RTSP-URLs via ONVIF erkannt.
                                </div>
                              )}

                              {r.onvif?.snapshotUris?.length ? (
                                r.onvif.snapshotUris.map((u, idx) => (
                                  <UrlRow
                                    key={`${u.uri}-snap-${idx}`}
                                    label={u.profileName ? `Snapshot (${u.profileName})` : `Snapshot ${idx + 1}`}
                                    url={u.uri}
                                  />
                                ))
                              ) : (
                                <div className="text-xs text-slate-500">
                                  Keine Snapshot-URLs via ONVIF erkannt.
                                </div>
                              )}

                              <div className="mt-2 text-[11px] text-slate-400">
                                Vendor-Kandidaten (z. B. Hikvision ISAPI):
                              </div>
                              <UrlRow
                                label="ISAPI Bild (Main)"
                                url={`http://${r.ip}/ISAPI/Streaming/channels/101/picture`}
                              />
                              <UrlRow
                                label="ISAPI Bild (Sub)"
                                url={`http://${r.ip}/ISAPI/Streaming/channels/102/picture`}
                              />

                              {r.rtsp?.uriTried ? (
                                <UrlRow label="RTSP getestet" url={r.rtsp.uriTried} />
                              ) : null}
                              {r.rtsp?.uris?.length
                                ? r.rtsp.uris.map((u, idx) => (
                                    <UrlRow
                                      key={`rtsp-ok-${idx}`}
                                      label={idx === 0 ? "RTSP (ONVIF)" : `RTSP (ONVIF) ${idx + 1}`}
                                      url={u}
                                    />
                                  ))
                                : null}
                              {r.rtsp?.candidates?.length ? (
                                <>
                                  <div className="mt-1 text-[11px] text-slate-400">
                                    Vermutete RTSP-Pfade (nicht garantiert):
                                  </div>
                                  {r.rtsp.candidates.map((u, idx) => (
                                    <UrlRow
                                      key={`rtsp-cand-${idx}`}
                                      label={idx === 0 ? "Kandidat" : `Kandidat ${idx + 1}`}
                                      url={u}
                                    />
                                  ))}
                                </>
                              ) : null}
                            </div>

                            {/* ONVIF API */}
                            <div className="flex flex-col gap-2.5">
                              <div className="text-[11px] font-bold uppercase tracking-widest text-indigo-400 pb-1">ONVIF API Endpoints</div>
                              {r.onvif?.deviceServiceUrl ? (
                                <UrlRow label="Device Service" url={r.onvif.deviceServiceUrl} isApi />
                              ) : (
                                <div className="text-xs text-slate-500">Kein Device Service erkannt.</div>
                              )}
                              {r.onvif?.mediaServiceUrl && <UrlRow label="Media Service" url={r.onvif.mediaServiceUrl} isApi />}
                              {r.onvif?.mediaServiceUrl2 && <UrlRow label="Media2 Service" url={r.onvif.mediaServiceUrl2} isApi />}
                              {r.onvif?.xaddrs?.length
                                ? r.onvif.xaddrs.map((u, idx) => (
                                    <UrlRow key={`xaddr-${idx}`} label={`XAddr ${idx + 1}`} url={u} isApi />
                                  ))
                                : null}
                            </div>

                            {/* Web */}
                            <div className="flex flex-col gap-2.5">
                              <div className="text-[11px] font-bold uppercase tracking-widest text-emerald-400 pb-1">Web Interface</div>
                              <UrlRow label="HTTP" url={`http://${r.ip}`} />
                              <UrlRow label="HTTPS" url={`https://${r.ip}`} />
                            </div>

                            {/* Log */}
                            <div className="flex flex-col gap-2.5">
                              <div className="text-[11px] font-bold uppercase tracking-widest text-amber-300 pb-1">Log</div>
                              {Boolean(
                                (r.onvif?.log?.length ?? 0) +
                                  (r.rtsp?.log?.length ?? 0) +
                                  (thumbnailLog[r.ip] ? 1 : 0)
                              ) ? (
                                <pre className="max-h-48 overflow-auto rounded-lg border border-white/10 bg-black/40 p-3 text-[11px] leading-snug text-slate-200">
{[
  ...(r.onvif?.log ?? []),
  ...(r.rtsp?.log ?? []),
  ...(thumbnailLog[r.ip] ? [`Thumbnail: ${thumbnailLog[r.ip]}`] : [])
].join("\n")}
                                </pre>
                              ) : (
                                <div className="text-xs text-slate-500">Kein Log verfügbar.</div>
                              )}
                            </div>
                          </div>
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
            </table>
            {data.warnings?.length ? (
              <div className="mt-4 rounded-lg border border-amber-900/40 bg-amber-950/30 p-4 text-sm text-amber-200">
                <div className="font-medium">Hinweise</div>
                <ul className="mt-2 list-disc pl-5 text-amber-100/90">
                  {data.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
        </div>
      </section>
    </div>
  );
}
