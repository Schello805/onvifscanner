import { NextResponse } from "next/server";
import {
  createSessionToken,
  isAppAuthEnabled,
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  verifyAppPassword,
} from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const failedAttempts = new Map<string, { count: number; resetAt: number }>();

function getClientKey(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "local";
}

export async function POST(req: Request) {
  try {
    const clientKey = getClientKey(req);
    const now = Date.now();
    const record = failedAttempts.get(clientKey);
    if (record && record.resetAt > now && record.count >= 8) {
      return NextResponse.json(
        { error: "Zu viele Fehlversuche. Bitte 1 Minute warten." },
        { status: 429 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as { password?: string };
    const password = String(body.password ?? "");

    if (!isAppAuthEnabled()) {
      return NextResponse.json({ ok: true, authenticated: true });
    }

    if (!verifyAppPassword(password)) {
      const current = failedAttempts.get(clientKey);
      if (!current || current.resetAt <= now) {
        failedAttempts.set(clientKey, { count: 1, resetAt: now + 60_000 });
      } else {
        current.count += 1;
      }
      return NextResponse.json(
        { error: "Falsches Passwort oder PIN." },
        { status: 401 }
      );
    }

    failedAttempts.delete(clientKey);
    const token = createSessionToken();
    const res = NextResponse.json({ ok: true, authenticated: true });
    res.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: token,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
    });
    return res;
  } catch {
    return NextResponse.json({ error: "Anmeldung fehlgeschlagen." }, { status: 500 });
  }
}
