import { NextResponse } from "next/server";
import {
  isAppAuthEnabled,
  isRequestAuthenticated,
} from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const authEnabled = isAppAuthEnabled();
  const authenticated = isRequestAuthenticated(req);
  const envLocked = Boolean(process.env.APP_PASSWORD && process.env.APP_PASSWORD.trim().length > 0);
  return NextResponse.json({
    authEnabled,
    authenticated,
    envLocked,
  });
}
