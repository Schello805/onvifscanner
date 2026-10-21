// Canonical security implementation shared with backend scripts
const sec = require("../../../scripts/security");

export const ENC_PREFIX: string = sec.ENC_PREFIX;
export const MASKED_PASSWORD: string = sec.MASKED_PASSWORD;
export const SESSION_COOKIE_NAME: string = sec.SESSION_COOKIE_NAME;
export const SESSION_TTL_MS: number = sec.SESSION_TTL_MS;

export type SecurityConfig = {
  encryptionKey: string;
  sessionSecret: string;
  appPasswordSalt: string | null;
  appPasswordHash: string | null;
  webhookToken: string | null;
};

export const loadSecurityConfig: () => SecurityConfig = sec.loadSecurityConfig;
export const saveSecurityConfig: (config: SecurityConfig) => void = sec.saveSecurityConfig;
export const encryptSecret: (plainText?: string | null) => string | null = sec.encryptSecret;
export const decryptSecret: (cipherText?: string | null) => string = sec.decryptSecret;
export const maskSecret: (value?: string | null) => string = sec.maskSecret;
export const hashPassword: (password: string, explicitSalt?: string | null) => { salt: string; hash: string } = sec.hashPassword;
export const verifyPassword: (candidate?: string | null) => boolean = sec.verifyPassword;
export const verifyAppPassword: (candidate?: string | null) => boolean = sec.verifyPassword;
export const isAppAuthEnabled: () => boolean = sec.isAppAuthEnabled;
export const setAppPassword: (newPassword?: string | null) => void = sec.setAppPassword;
export const removeAppPassword: () => void = sec.removeAppPassword;
export const rotateSessionSecret: () => void = sec.rotateSessionSecret;
export const getWebhookToken: () => string | null = sec.getWebhookToken;
export const setWebhookToken: (token: string | null | undefined) => void = sec.setWebhookToken;
export const createSessionToken: () => string = sec.createSessionToken;
export const verifySessionToken: (token: string | null | undefined) => boolean = sec.verifySessionToken;
export const parseCookies: (cookieHeader: string | null | undefined) => Record<string, string> = sec.parseCookies;
export const getInternalWorkerToken: () => string = sec.getInternalWorkerToken;
export const verifyInternalWorkerToken: (token: string | null | undefined) => boolean = sec.verifyInternalWorkerToken;

export function isRequestAuthenticated(req: Request): boolean {
  if (!isAppAuthEnabled()) return true;
  const cookies = parseCookies(req.headers.get("cookie"));
  return verifySessionToken(cookies[SESSION_COOKIE_NAME]);
}
