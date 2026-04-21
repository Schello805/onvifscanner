import net from "node:net";
import crypto from "node:crypto";
import type { RtspResult } from "@/lib/types";
import { buildDigestAuthorizationHeader, parseDigestChallenge } from "@/lib/auth/digest";

export async function probeRtsp(args: {
  ip: string;
  port: number;
  timeoutMs: number;
  credentials?: { username: string; password: string };
  uri?: string;
}): Promise<RtspResult> {
  const uri = args.uri ?? `rtsp://${args.ip}:${args.port}/`;
  const preferredMethod = "DESCRIBE";
  const log: string[] = [];

  try {
    log.push(`Probe: ${uri}`);
    const res1 = await rtspRequestWithFallback({
      ip: args.ip,
      port: args.port,
      timeoutMs: args.timeoutMs,
      uri,
      method: preferredMethod,
      credentials: args.credentials,
      log
    });

    return { ...res1, log: limitLog(res1.log ?? log) };
  } catch (e) {
    log.push(`Exception: ${e instanceof Error ? e.message : String(e)}`);
    return {
      ok: false,
      port: args.port,
      uriTried: uri,
      log: limitLog(log),
      error: e instanceof Error ? e.message : String(e)
    };
  }
}

function buildRtspRequest(args: {
  method: string;
  uri: string;
  headers: Record<string, string>;
}): string {
  const cseq = Math.floor(Math.random() * 9000) + 1000;
  const lines: string[] = [];
  lines.push(`${args.method} ${args.uri} RTSP/1.0`);
  lines.push(`CSeq: ${cseq}`);
  lines.push(`User-Agent: ONVIFscanner/0.1`);
  if (args.method === "DESCRIBE") {
    lines.push("Accept: application/sdp");
  }
  for (const [k, v] of Object.entries(args.headers)) {
    lines.push(`${capitalizeHeader(k)}: ${v}`);
  }
  lines.push("", "");
  return lines.join("\r\n");
}

function capitalizeHeader(h: string): string {
  return h
    .split("-")
    .map((p) => p.slice(0, 1).toUpperCase() + p.slice(1))
    .join("-");
}

type RtspParsedResponse = {
  statusLine?: string;
  statusCode?: number;
  headers: Record<string, string>;
};

async function rtspRequest(args: {
  ip: string;
  port: number;
  timeoutMs: number;
  request: string;
}): Promise<RtspParsedResponse> {
  const raw = await rtspRoundTrip(args);
  return parseRtspResponse(raw);
}

async function rtspRequestWithFallback(args: {
  ip: string;
  port: number;
  timeoutMs: number;
  uri: string;
  method: "DESCRIBE" | "OPTIONS";
  credentials?: { username: string; password: string };
  log: string[];
}): Promise<RtspResult> {
  const method = args.method;

  args.log.push(`Request: ${method} ${args.uri}`);
  const res1 = await rtspRequest({
    ip: args.ip,
    port: args.port,
    timeoutMs: args.timeoutMs,
    request: buildRtspRequest({
      method,
      uri: args.uri,
      headers: {}
    })
  });
  args.log.push(`Response: ${res1.statusLine ?? "no status line"}`);

  // Some servers don't support DESCRIBE on root; try OPTIONS as a fallback signal.
  if ((res1.statusCode === 405 || res1.statusCode === 404) && method === "DESCRIBE") {
    args.log.push("Fallback: DESCRIBE not supported, trying OPTIONS");
    return rtspRequestWithFallback({ ...args, method: "OPTIONS" });
  }

  if (res1.statusCode && res1.statusCode >= 200 && res1.statusCode < 400) {
    return {
      ok: true,
      port: args.port,
      uriTried: args.uri,
      authTried: "none",
      log: args.log.slice(),
      statusLine: res1.statusLine
    };
  }

  if (res1.statusCode === 401 && args.credentials) {
    const www = res1.headers["www-authenticate"];
    if (www) {
      args.log.push(`Auth challenge: ${www}`);
      const digest = parseDigestChallenge(www);
      if (digest) {
        const attempts = buildDigestAttempts(args.uri);
        const cnonce = randomHex(8);
        for (let i = 0; i < attempts.length; i += 1) {
          const attempt = attempts[i]!;
          const nc = formatNc(i + 1);
          args.log.push(
            `Auth: trying Digest (requestUri="${attempt.requestUri}" uri="${attempt.digestUri}")`
          );
          const authorization = buildDigestAuthorizationHeader({
            challenge: digest,
            method,
            uri: attempt.digestUri,
            username: args.credentials.username,
            password: args.credentials.password,
            nc,
            cnonce
          });
          const res2 = await rtspRequest({
            ip: args.ip,
            port: args.port,
            timeoutMs: args.timeoutMs,
            request: buildRtspRequest({
              method,
              uri: attempt.requestUri,
              headers: { authorization }
            })
          });
          args.log.push(`Auth response: ${res2.statusLine ?? "no status line"}`);
          const ok = !!res2.statusCode && res2.statusCode >= 200 && res2.statusCode < 400;
          if (ok) {
            return {
              ok: true,
              port: args.port,
              uriTried: attempt.requestUri,
              authTried: "digest",
              log: args.log.slice(),
              statusLine: res2.statusLine
            };
          }
        }

        // Fallthrough: digest failed. Some devices still accept Basic even when they advertise Digest.
        args.log.push("Auth: Digest failed, trying Basic as fallback");
        const basic = Buffer.from(
          `${args.credentials.username}:${args.credentials.password}`,
          "utf8"
        ).toString("base64");
        const resBasic = await rtspRequest({
          ip: args.ip,
          port: args.port,
          timeoutMs: args.timeoutMs,
          request: buildRtspRequest({
            method,
            uri: args.uri,
            headers: { authorization: `Basic ${basic}` }
          })
        });
        args.log.push(`Auth response: ${resBasic.statusLine ?? "no status line"}`);
        const okBasic =
          !!resBasic.statusCode && resBasic.statusCode >= 200 && resBasic.statusCode < 400;
        if (okBasic) {
          return {
            ok: true,
            port: args.port,
            uriTried: args.uri,
            authTried: "basic",
            log: args.log.slice(),
            statusLine: resBasic.statusLine
          };
        }

        return {
          ok: false,
          port: args.port,
          uriTried: args.uri,
          authTried: "digest",
          log: args.log.slice(),
          statusLine: res1.statusLine,
          error: "Digest auth failed"
        };
      }

      if (www.toLowerCase().includes("basic")) {
        args.log.push("Auth: trying Basic");
        const basic = Buffer.from(
          `${args.credentials.username}:${args.credentials.password}`,
          "utf8"
        ).toString("base64");
        const res2 = await rtspRequest({
          ip: args.ip,
          port: args.port,
          timeoutMs: args.timeoutMs,
          request: buildRtspRequest({
            method,
            uri: args.uri,
            headers: { authorization: `Basic ${basic}` }
          })
        });
        args.log.push(`Auth response: ${res2.statusLine ?? "no status line"}`);
        const ok = !!res2.statusCode && res2.statusCode >= 200 && res2.statusCode < 400;
        return {
          ok,
          port: args.port,
          uriTried: args.uri,
          authTried: "basic",
          log: args.log.slice(),
          statusLine: res2.statusLine,
          error: ok ? undefined : `RTSP ${res2.statusCode ?? "?"}`
        };
      }
    }
  }

  return {
    ok: false,
    port: args.port,
    uriTried: args.uri,
    log: args.log.slice(),
    statusLine: res1.statusLine,
    error: res1.statusCode ? `RTSP ${res1.statusCode}` : "Keine Antwort"
  };
}

function limitLog(lines: string[]): string[] {
  const max = 80;
  if (lines.length <= max) return lines;
  return [...lines.slice(0, 20), `... (${lines.length - 40} more) ...`, ...lines.slice(-19)];
}

function buildDigestUriVariants(fullUri: string): string[] {
  // Some RTSP servers expect the Digest "uri" directive to be only path+query,
  // others accept the absolute RTSP URI. Try both.
  const out: string[] = [];
  out.push(fullUri);
  try {
    const u = new URL(fullUri);
    const path = `${u.pathname}${u.search}`;
    if (path && path !== fullUri) out.push(path);
  } catch {
    // ignore
  }
  return Array.from(new Set(out));
}

function buildDigestAttempts(fullUri: string): Array<{ requestUri: string; digestUri: string }> {
  const variants = buildDigestUriVariants(fullUri);
  const out: Array<{ requestUri: string; digestUri: string }> = [];

  // Some servers require the request line URI and digest-uri to match.
  for (const v of variants) out.push({ requestUri: v, digestUri: v });

  // Others accept absolute in request line but expect path in digest (or vice versa).
  if (variants.length >= 2) {
    const [a, b] = variants;
    out.push({ requestUri: a!, digestUri: b! });
    out.push({ requestUri: b!, digestUri: a! });
  }

  // Extra broken variants:
  // - absolute without explicit port (rtsp://host/path)
  // - path without leading slash (h265)
  try {
    const u = new URL(fullUri);
    const absNoPort = `rtsp://${u.hostname}${u.pathname}${u.search}`;
    const path = `${u.pathname}${u.search}`;
    const pathNoSlash = path.startsWith("/") ? path.slice(1) : path;

    out.push({ requestUri: absNoPort, digestUri: absNoPort });
    out.push({ requestUri: absNoPort, digestUri: path });
    if (pathNoSlash) {
      out.push({ requestUri: pathNoSlash, digestUri: pathNoSlash });
      out.push({ requestUri: pathNoSlash, digestUri: path });
    }
  } catch {
    // ignore
  }

  // De-dupe while keeping order.
  const seen = new Set<string>();
  return out.filter((a) => {
    const key = `${a.requestUri}||${a.digestUri}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatNc(n: number): string {
  const hex = Math.max(1, Math.trunc(n)).toString(16);
  return hex.padStart(8, "0");
}

function randomHex(bytes: number): string {
  return crypto.randomBytes(bytes).toString("hex");
}

function rtspRoundTrip(args: {
  ip: string;
  port: number;
  timeoutMs: number;
  request: string;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let buffer = "";
    let done = false;

    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      socket.destroy();
      if (err) reject(err);
      else resolve(buffer);
    };

    socket.setTimeout(args.timeoutMs);
    socket.once("timeout", () => finish(new Error("RTSP timeout")));
    socket.once("error", (e) => finish(e instanceof Error ? e : new Error(String(e))));
    socket.connect(args.port, args.ip, () => {
      socket.write(args.request);
    });

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      // Stop after headers (most we need).
      if (buffer.includes("\r\n\r\n")) finish();
      // Safety cap.
      if (buffer.length > 64_000) finish();
    });
  });
}

function parseRtspResponse(raw: string): RtspParsedResponse {
  const [head] = raw.split("\r\n\r\n");
  const lines = (head ?? "").split("\r\n").filter(Boolean);
  const statusLine = lines[0];
  const statusCode = statusLine ? Number(statusLine.split(" ")[1]) : undefined;
  const headers: Record<string, string> = {};

  for (const line of lines.slice(1)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const k = line.slice(0, idx).trim().toLowerCase();
    const v = line.slice(idx + 1).trim();
    headers[k] = v;
  }

  return {
    statusLine,
    statusCode: Number.isFinite(statusCode) ? statusCode : undefined,
    headers
  };
}
