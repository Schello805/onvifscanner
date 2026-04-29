"use client";

import { useMemo, useRef, useState } from "react";
import type {
  ScanResult,
  ScanRequest,
  ScanResponse,
  ScanTargetPreset
} from "@/lib/types";

const defaultPorts = "80,443,554,8554,8000,8080,8899";
function parsePorts(input: string): number[] {
  const ports = input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n) && n > 0 && n <= 65535);
  return Array.from(new Set(ports));
}

function buildCameraSummary(r: ScanResult, thumbnailLog?: string): string[] {
  const lines = [`Kamera gefunden: ${r.ip}`];
  if (r.hostname) lines.push(`DNS/Hostname: ${r.hostname}`);
  if (r.manufacturer || r.model) {
    lines.push(`Gerät: ${[r.manufacturer, r.model].filter(Boolean).join(" · ")}`);
  } else {
    lines.push("Gerät: Hersteller/Modell noch nicht eindeutig erkannt.");
  }
  if (r.streamUris?.length) lines.push(`Stream-URLs: ${r.streamUris.length} erkannt.`);
  else lines.push("Stream-URLs: keine bestätigte URL erkannt.");
  if (r.snapshotUris?.length) lines.push(`Snapshot-URLs: ${r.snapshotUris.length} erkannt.`);
  else lines.push("Snapshot-URLs: keine bestätigte URL erkannt.");
  if (r.onvif?.ok) lines.push("ONVIF: erreichbar, Geräteinfos wurden abgefragt.");
  else if (r.onvif?.discoveryOnly) lines.push("ONVIF: XAddr/Endpoint gefunden, Tiefenanalyse nicht ausgeführt.");
  else if (r.onvif?.error) lines.push(`ONVIF: nicht erfolgreich (${r.onvif.error}).`);
  if (r.rtsp?.ok) lines.push("RTSP: erreichbar.");
  else if (r.rtsp?.discoveryOnly) lines.push("RTSP: Kandidaten vorhanden, nicht aktiv getestet.");
  else if (r.rtsp?.error) lines.push(`RTSP: nicht erfolgreich (${r.rtsp.error}).`);
  if (r.vendor?.profile && r.vendor.profile !== "Vendor-Katalog") {
    lines.push(`Vendor-Profil: ${r.vendor.profile}.`);
  }
  if (thumbnailLog) {
    lines.push(`Vorschau: ${thumbnailLog.includes("error") ? "nicht geladen, Details im Log." : "geprüft."}`);
  }
  return lines;
}

export default function HomePage() {
  const [preset, setPreset] = useState<ScanTargetPreset>("cidr");
  const [cidr, setCidr] = useState("192.168.1.0/24");
  const [ports, setPorts] = useState(defaultPorts);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [copyWithCreds, setCopyWithCreds] = useState(true);
  const [includeThumbnails, setIncludeThumbnails] = useState(true);
  const [thumbnailsOnExpandOnly, setThumbnailsOnExpandOnly] = useState(false);
  const [verboseLog, setVerboseLog] = useState(true);
  const [deepProbe, setDeepProbe] = useState(true);
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
      <span className="relative z-[9999] inline-flex shrink-0 align-middle group/info">
        <span
          className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-white/20 bg-slate-900 text-[10px] font-bold text-slate-300 shadow-sm hover:border-indigo-400 hover:text-white"
          aria-label="Info"
          role="img"
        >
          i
        </span>
        <span className="pointer-events-none absolute bottom-6 right-0 z-[9999] hidden w-64 rounded-md border border-indigo-400/20 bg-slate-950 px-3 py-2 text-[11px] font-normal leading-snug tracking-normal text-slate-100 shadow-2xl shadow-black/40 group-hover/info:block sm:left-1/2 sm:right-auto sm:-translate-x-1/2">
          {props.tip}
        </span>
      </span>
    );
  }

  function OptionCheck(props: {
    checked: boolean;
    disabled?: boolean;
    label: string;
    tip: string;
    onChange: (checked: boolean) => void;
  }) {
    const disabled = props.disabled ?? false;

    return (
      <label
        className={`relative flex min-h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 transition-colors ${
          disabled ? "cursor-not-allowed opacity-55" : "cursor-pointer hover:border-indigo-400/30 hover:bg-white/[0.06]"
        }`}
      >
        <span className="relative flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden rounded border border-white/20 bg-white/5">
          {props.checked && (
            <svg className="h-3 w-3 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
          <input
            type="checkbox"
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
            checked={props.checked}
            disabled={disabled}
            onChange={(e) => props.onChange(e.target.checked)}
          />
        </span>
        <span className="min-w-0 flex-1 text-[11px] leading-tight text-slate-300">{props.label}</span>
        <InfoTip tip={props.tip} />
      </label>
    );
  }

  function apiUrl(path: string): string {
    return new URL(path, window.location.origin).toString();
  }

  function getThumbUrlsForIp(ip: string): string[] {
    return latestResultsRef.current[ip]?.urls ?? [];
  }

  function indexResultsForThumbs(json: ScanResponse) {
    const map: Record<string, { ip: string; urls: string[] }> = {};
    for (const r of json.results) {
      const urls = Array.from(
        new Set(
          [
            ...(r.snapshotUris ?? []),
            ...(r.vendor?.snapshotUris ?? []),
            ...(r.onvif?.snapshotUris?.map((u) => u.uri).filter(Boolean) ?? []),
          ].filter(Boolean)
        )
      ).slice(0, 3);
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
        let logWritten = false;
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
              logWritten = true;
            } else {
              const txt = JSON.stringify(j).slice(0, 1200);
              setThumbnailLog((prev) => ({ ...prev, [ip]: txt }));
              logWritten = true;
            }
          } else {
            const txt = await thumbRes.text();
            setThumbnailLog((prev) => ({ ...prev, [ip]: txt.slice(0, 1200) }));
            logWritten = true;
          }
        } catch {
          // ignore
        }
        if (!logWritten) {
          setThumbnailLog((prev) => ({
            ...prev,
            [ip]: `Thumbnail proxy failed (HTTP ${thumbRes.status}).`
          }));
        }
        setThumbnailState((prev) => ({ ...prev, [ip]: "fail" }));
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
    };

    function enqueueInitialThumbs(json: ScanResponse) {
      if (!includeThumbnails) return;
      const count = thumbnailsOnExpandOnly ? 4 : json.results.length;
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
      if (u.searchParams.has("user") || u.searchParams.has("password")) return url;
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

  function PreviewThumb(props: { result: ScanResult; compact?: boolean }) {
    const r = props.result;
    const size = props.compact ? "h-20 w-28" : "h-14 w-24";
    if (thumbnails[r.ip]) {
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumbnails[r.ip]}
          alt={`Preview ${r.ip}`}
          className={`${size} rounded-xl border border-white/10 object-cover shadow-lg`}
        />
      );
    }

    const log = thumbnailLog[r.ip] ?? "";
    const lower = log.toLowerCase();
    let label = "Kein Bild";
    if (thumbnailState[r.ip] === "loading") label = "Lädt…";
    else if (lower.includes("digest") && lower.includes("401")) label = "Digest nötig";
    else if (lower.includes("401")) label = "Auth nötig";
    else if (
      includeThumbnails &&
      thumbnailsOnExpandOnly &&
      !expandedIps[r.ip] &&
      !initialThumbIpsRef.current.has(r.ip)
    ) {
      label = "Aufklappen";
    }

    return (
      <div className={`${size} flex items-center justify-center rounded-xl border border-white/5 bg-white/5 text-center text-[10px] font-medium uppercase tracking-wider text-slate-600`}>
        {label}
      </div>
    );
  }

  function UrlRow(props: { label: string; url: string; isApi?: boolean }) {
    const effective = addCredsIfWanted(props.url);
    return (
      <div className="flex flex-col gap-1.5 rounded-lg border border-white/5 bg-white/[0.03] p-2 sm:flex-row sm:items-center sm:gap-2 sm:border-0 sm:bg-transparent sm:p-0">
        <div className="shrink-0 text-xs font-semibold text-slate-400 sm:w-28 sm:font-normal">{props.label}</div>
        {props.isApi ? (
          <span
            className="min-w-0 flex-1 break-all font-mono text-[11px] text-slate-500 sm:truncate"
            title={props.url}
          >
            {props.url}
          </span>
        ) : (
          <a
            className="min-w-0 flex-1 break-all font-mono text-[11px] text-indigo-300 hover:text-indigo-200 sm:truncate"
            href={props.url}
            target="_blank"
            rel="noreferrer"
            title={props.url}
          >
            {props.url}
          </a>
        )}
        <button
          className="self-start rounded-md border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-slate-200 hover:bg-slate-900 sm:self-auto"
          onClick={() => copy(effective)}
          type="button"
        >
          Kopieren
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 sm:gap-8">
      <section className="glass-panel relative overflow-visible rounded-2xl p-4 sm:p-5 md:p-6">
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
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400 ml-1">Modus</span>
                <select
                  className="glass-input rounded-lg px-3 py-1.5 text-sm select-none"
                  value={preset}
                  onChange={(e) => {
                    const next = e.target.value as ScanTargetPreset;
                    setPreset(next);
                    setDeepProbe(true);
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
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 mt-1">
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
             <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
             
             <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
               <OptionCheck
                 checked={copyWithCreds}
                 label="Credentials anhängen"
                 tip='Beim Kopieren werden Benutzername und Passwort in die URL eingebettet (z. B. "http://user:pass@ip/..."). Vorsicht: sensibel.'
                 onChange={setCopyWithCreds}
               />
               <OptionCheck
                 checked={includeThumbnails}
                 label="Vorschau-Bilder laden"
                 tip="Lädt Snapshot/ISAPI-Bilder als kleine Vorschau. Manche Kameras benötigen Digest/Basic Auth; das kann länger dauern."
                 onChange={setIncludeThumbnails}
               />
               <OptionCheck
                 checked={thumbnailsOnExpandOnly}
                 disabled={!includeThumbnails}
                 label="Previews erst in Details"
                 tip="Lädt Vorschauen erst, wenn du eine Kamera-Zeile aufklappst. Das ist schneller und schont die Kameras."
                 onChange={setThumbnailsOnExpandOnly}
               />
               <OptionCheck
                 checked={verboseLog}
                 label="Verbose Log"
                 tip="Zeigt mehr Details wie Digest/401, Timeouts und genutzte Snapshot-URLs. Hilft beim Debuggen, erzeugt aber mehr Text."
                 onChange={setVerboseLog}
               />
               <OptionCheck
                 checked={deepProbe}
                 label="Erweiterte Analyse"
                 tip="Führt zusätzliche ONVIF-SOAP-Abfragen und RTSP-Tests aus, um echte Stream/Snapshot-URLs zu finden. Kann deutlich länger dauern."
                 onChange={setDeepProbe}
               />
               <OptionCheck
                 checked={ack}
                 label="Netzwerk bestätigt"
                 tip="Bestätigt, dass der Scan in deinem eigenen Heimnetz/LAN läuft."
                 onChange={setAck}
               />
             </div>

               <div className="mt-5 flex items-center gap-3">
                 <button
                   className="w-full group relative inline-flex h-12 sm:h-10 items-center justify-center overflow-hidden rounded-lg bg-indigo-600 px-6 font-medium text-white shadow-lg transition-all duration-300 disabled:pointer-events-none disabled:opacity-50 hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2 focus:ring-offset-slate-900"
                   onClick={runScan}
                   disabled={loading || !ack}
                   title={!ack ? "Bitte zuerst dein Heimnetz/LAN bestätigen." : undefined}
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

      <section className="glass-panel overflow-hidden relative rounded-3xl p-4 sm:p-6 md:p-8 mt-4">
        <div className="relative z-10">
          <div className="flex flex-col gap-3 border-b border-white/10 pb-4 sm:flex-row sm:items-end sm:justify-between">
            <h2 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 to-cyan-400 tracking-tight">Ergebnisse</h2>
            {data?.meta ? (
              <div className="flex w-full flex-wrap items-center gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.1)] sm:w-auto sm:rounded-full sm:py-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                {data.results.length} Gerät(e) • {data.meta.durationMs}ms
                {includeThumbnails ? (
                  <span className="text-slate-300/80">
                    • Preview{" "}
	                    {Object.values(thumbnailState).filter((s) => s === "ok").length}/
	                    {data.results.length}
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
            <>
            <div className="mt-4 flex flex-col gap-3 lg:hidden">
              {data.results.map((r) => (
                <article key={`mobile-${r.ip}`} className="rounded-2xl border border-white/10 bg-black/25 p-3 shadow-xl">
                  <div className="flex gap-3">
                    <PreviewThumb result={r} compact />
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-base text-slate-100">{r.ip}</div>
                      <div className="mt-0.5 truncate text-xs text-slate-500">
                        {r.hostname ?? "Hostname unbekannt"}
                      </div>
                      <div className="mt-2 text-sm font-semibold text-white">
                        {[r.manufacturer, r.model].filter(Boolean).join(" ") || "Unbekannt"}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300 border border-emerald-500/25">
                          {r.streamUris?.length ?? 0} Stream
                        </span>
                        <span className="rounded bg-cyan-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-cyan-300 border border-cyan-500/25">
                          {r.snapshotUris?.length ?? 0} Snapshot
                        </span>
                      </div>
                    </div>
                  </div>

                  <details
                    className="group mt-3 rounded-xl border border-white/10 bg-white/5 p-3 transition-all open:bg-black/35"
                    onToggle={(e) =>
                      handleDetailsToggle(
                        r.ip,
                        (e.currentTarget as HTMLDetailsElement).open
                      )
                    }
                  >
                    <summary className="flex cursor-pointer select-none items-center justify-between text-sm font-semibold text-slate-300">
                      URLs & Log
                      <span className="text-indigo-400 transition-transform group-open:rotate-180">▼</span>
                    </summary>

                    <div className="mt-4 flex flex-col gap-4 border-t border-white/5 pt-4">
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
                              ? "RTSP: Kandidaten"
                              : `RTSP: Fehler${r.rtsp.error ? ` (${r.rtsp.error})` : ""}`
                          : "RTSP: —"}
                      </div>

                      <div className="flex flex-col gap-2">
                        <div className="text-[11px] font-bold uppercase tracking-widest text-cyan-400">Stream & Snapshot URLs</div>
                        {r.streamUris?.length ? (
                          r.streamUris.map((u, idx) => (
                            <UrlRow key={`mobile-stream-${idx}-${u}`} label={idx === 0 ? "Stream" : `Stream ${idx + 1}`} url={u} />
                          ))
                        ) : (
                          <div className="text-xs text-slate-500">Keine Stream-URL erkannt.</div>
                        )}
                        {r.snapshotUris?.length ? (
                          r.snapshotUris.map((u, idx) => (
                            <UrlRow key={`mobile-snapshot-${idx}-${u}`} label={idx === 0 ? "Snapshot" : `Snapshot ${idx + 1}`} url={u} />
                          ))
                        ) : (
                          <div className="text-xs text-slate-500">Keine Snapshot-URL erkannt.</div>
                        )}
                      </div>

                      <pre className="max-h-44 overflow-auto rounded-lg border border-white/10 bg-black/40 p-3 text-[11px] leading-snug text-slate-200">
{[
  "Kurzstatus:",
  ...buildCameraSummary(r, thumbnailLog[r.ip]).map((line) => `- ${line}`),
  ...(verboseLog
    ? [
        "",
        "Technisches Log:",
        ...(r.onvif?.log ?? []),
        ...(r.rtsp?.log ?? []),
        ...(r.vendor?.log ?? []),
        ...(thumbnailLog[r.ip] ? [`Thumbnail: ${thumbnailLog[r.ip]}`] : [])
      ]
    : [])
].join("\n")}
                      </pre>
                    </div>
                  </details>
                </article>
              ))}
            </div>

            <div className="mt-6 hidden overflow-hidden rounded-2xl border border-white/10 bg-black/20 backdrop-blur-md shadow-2xl lg:block">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="bg-white/5 border-b border-white/10 text-xs font-bold uppercase tracking-widest text-slate-400">
                    <th className="py-3 pr-4 pl-4">Preview</th>
	                  <th className="py-3 pr-4">Gerät (IP & Hostname)</th>
                  <th className="py-3 pr-4">Hersteller & Modell</th>
                  <th className="py-3 pr-4 w-1/2">URLs & Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                  {data.results.map((r, i) => (
                    <tr key={r.ip} className={`align-top transition-colors hover:bg-white/[0.03] ${i % 2 === 0 ? 'bg-white/[0.01]' : 'bg-transparent'}`}>
                      <td className="p-4 align-middle">
                        <PreviewThumb result={r} />
                      </td>
                      
                      <td className="p-4 align-middle">
                        <div className="font-mono text-sm text-slate-200">{r.ip}</div>
                        <div className="mt-1 text-xs text-slate-500 font-medium">
                          {r.hostname ?? "Hostname unbekannt"}
                        </div>
                      </td>

                      <td className="p-4 align-middle">
                        <div className="flex flex-col gap-1.5">
	                          {r.manufacturer || r.model ? (
	                            <span className="text-sm font-bold text-white tracking-wide">
	                              {[r.manufacturer, r.model].filter(Boolean).join(" ")}
	                            </span>
	                          ) : (
	                            <span className="text-sm font-medium text-slate-500">Unbekannt</span>
	                          )}
	                          <div className="flex items-center gap-2">
                              <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300 border border-emerald-500/25">
                                {r.streamUris?.length ?? 0} Stream
                              </span>
                              <span className="rounded bg-cyan-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-cyan-300 border border-cyan-500/25">
                                {r.snapshotUris?.length ?? 0} Snapshot
                              </span>
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
                              <div className="text-[11px] font-bold uppercase tracking-widest text-cyan-400 pb-1">Stream & Snapshot URLs</div>
                              {r.streamUris?.length ? (
                                r.streamUris.map((u, idx) => (
                                  <UrlRow
                                    key={`stream-${idx}-${u}`}
                                    label={idx === 0 ? "Stream" : `Stream ${idx + 1}`}
                                    url={u}
                                  />
                                ))
                              ) : (
                                <div className="text-xs text-slate-500">
                                  Keine Stream-URL erkannt.
                                </div>
                              )}

                              {r.snapshotUris?.length ? (
                                r.snapshotUris.map((u, idx) => (
                                  <UrlRow
                                    key={`snapshot-${idx}-${u}`}
                                    label={idx === 0 ? "Snapshot" : `Snapshot ${idx + 1}`}
                                    url={u}
                                  />
                                ))
                              ) : (
                                <div className="text-xs text-slate-500">
                                  Keine Snapshot-URL erkannt.
                                </div>
                              )}
                            </div>

                            {/* Log */}
                            <div className="flex flex-col gap-2.5">
                              <div className="text-[11px] font-bold uppercase tracking-widest text-amber-300 pb-1">Log</div>
                              {buildCameraSummary(r, thumbnailLog[r.ip]).length ? (
                                <pre className="max-h-48 overflow-auto rounded-lg border border-white/10 bg-black/40 p-3 text-[11px] leading-snug text-slate-200">
{[
  "Kurzstatus:",
  ...buildCameraSummary(r, thumbnailLog[r.ip]).map((line) => `- ${line}`),
  ...(verboseLog
    ? [
        "",
        "Technisches Log:",
        ...(r.onvif?.log ?? []),
        ...(r.rtsp?.log ?? []),
        ...(r.vendor?.log ?? []),
        ...(thumbnailLog[r.ip] ? [`Thumbnail: ${thumbnailLog[r.ip]}`] : [])
      ]
    : [])
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
            </div>
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
            </>
        )}
        </div>
      </section>
    </div>
  );
}
