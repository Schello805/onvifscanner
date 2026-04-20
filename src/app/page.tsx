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

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
        <h1 className="text-xl font-semibold">Kameras im Netzwerk finden</h1>
        <p className="mt-2 text-sm text-slate-300">
          WS-Discovery ist der schnellste und sauberste Weg für ONVIF. Falls du
          zusätzlich RTSP/HTTP Ports testen willst, nutze den CIDR-Scan.
        </p>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-2">
            <span className="text-sm text-slate-200">Scan-Modus</span>
            <select
              className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-slate-100"
              value={preset}
              onChange={(e) => setPreset(e.target.value as ScanTargetPreset)}
            >
              <option value="ws-discovery">WS-Discovery (ONVIF)</option>
              <option value="cidr">CIDR/Port-Scan (optional)</option>
            </select>
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-sm text-slate-200">Timeout pro Probe (ms)</span>
            <input
              className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2"
              type="number"
              min={200}
              max={10000}
              value={timeoutMs}
              onChange={(e) => setTimeoutMs(Number(e.target.value))}
            />
          </label>

          {preset === "cidr" ? (
            <>
              <label className="flex flex-col gap-2">
                <span className="text-sm text-slate-200">CIDR</span>
                <input
                  className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2"
                  value={cidr}
                  onChange={(e) => setCidr(e.target.value)}
                  placeholder="z. B. 192.168.1.0/24"
                />
                <span className="text-xs text-slate-400">
                  Standardmäßig nur private Ranges (RFC1918).
                </span>
              </label>

              <label className="flex flex-col gap-2">
                <span className="text-sm text-slate-200">Ports (CSV)</span>
                <input
                  className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2"
                  value={ports}
                  onChange={(e) => setPorts(e.target.value)}
                  placeholder={defaultPorts}
                />
              </label>

              <label className="flex flex-col gap-2">
                <span className="text-sm text-slate-200">Concurrency</span>
                <input
                  className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2"
                  type="number"
                  min={1}
                  max={1024}
                  value={concurrency}
                  onChange={(e) => setConcurrency(Number(e.target.value))}
                />
              </label>
            </>
          ) : (
            <div className="rounded-lg border border-slate-800 bg-slate-950/30 p-4 text-sm text-slate-300 md:col-span-2">
              WS-Discovery benötigt keinen IP-Range. Es funktioniert am besten,
              wenn der Server im gleichen LAN/VLAN läuft.
            </div>
          )}

          <div className="md:col-span-2">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="flex flex-col gap-2">
                <span className="text-sm text-slate-200">
                  Benutzername (optional)
                </span>
                <input
                  className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                />
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-sm text-slate-200">
                  Passwort (optional)
                </span>
                <input
                  className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </label>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Credentials werden nicht gespeichert, nur für diesen Scan genutzt.
            </p>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-3">
          <label className="flex items-start gap-3 text-sm text-slate-200">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 rounded border-slate-700 bg-slate-950"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
            />
            <span>
              Ich bestätige, dass ich nur in einem eigenen oder ausdrücklich
              autorisierten Netzwerk scanne.
            </span>
          </label>

          <div className="flex items-center gap-3">
            <button
              className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={runScan}
              disabled={loading || !ack}
            >
              {loading ? "Scan läuft…" : "Scan starten"}
            </button>
            <div className="text-xs text-slate-400">
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

      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Ergebnisse</h2>
          {data?.meta ? (
            <div className="text-xs text-slate-400">
              {data.meta.mode} · {data.meta.durationMs}ms ·{" "}
              {data.results.length} Device(s)
            </div>
          ) : (
            <div className="text-xs text-slate-500">Noch kein Scan</div>
          )}
        </div>

        {!data ? (
          <div className="mt-4 text-sm text-slate-300">
            Starte einen Scan, um Geräte zu sehen.
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-400">
                <tr className="border-b border-slate-800">
                  <th className="py-3 pr-4">Preview</th>
                  <th className="py-3 pr-4">IP</th>
                  <th className="py-3 pr-4">Open Ports</th>
                  <th className="py-3 pr-4">ONVIF</th>
                  <th className="py-3 pr-4">RTSP</th>
                </tr>
              </thead>
              <tbody>
                {data.results.map((r) => (
                  <tr key={r.ip} className="border-b border-slate-800/60">
                    <td className="py-3 pr-4">
                      {r.onvif?.thumbnailDataUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={r.onvif.thumbnailDataUrl}
                          alt={`Preview ${r.ip}`}
                          className="h-12 w-20 rounded-md border border-slate-800 object-cover"
                        />
                      ) : (
                        <div className="h-12 w-20 rounded-md border border-slate-800/70 bg-slate-950/40" />
                      )}
                    </td>
                    <td className="py-3 pr-4 font-mono text-xs">{r.ip}</td>
                    <td className="py-3 pr-4">
                      {r.openTcpPorts?.length
                        ? r.openTcpPorts.join(", ")
                        : "—"}
                    </td>
                    <td className="py-3 pr-4">
                      {r.onvif?.ok ? (
                        <div className="flex flex-col gap-1">
                          <span className="text-emerald-300">OK</span>
                          {r.onvif.deviceInformation?.manufacturer ||
                          r.onvif.deviceInformation?.model ? (
                            <span className="text-xs text-slate-200">
                              {[r.onvif.deviceInformation?.manufacturer, r.onvif.deviceInformation?.model]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          ) : null}
                          {r.onvif.xaddrs?.[0] ? (
                            <a
                              className="text-xs text-indigo-300 hover:text-indigo-200"
                              href={r.onvif.xaddrs[0]}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Endpoint öffnen
                            </a>
                          ) : null}
                          {r.onvif.rtspUris?.[0] ? (
                            <span className="font-mono text-[11px] text-slate-300">
                              {r.onvif.rtspUris[0]}
                            </span>
                          ) : null}
                        </div>
                      ) : r.onvif ? (
                        <span className="text-slate-400">
                          Nein{r.onvif.error ? ` (${r.onvif.error})` : ""}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      {r.rtsp?.ok ? (
                        <div className="flex flex-col gap-1">
                          <span className="text-emerald-300">
                            OK{typeof r.rtsp.port === "number" ? ` (:${r.rtsp.port})` : ""}
                          </span>
                          {r.rtsp.statusLine ? (
                            <span className="font-mono text-[11px] text-slate-300">
                              {r.rtsp.statusLine}
                            </span>
                          ) : null}
                        </div>
                      ) : r.rtsp ? (
                        <span className="text-slate-400">
                          Nein{r.rtsp.error ? ` (${r.rtsp.error})` : ""}
                        </span>
                      ) : (
                        "—"
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
