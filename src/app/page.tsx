"use client";

import { useMemo, useState } from "react";
import type {
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

export default function HomePage() {
  const [preset, setPreset] = useState<ScanTargetPreset>("ws-discovery");
  const [cidr, setCidr] = useState("192.168.1.0/24");
  const [ports, setPorts] = useState(defaultPorts);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [copyWithCreds, setCopyWithCreds] = useState(false);
  const [timeoutMs, setTimeoutMs] = useState(1200);
  const [concurrency, setConcurrency] = useState(128);
  const [ack, setAck] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ScanResponse | null>(null);

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
      acknowledgeAuthorizedNetwork: ack
    }),
    [ack, cidr, concurrency, password, ports, preset, timeoutMs, username]
  );

  async function runScan() {
    setError(null);
    setLoading(true);
    setData(null);
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request)
      });
      const json = (await res.json()) as ScanResponse;
      if (!res.ok) {
        throw new Error(json.error ?? "Scan fehlgeschlagen.");
      }
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
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
      <section className="card bg-base-200/60 backdrop-blur-md shadow-2xl border border-base-content/5">
        <div className="card-body p-6 md:p-8">
        <h1 className="card-title text-2xl font-bold">Kameras im Netzwerk finden</h1>
        <p className="mt-1 text-sm text-base-content/70">
          WS-Discovery ist der schnellste und sauberste Weg für ONVIF. Falls du
          zusätzlich RTSP/HTTP Ports testen willst, nutze den CIDR-Scan.
        </p>

        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <label className="form-control w-full">
            <div className="label"><span className="label-text font-medium">Scan-Modus</span></div>
            <select
              className="select select-bordered w-full bg-base-100"
              value={preset}
              onChange={(e) => setPreset(e.target.value as ScanTargetPreset)}
            >
              <option value="ws-discovery">WS-Discovery (ONVIF)</option>
              <option value="cidr">CIDR/Port-Scan (optional)</option>
            </select>
          </label>

          <label className="form-control w-full">
            <div className="label"><span className="label-text font-medium">Timeout pro Probe (ms)</span></div>
            <input
              className="input input-bordered w-full bg-base-100"
              type="number"
              min={200}
              max={10000}
              value={timeoutMs}
              onChange={(e) => setTimeoutMs(Number(e.target.value))}
            />
          </label>

          {preset === "cidr" ? (
            <>
              <label className="form-control w-full">
                <div className="label"><span className="label-text font-medium">CIDR</span></div>
                <input
                  className="input input-bordered w-full bg-base-100"
                  value={cidr}
                  onChange={(e) => setCidr(e.target.value)}
                  placeholder="z. B. 192.168.1.0/24"
                />
                <div className="label"><span className="label-text-alt text-base-content/60">Standardmäßig nur private Ranges (RFC1918).</span></div>
              </label>

              <label className="form-control w-full">
                <div className="label"><span className="label-text font-medium">Ports (CSV)</span></div>
                <input
                  className="input input-bordered w-full bg-base-100"
                  value={ports}
                  onChange={(e) => setPorts(e.target.value)}
                  placeholder={defaultPorts}
                />
              </label>

              <label className="form-control w-full">
                <div className="label"><span className="label-text font-medium">Concurrency</span></div>
                <input
                  className="input input-bordered w-full bg-base-100"
                  type="number"
                  min={1}
                  max={1024}
                  value={concurrency}
                  onChange={(e) => setConcurrency(Number(e.target.value))}
                />
              </label>
            </>
          ) : (
            <div className="alert alert-info shadow-sm bg-base-300 text-base-content/80 md:col-span-2 text-sm">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" className="stroke-current shrink-0 w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
              <span>WS-Discovery benötigt keinen IP-Range. Es funktioniert am besten, wenn der Server im gleichen LAN/VLAN läuft.</span>
            </div>
          )}

          <div className="md:col-span-2">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="form-control w-full">
                <div className="label"><span className="label-text font-medium">Benutzername (optional)</span></div>
                <input
                  className="input input-bordered w-full bg-base-100"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                />
              </label>
              <label className="form-control w-full">
                <div className="label"><span className="label-text font-medium">Passwort (optional)</span></div>
                <input
                  className="input input-bordered w-full bg-base-100"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </label>
            </div>
            <label className="cursor-pointer label mt-3 justify-start gap-3">
              <input
                type="checkbox"
                className="checkbox checkbox-primary"
                checked={copyWithCreds}
                onChange={(e) => setCopyWithCreds(e.target.checked)}
              />
              <span>
                Beim Kopieren Credentials in die URL einsetzen (z. B.{" "}
                <span className="font-mono text-xs">
                  http://user:pass@host/…
                </span>
                ). Vorsicht: landet in der Zwischenablage.
              </span>
            </label>
            <p className="mt-2 text-xs text-slate-400">
              Credentials werden nicht gespeichert, nur für diesen Scan genutzt.
            </p>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-3">
          <label className="cursor-pointer label justify-start gap-4 p-0">
            <input
              type="checkbox"
              className="checkbox checkbox-primary checkbox-sm md:checkbox-md"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
            />
            <span className="label-text text-base-content/80">
              Ich bestätige, dass ich nur in einem eigenen oder ausdrücklich autorisierten Netzwerk scanne.
            </span>
          </label>

          <div className="flex items-center gap-4 mt-2">
            <button
              className="btn btn-primary min-w-[200px]"
              onClick={runScan}
              disabled={loading || !ack}
            >
              {loading ? <span className="loading loading-spinner"></span> : null}
              {loading ? "Scan läuft…" : "Scan starten"}
            </button>
            <div className="text-xs text-base-content/60">
              Ergebnis wird lokal im Browser angezeigt.
            </div>
          </div>
        </div>

        {error ? (
          <div className="mt-5 rounded-lg border border-red-900/50 bg-red-950/40 p-4 text-sm text-red-200">
            {error}
          </div>
        ) : null}
      </section>

      <section className="card bg-base-200/60 backdrop-blur-md shadow-2xl border border-base-content/5 mt-4">
        <div className="card-body p-6 md:p-8">
        <div className="flex items-center justify-between">
          <h2 className="card-title text-xl font-bold">Ergebnisse</h2>
          {data?.meta ? (
            <div className="badge badge-neutral shadow-sm">
              {data.meta.mode} · {data.meta.durationMs}ms ·{" "}
              {data.results.length} Device(s)
            </div>
          ) : (
            <div className="text-xs text-base-content/50">Noch kein Scan</div>
          )}
        </div>

        {!data ? (
          <div className="mt-8 text-center text-sm text-base-content/60 py-10 opacity-70">
            <div className="mb-2">🕵️‍♂️</div>
            Starte oben einen Scan, um Geräte im Netzwerk zu finden.
          </div>
        ) : (
          <div className="mt-6 overflow-x-auto rounded-box border border-base-content/10">
            <table className="table table-zebra table-pin-rows w-full text-sm">
              <thead className="bg-base-300 text-base-content uppercase">
                <tr className="border-b border-slate-800">
                  <th className="py-3 pr-4">Preview</th>
                  <th className="py-3 pr-4">Gerät (IP & Ports)</th>
                  <th className="py-3 pr-4">Hersteller & Modell</th>
                  <th className="py-3 pr-4 w-1/2">URLs & Details</th>
                </tr>
              </thead>
              <tbody>
                {data.results.map((r) => (
                  <tr key={r.ip} className="border-b border-slate-800/60 align-top">
                    <td className="py-3 pr-4">
                      {r.onvif?.thumbnailDataUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={r.onvif.thumbnailDataUrl}
                          alt={`Preview ${r.ip}`}
                          className="h-12 w-20 rounded-md border border-slate-800 object-cover"
                        />
                      ) : (
                        <div className="flex h-12 w-20 items-center justify-center rounded-md border border-slate-800/70 bg-slate-950/40 text-[10px] text-slate-500">
                          No preview
                        </div>
                      )}
                    </td>
                    
                    <td className="py-3 pr-4">
                      <div className="font-mono text-xs">{r.ip}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {r.openTcpPorts?.length ? r.openTcpPorts.join(", ") : "—"}
                      </div>
                    </td>

                    <td className="py-3 pr-4">
                      <div className="flex flex-col gap-1">
                        {r.onvif?.ok && (r.onvif.deviceInformation?.manufacturer || r.onvif.deviceInformation?.model) ? (
                          <span className="text-sm font-medium text-slate-200">
                            {[r.onvif.deviceInformation.manufacturer, r.onvif.deviceInformation.model]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        ) : (
                          <span className="text-sm text-slate-500">Unbekannt</span>
                        )}
                        <div className="flex items-center gap-2 mt-1">
                          {r.onvif?.ok ? (
                            <span className="rounded bg-emerald-950/50 px-1.5 py-0.5 text-[10px] text-emerald-400 border border-emerald-900/50">ONVIF OK</span>
                          ) : r.onvif ? (
                            <span title={r.onvif.error} className="rounded bg-red-950/50 px-1.5 py-0.5 text-[10px] text-red-400 border border-red-900/50">ONVIF Fail</span>
                          ) : null}
                          
                          {r.rtsp?.ok ? (
                            <span className="rounded bg-emerald-950/50 px-1.5 py-0.5 text-[10px] text-emerald-400 border border-emerald-900/50">RTSP OK</span>
                          ) : r.rtsp ? (
                            <span title={r.rtsp.error} className="rounded bg-slate-900 px-1.5 py-0.5 text-[10px] text-slate-400 border border-slate-800">RTSP Fail</span>
                          ) : null}
                        </div>
                      </div>
                    </td>

                    <td className="py-3 pr-4">
                      {((r.onvif?.ok && 
                         (r.onvif.rtspUris?.length || r.onvif.snapshotUris?.length || r.onvif.deviceServiceUrl || r.onvif.xaddrs?.length)) || 
                        r.rtsp?.uris?.length || 
                        r.rtsp?.candidates?.length) ? (
                        <details className="rounded-xl border border-slate-700/50 bg-slate-900/40 p-3 backdrop-blur-sm shadow-sm transition-all">
                          <summary className="cursor-pointer select-none text-xs font-medium text-slate-200 hover:text-white transition">
                            Gefundene URLs anzeigen
                          </summary>
                          
                          <div className="mt-3 flex flex-col gap-4">
                            
                            {/* ALL RTSP / Media Uris Merged */}
                            {Boolean(r.onvif?.rtspUris?.length || r.onvif?.snapshotUris?.length || r.rtsp?.uris?.length || r.rtsp?.candidates?.length) && (
                              <div className="flex flex-col gap-2 relative">
                                <div className="text-xs font-semibold text-slate-300 border-b border-slate-800/80 pb-1">▶️ Media & Streams (ONVIF & RTSP)</div>
                                
                                {r.rtsp?.uriTried && (
                                  <UrlRow label="Standard RTSP" url={r.rtsp.uriTried} />
                                )}

                                {r.rtsp?.uris?.map((u, idx) => (
                                  <UrlRow key={`rtsp-ok-${idx}`} label={idx === 0 ? "RTSP (Scanner)" : `RTSP (Scanner) ${idx + 1}`} url={u} />
                                ))}

                                {r.onvif?.rtspUris?.map((u, idx) => (
                                  <UrlRow
                                    key={`${u.uri}-onvif-${idx}`}
                                    label={u.profileName ? `RTSP (${u.profileName})` : `RTSP ${idx + 1}`}
                                    url={u.uri}
                                  />
                                ))}

                                {r.rtsp?.candidates?.map((u, idx) => (
                                  <UrlRow key={`rtsp-cand-${idx}`} label={idx === 0 ? "Kandidat" : `Kandidat ${idx + 1}`} url={u} />
                                ))}

                                {r.onvif?.snapshotUris?.map((u, idx) => (
                                  <UrlRow
                                    key={`${u.uri}-snap-${idx}`}
                                    label={u.profileName ? `Snapshot (${u.profileName})` : `Snapshot ${idx + 1}`}
                                    url={u.uri}
                                  />
                                ))}
                              </div>
                            )}

                            {/* API URIs */}
                            {Boolean(r.onvif?.deviceServiceUrl || r.onvif?.mediaServiceUrl || r.onvif?.mediaServiceUrl2 || r.onvif?.xaddrs?.length) && (
                              <div className="flex flex-col gap-2">
                                <div className="text-xs font-semibold text-slate-500 border-b border-slate-800/80 pb-1">⚙️ ONVIF API Endpoints (Keine Web-UI)</div>
                                {r.onvif?.deviceServiceUrl && <UrlRow label="Device Service" url={r.onvif.deviceServiceUrl} isApi />}
                                {r.onvif?.mediaServiceUrl && <UrlRow label="Media Service" url={r.onvif.mediaServiceUrl} isApi />}
                                {r.onvif?.mediaServiceUrl2 && <UrlRow label="Media2 Service" url={r.onvif.mediaServiceUrl2} isApi />}
                                {r.onvif?.xaddrs?.map((u, idx) => (
                                  <UrlRow key={`xaddr-${idx}`} label={`XAddr ${idx + 1}`} url={u} isApi />
                                ))}
                              </div>
                            )}

                            {/* UI */}
                            <div className="flex flex-col gap-2">
                              <div className="text-xs font-semibold text-indigo-300 border-b border-slate-800/80 pb-1">🌐 Web Interface</div>
                              <UrlRow label="HTTP (Standard)" url={`http://${r.ip}`} />
                              <UrlRow label="HTTPS (Standard)" url={`https://${r.ip}`} />
                            </div>

                          </div>
                        </details>
                      ) : (
                        <span className="text-xs text-slate-500">Keine URLs gefunden</span>
                      )}
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
      </section>
    </div>
  );
}
