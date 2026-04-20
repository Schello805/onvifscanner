import net from "node:net";
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
  const method = "OPTIONS";

  try {
    const res1 = await rtspRequest({
      ip: args.ip,
      port: args.port,
      timeoutMs: args.timeoutMs,
      request: buildRtspRequest({
        method,
        uri,
        headers: {}
      })
    });

    if (res1.statusCode && res1.statusCode >= 200 && res1.statusCode < 400) {
      return {
        ok: true,
        port: args.port,
        uriTried: uri,
        authTried: "none",
        statusLine: res1.statusLine
      };
    }

    if (res1.statusCode === 401 && args.credentials) {
      const www = res1.headers["www-authenticate"];
      if (www) {
        const digest = parseDigestChallenge(www);
        if (digest) {
          const authorization = buildDigestAuthorizationHeader({
            challenge: digest,
            method,
            uri,
            username: args.credentials.username,
            password: args.credentials.password
          });
          const res2 = await rtspRequest({
            ip: args.ip,
            port: args.port,
            timeoutMs: args.timeoutMs,
            request: buildRtspRequest({
              method,
              uri,
              headers: { authorization }
            })
          });
          const ok = !!res2.statusCode && res2.statusCode >= 200 && res2.statusCode < 400;
          return {
            ok,
            port: args.port,
            uriTried: uri,
            authTried: "digest",
            statusLine: res2.statusLine,
            error: ok ? undefined : `RTSP ${res2.statusCode ?? "?"}`
          };
        }

        if (www.toLowerCase().includes("basic")) {
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
              uri,
              headers: { authorization: `Basic ${basic}` }
            })
          });
          const ok = !!res2.statusCode && res2.statusCode >= 200 && res2.statusCode < 400;
          return {
            ok,
            port: args.port,
            uriTried: uri,
            authTried: "basic",
            statusLine: res2.statusLine,
            error: ok ? undefined : `RTSP ${res2.statusCode ?? "?"}`
          };
        }
      }
    }

    return {
      ok: false,
      port: args.port,
      uriTried: uri,
      statusLine: res1.statusLine,
      error: res1.statusCode ? `RTSP ${res1.statusCode}` : "Keine Antwort"
    };
  } catch (e) {
    return {
      ok: false,
      port: args.port,
      uriTried: uri,
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
