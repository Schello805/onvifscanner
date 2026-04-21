import crypto from "node:crypto";

export type DigestChallenge = {
  realm: string;
  nonce: string;
  qop?: string;
  opaque?: string;
  algorithm?: string;
};

export function parseDigestChallenge(header: string): DigestChallenge | null {
  const trimmed = header.trim();
  if (!trimmed.toLowerCase().startsWith("digest ")) return null;
  const params = trimmed.slice(7);
  const out: Record<string, string> = {};

  // Split on commas not inside quotes.
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < params.length; i += 1) {
    const ch = params[i];
    if (ch === '"') inQuotes = !inQuotes;
    if (ch === "," && !inQuotes) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);

  for (const part of parts) {
    const [k, ...rest] = part.split("=");
    const key = (k ?? "").trim();
    const raw = rest.join("=").trim();
    if (!key) continue;
    const value = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
    out[key] = value;
  }

  if (!out.realm || !out.nonce) return null;
  return {
    realm: out.realm,
    nonce: out.nonce,
    qop: out.qop,
    opaque: out.opaque,
    algorithm: out.algorithm
  };
}

export function buildDigestAuthorizationHeader(args: {
  challenge: DigestChallenge;
  method: string;
  uri: string;
  username: string;
  password: string;
  nc?: string;
  cnonce?: string;
  entityBody?: string;
}): string {
  const algorithmRaw = args.challenge.algorithm ?? "MD5";
  const algorithm = algorithmRaw.toUpperCase();
  if (algorithm !== "MD5" && algorithm !== "MD5-SESS") {
    throw new Error(`Digest algorithm not supported: ${algorithmRaw}`);
  }

  const qopOptions = args.challenge.qop
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const qop = qopOptions?.includes("auth")
    ? "auth"
    : qopOptions?.includes("auth-int")
      ? "auth-int"
      : undefined;
  const nc = args.nc ?? "00000001";
  const cnonce = args.cnonce ?? crypto.randomBytes(8).toString("hex");

  const ha1Base = md5(`${args.username}:${args.challenge.realm}:${args.password}`);
  const ha1 =
    algorithm === "MD5-SESS"
      ? md5(`${ha1Base}:${args.challenge.nonce}:${cnonce}`)
      : ha1Base;

  const ha2 =
    qop === "auth-int"
      ? md5(`${args.method}:${args.uri}:${md5(args.entityBody ?? "")}`)
      : md5(`${args.method}:${args.uri}`);

  const response = qop
    ? md5(`${ha1}:${args.challenge.nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : md5(`${ha1}:${args.challenge.nonce}:${ha2}`);

  const kv: string[] = [];
  kv.push(`username="${escapeQuotes(args.username)}"`);
  kv.push(`realm="${escapeQuotes(args.challenge.realm)}"`);
  kv.push(`nonce="${escapeQuotes(args.challenge.nonce)}"`);
  kv.push(`uri="${escapeQuotes(args.uri)}"`);
  kv.push(`response="${response}"`);
  // Some implementations are picky; only include algorithm if server provided it.
  if (args.challenge.algorithm) kv.push(`algorithm=${algorithmRaw}`);
  if (args.challenge.opaque) kv.push(`opaque="${escapeQuotes(args.challenge.opaque)}"`);
  if (qop) {
    kv.push(`qop=${qop}`);
    kv.push(`nc=${nc}`);
    kv.push(`cnonce="${cnonce}"`);
  }
  return `Digest ${kv.join(", ")}`;
}

function md5(input: string): string {
  return crypto.createHash("md5").update(input).digest("hex");
}

function escapeQuotes(input: string): string {
  return input.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
