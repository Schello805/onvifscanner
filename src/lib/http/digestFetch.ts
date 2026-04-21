import { parseDigestChallenge, buildDigestAuthorizationHeader } from "@/lib/auth/digest";

export async function fetchWithDigestAuth(args: {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs: number;
  credentials?: { username: string; password: string };
}): Promise<Response> {
  // Preemptive Basic: many devices (e.g. vendor snapshot endpoints) accept Basic even when they
  // don't advertise it correctly. This also avoids an extra roundtrip in the common case.
  if (args.credentials) {
    const basic = Buffer.from(
      `${args.credentials.username}:${args.credentials.password}`,
      "utf8"
    ).toString("base64");
    const res0 = await fetchWithTimeout({
      url: args.url,
      method: args.method,
      headers: { ...(args.headers ?? {}), authorization: `Basic ${basic}` },
      body: args.body,
      timeoutMs: args.timeoutMs
    });
    if (res0.status !== 401) return res0;
    // Fall through: some devices require Digest and will respond with WWW-Authenticate.
  }

  const res1 = await fetchWithTimeout({
    url: args.url,
    method: args.method,
    headers: args.headers,
    body: args.body,
    timeoutMs: args.timeoutMs
  });
  if (res1.status !== 401 || !args.credentials) return res1;

  const www = res1.headers.get("www-authenticate");
  if (!www) return res1;

  if (/basic/i.test(www)) {
    const basic = Buffer.from(
      `${args.credentials.username}:${args.credentials.password}`,
      "utf8"
    ).toString("base64");
    return fetchWithTimeout({
      url: args.url,
      method: args.method,
      headers: { ...(args.headers ?? {}), authorization: `Basic ${basic}` },
      body: args.body,
      timeoutMs: args.timeoutMs
    });
  }

  // Some servers send multiple headers in one string.
  const digestHeader = www
    .split(/,(?=\s*Digest\s)/i)
    .map((s) => s.trim())
    .find((s) => s.toLowerCase().startsWith("digest "));
  if (!digestHeader) return res1;

  const challenge = parseDigestChallenge(digestHeader);
  if (!challenge) return res1;

  const uri = new URL(args.url).pathname + new URL(args.url).search;
  const authorization = buildDigestAuthorizationHeader({
    challenge,
    method: args.method,
    uri,
    username: args.credentials.username,
    password: args.credentials.password
  });

  return fetchWithTimeout({
    url: args.url,
    method: args.method,
    headers: { ...(args.headers ?? {}), authorization },
    body: args.body,
    timeoutMs: args.timeoutMs
  });
}

async function fetchWithTimeout(args: {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs: number;
}): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), args.timeoutMs);
  try {
    return await fetch(args.url, {
      method: args.method,
      headers: args.headers,
      body: args.body,
      signal: controller.signal
    });
  } finally {
    clearTimeout(t);
  }
}
