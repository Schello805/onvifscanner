import crypto from "crypto";
import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const SECURITY_FILE = path.join(DATA_DIR, "security.json");
export const ENC_PREFIX = "enc:v1:";
export const MASKED_PASSWORD = "••••••••";
export const SESSION_COOKIE_NAME = "onvif_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export type SecurityConfig = {
  encryptionKey: string;
  sessionSecret: string;
  appPasswordSalt: string | null;
  appPasswordHash: string | null;
  webhookToken: string | null;
};

let cachedConfig: SecurityConfig | null = null;
let cachedMtimeMs = 0;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function loadSecurityConfig(): SecurityConfig {
  try {
    ensureDataDir();
    if (fs.existsSync(SECURITY_FILE)) {
      const stat = fs.statSync(SECURITY_FILE);
      if (cachedConfig && stat.mtimeMs === cachedMtimeMs) {
        return cachedConfig;
      }
      const raw = fs.readFileSync(SECURITY_FILE, "utf8");
      const parsed = JSON.parse(raw) as Partial<SecurityConfig>;
      if (parsed && typeof parsed === "object") {
        let changed = false;
        if (!parsed.encryptionKey || typeof parsed.encryptionKey !== "string" || parsed.encryptionKey.length !== 64) {
          parsed.encryptionKey = crypto.randomBytes(32).toString("hex");
          changed = true;
        }
        if (!parsed.sessionSecret || typeof parsed.sessionSecret !== "string" || parsed.sessionSecret.length < 32) {
          parsed.sessionSecret = crypto.randomBytes(32).toString("hex");
          changed = true;
        }
        const fullConfig: SecurityConfig = {
          encryptionKey: parsed.encryptionKey,
          sessionSecret: parsed.sessionSecret,
          appPasswordSalt: parsed.appPasswordSalt ?? null,
          appPasswordHash: parsed.appPasswordHash ?? null,
          webhookToken: parsed.webhookToken ?? null,
        };
        if (changed) {
          saveSecurityConfig(fullConfig);
        } else {
          cachedConfig = fullConfig;
          cachedMtimeMs = stat.mtimeMs;
        }
        return fullConfig;
      }
    }
  } catch (err) {
    console.warn("Could not read security.json, initializing defaults:", err);
  }

  const initial: SecurityConfig = {
    encryptionKey: crypto.randomBytes(32).toString("hex"),
    sessionSecret: crypto.randomBytes(32).toString("hex"),
    appPasswordSalt: null,
    appPasswordHash: null,
    webhookToken: null,
  };
  saveSecurityConfig(initial);
  return initial;
}

export function saveSecurityConfig(config: SecurityConfig): void {
  try {
    ensureDataDir();
    fs.writeFileSync(SECURITY_FILE, JSON.stringify(config, null, 2), { mode: 0o666 });
    try {
      fs.chmodSync(SECURITY_FILE, 0o666);
    } catch {}
    const stat = fs.statSync(SECURITY_FILE);
    cachedConfig = config;
    cachedMtimeMs = stat.mtimeMs;
  } catch (err) {
    console.error("Failed to write security.json:", err);
    cachedConfig = config;
  }
}

function getKeyBuffer(): Buffer {
  const envKey = process.env.SECRET_KEY;
  if (envKey && envKey.trim().length >= 16) {
    return crypto.createHash("sha256").update(envKey.trim()).digest();
  }
  const cfg = loadSecurityConfig();
  return Buffer.from(cfg.encryptionKey, "hex");
}

export function encryptSecret(plaintext: string | null | undefined): string | null {
  if (plaintext === null || plaintext === undefined) return null;
  const str = String(plaintext);
  if (!str) return "";
  if (str.startsWith(ENC_PREFIX)) return str;

  try {
    const key = getKeyBuffer();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(str, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${ENC_PREFIX}${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
  } catch {
    return str;
  }
}

export function decryptSecret(stored: string | null | undefined): string {
  if (stored === null || stored === undefined) return "";
  const str = String(stored);
  if (!str) return "";
  if (!str.startsWith(ENC_PREFIX)) return str;

  try {
    const parts = str.slice(ENC_PREFIX.length).split(":");
    if (parts.length !== 3) return "";
    const [ivHex, tagHex, cipherHex] = parts;
    const key = getKeyBuffer();
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(cipherHex, "hex")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch {
    return "";
  }
}

function hashPassword(password: string, salt?: string): { salt: string; hash: string } {
  const effectiveSalt = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), effectiveSalt, 64).toString("hex");
  return { salt: effectiveSalt, hash };
}

export function isAppAuthEnabled(): boolean {
  if (process.env.APP_PASSWORD && process.env.APP_PASSWORD.trim().length > 0) {
    return true;
  }
  const cfg = loadSecurityConfig();
  return Boolean(cfg.appPasswordHash && cfg.appPasswordSalt);
}

export function verifyAppPassword(candidate: string): boolean {
  const raw = String(candidate ?? "");
  const trimmed = raw.trim();
  if (!raw && !trimmed) return false;

  const envPass = process.env.APP_PASSWORD?.trim();
  if (envPass) {
    if (raw === envPass || trimmed === envPass) {
      return true;
    }
  }

  const cfg = loadSecurityConfig();
  if (!cfg.appPasswordHash || !cfg.appPasswordSalt) return false;

  for (const candidateStr of [trimmed, raw]) {
    if (!candidateStr) continue;
    const { hash } = hashPassword(candidateStr, cfg.appPasswordSalt);
    const a = Buffer.from(hash, "hex");
    const b = Buffer.from(cfg.appPasswordHash, "hex");
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      return true;
    }
  }
  return false;
}

export function setAppPassword(newPassword: string | null | undefined): void {
  const cfg = loadSecurityConfig();
  const trimmed = String(newPassword || "").trim();
  if (!trimmed) {
    cfg.appPasswordSalt = null;
    cfg.appPasswordHash = null;
    cfg.sessionSecret = crypto.randomBytes(32).toString("hex");
    saveSecurityConfig(cfg);
    return;
  }
  const { salt, hash } = hashPassword(trimmed);
  cfg.appPasswordSalt = salt;
  cfg.appPasswordHash = hash;
  cfg.sessionSecret = crypto.randomBytes(32).toString("hex");
  saveSecurityConfig(cfg);
}

export function getWebhookToken(): string | null {
  if (process.env.WEBHOOK_SECRET && process.env.WEBHOOK_SECRET.trim()) {
    return process.env.WEBHOOK_SECRET.trim();
  }
  const cfg = loadSecurityConfig();
  return cfg.webhookToken || null;
}

export function setWebhookToken(token: string | null | undefined): void {
  const cfg = loadSecurityConfig();
  const trimmed = String(token || "").trim();
  cfg.webhookToken = trimmed || null;
  saveSecurityConfig(cfg);
}

export function createSessionToken(): string {
  const cfg = loadSecurityConfig();
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const nonce = crypto.randomBytes(12).toString("hex");
  const payload = `${expiresAt}.${nonce}`;
  const sig = crypto
    .createHmac("sha256", cfg.sessionSecret)
    .update(payload)
    .digest("hex");
  return `${payload}.${sig}`;
}

export function verifySessionToken(token: string | null | undefined): boolean {
  if (!isAppAuthEnabled()) return true;
  if (!token || typeof token !== "string") return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [expiresStr, nonce, sig] = parts;
  const expiresAt = Number(expiresStr);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return false;

  const cfg = loadSecurityConfig();
  const payload = `${expiresStr}.${nonce}`;
  const expectedSig = crypto
    .createHmac("sha256", cfg.sessionSecret)
    .update(payload)
    .digest("hex");

  try {
    const a = Buffer.from(sig, "hex");
    const b = Buffer.from(expectedSig, "hex");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function parseCookies(cookieHeader: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader || typeof cookieHeader !== "string") return out;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function isRequestAuthenticated(req: Request): boolean {
  if (!isAppAuthEnabled()) return true;
  const cookies = parseCookies(req.headers.get("cookie"));
  return verifySessionToken(cookies[SESSION_COOKIE_NAME]);
}
