import { parseDigestChallenge, buildDigestAuthorizationHeader } from "@/lib/auth/digest";

export async function fetchWithDigestAuth(args: {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs: number;
  credentials?: { username: string; password: string };
  signal?: AbortSignal;
  fastMode?: boolean;
  debugLog?: string[];
}): Promise<Response> {
  const method = args.method.toUpperCase();
  const fastMode = Boolean(args.fastMode);

  // Preemptive Basic: many devices (e.g. vendor snapshot endpoints) accept Basic even when they
  // don't advertise it correctly. This also avoids an extra roundtrip in the common case.
  if (args.credentials) {
    const basic = Buffer.from(
      `${args.credentials.username}:${args.credentials.password}`,
      "utf8"
    ).toString("base64");
    args.debugLog?.push("Auth: trying Basic (preemptive)");
    const res0 = await fetchWithTimeout({
      url: args.url,
      method,
      headers: { ...(args.headers ?? {}), authorization: `Basic ${basic}` },
      body: args.body,
      timeoutMs: args.timeoutMs,
      signal: args.signal
    });
    args.debugLog?.push(`Auth: Basic(preemptive) -> HTTP ${res0.status}`);
    if (res0.status !== 401) return res0;

    // Some devices only return a usable Digest challenge on the request that included Authorization.
    // If we already got WWW-Authenticate here, use it without doing another unauthenticated round-trip.
    const www0 = res0.headers.get("www-authenticate");
    if (www0 && /digest/i.test(www0)) {
      args.debugLog?.push(`WWW-Authenticate(from basic): ${www0}`);
      const digestHeader0 = pickDigestHeader(www0);
      const challenge0 = digestHeader0 ? parseDigestChallenge(digestHeader0) : null;
      if (challenge0) {
        const uri = new URL(args.url).pathname + new URL(args.url).search;
        const authorization = buildDigestAuthorizationHeader({
          challenge: challenge0,
          method,
          uri,
          username: args.credentials.username,
          password: args.credentials.password
        });
        args.debugLog?.push(`Auth: trying Digest (uri="${uri}")`);
        const res0d = await fetchWithTimeout({
          url: args.url,
          method,
          headers: { ...(args.headers ?? {}), authorization },
          body: args.body,
          timeoutMs: args.timeoutMs,
          signal: args.signal
        });
        args.debugLog?.push(`Auth: Digest -> HTTP ${res0d.status}`);
        return res0d;
      }
    }

    // Fast mode: avoid extra round-trips unless we can quickly fetch a Digest challenge.
    if (fastMode) {
      const shortTimeout = Math.min(700, args.timeoutMs);
      args.debugLog?.push(`Auth: fastMode -> try unauth (timeout=${shortTimeout}ms)`);
      const resFast = await fetchWithTimeout({
        url: args.url,
        method,
        headers: args.headers,
        body: args.body,
        timeoutMs: shortTimeout,
        signal: args.signal
      });
      args.debugLog?.push(`Auth: unauth(fast) -> HTTP ${resFast.status}`);
      const wwwFast = resFast.headers.get("www-authenticate");
      if (!wwwFast) return res0;
      const digestHeaderFast = pickDigestHeader(wwwFast);
      const challengeFast = digestHeaderFast ? parseDigestChallenge(digestHeaderFast) : null;
      if (!challengeFast) return res0;
      const uri = new URL(args.url).pathname + new URL(args.url).search;
      const authorization = buildDigestAuthorizationHeader({
        challenge: challengeFast,
        method,
        uri,
        username: args.credentials.username,
        password: args.credentials.password
      });
      args.debugLog?.push(`Auth: trying Digest (uri="${uri}")`);
      const resFastD = await fetchWithTimeout({
        url: args.url,
        method,
        headers: { ...(args.headers ?? {}), authorization },
        body: args.body,
        timeoutMs: args.timeoutMs,
        signal: args.signal
      });
      args.debugLog?.push(`Auth: Digest -> HTTP ${resFastD.status}`);
      return resFastD;
    }
    // Fall through (non-fast): some devices require Digest and will respond with WWW-Authenticate on an unauth request.
  }

  args.debugLog?.push("Auth: requesting without Authorization");
  const res1 = await fetchWithTimeout({
    url: args.url,
    method,
    headers: args.headers,
    body: args.body,
    timeoutMs: args.timeoutMs,
    signal: args.signal
  });
  args.debugLog?.push(`Auth: unauth -> HTTP ${res1.status}`);
  if (res1.status !== 401 || !args.credentials) return res1;

  const www = res1.headers.get("www-authenticate");
  if (!www) return res1;
  args.debugLog?.push(`WWW-Authenticate: ${www}`);

  if (/basic/i.test(www)) {
    const basic = Buffer.from(
      `${args.credentials.username}:${args.credentials.password}`,
      "utf8"
    ).toString("base64");
    return fetchWithTimeout({
      url: args.url,
      method,
      headers: { ...(args.headers ?? {}), authorization: `Basic ${basic}` },
      body: args.body,
      timeoutMs: args.timeoutMs,
      signal: args.signal
    });
  }

  const digestHeader = pickDigestHeader(www);
  if (!digestHeader) return res1;

  const challenge = parseDigestChallenge(digestHeader);
  if (!challenge) return res1;

  const uri = new URL(args.url).pathname + new URL(args.url).search;
  const authorization = buildDigestAuthorizationHeader({
    challenge,
    method,
    uri,
    username: args.credentials.username,
    password: args.credentials.password
  });

  args.debugLog?.push(`Auth: trying Digest (uri="${uri}")`);
  const res2 = await fetchWithTimeout({
    url: args.url,
    method,
    headers: { ...(args.headers ?? {}), authorization },
    body: args.body,
    timeoutMs: args.timeoutMs,
    signal: args.signal
  });
  args.debugLog?.push(`Auth: Digest -> HTTP ${res2.status}`);
  return res2;
}

function pickDigestHeader(wwwAuthenticate: string): string | null {
  // Some servers send multiple challenges in one string.
  const digestHeader = wwwAuthenticate
    .split(/,(?=\s*Digest\s)/i)
    .map((s) => s.trim())
    .find((s) => s.toLowerCase().startsWith("digest "));
  return digestHeader ?? null;
}

async function fetchWithTimeout(args: {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), args.timeoutMs);
  const onAbort = () => controller.abort();
  if (args.signal) {
    if (args.signal.aborted) controller.abort();
    else args.signal.addEventListener("abort", onAbort, { once: true });
  }
  try {
    return await fetch(args.url, {
      method: args.method,
      headers: args.headers,
      body: args.body,
      signal: controller.signal
    });
  } finally {
    clearTimeout(t);
    if (args.signal) {
      try {
        args.signal.removeEventListener("abort", onAbort);
      } catch {
        // ignore
      }
    }
  }
}
