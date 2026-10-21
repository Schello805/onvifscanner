import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  createSessionToken,
  getWebhookToken,
  isAppAuthEnabled,
  isRequestAuthenticated,
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  setAppPassword,
  setWebhookToken,
  encryptSecret,
  maskSecret,
} from "@/lib/security";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    if (!isRequestAuthenticated(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let settings = await prisma.settings.findUnique({
      where: { id: "default" },
    });

    if (!settings) {
      settings = await prisma.settings.create({
        data: { id: "default" },
      });
    }

    return NextResponse.json({
      ...settings,
      offsiteBackupPassword: settings.offsiteBackupPassword ? maskSecret(settings.offsiteBackupPassword) : null,
      authEnabled: isAppAuthEnabled(),
      envAuthLocked: Boolean(process.env.APP_PASSWORD && process.env.APP_PASSWORD.trim().length > 0),
      webhookToken: getWebhookToken() || "",
    });
  } catch (error) {
    console.error("Failed to load settings:", error);
    return NextResponse.json({ error: "Failed to load settings" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    if (!isRequestAuthenticated(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();

    // Only update fields that exist in schema
    const updateData: any = {};
    if (body.ntfyTopic !== undefined) updateData.ntfyTopic = body.ntfyTopic || null;
    if (body.ntfyServer !== undefined) updateData.ntfyServer = body.ntfyServer || null;
    if (body.ntfyCameraStatusEnabled !== undefined) updateData.ntfyCameraStatusEnabled = Boolean(body.ntfyCameraStatusEnabled);
    if (body.telegramBotToken !== undefined) updateData.telegramBotToken = body.telegramBotToken || null;
    if (body.telegramChatId !== undefined) updateData.telegramChatId = body.telegramChatId || null;
    if (body.telegramEnabled !== undefined) updateData.telegramEnabled = Boolean(body.telegramEnabled);
    if (body.telegramCameraStatusEnabled !== undefined) updateData.telegramCameraStatusEnabled = Boolean(body.telegramCameraStatusEnabled);
    if (body.columns !== undefined) updateData.columns = body.columns;
    if (body.autoCleanup !== undefined) updateData.autoCleanup = body.autoCleanup;
    if (body.timezone !== undefined) {
      updateData.timezone = String(body.timezone || "Europe/Berlin").trim();
      process.env.TZ = updateData.timezone;
    }
    if (body.motionMinAreaPercent !== undefined) {
      updateData.motionMinAreaPercent = body.motionMinAreaPercent !== null && body.motionMinAreaPercent !== ""
        ? Math.max(0.1, Math.min(50, Number(body.motionMinAreaPercent) || 1.5))
        : 1.5;
    }
    if (body.motionPixelThreshold !== undefined) {
      updateData.motionPixelThreshold = body.motionPixelThreshold !== null && body.motionPixelThreshold !== ""
        ? Math.max(8, Math.min(80, Math.round(Number(body.motionPixelThreshold) || 18)))
        : 18;
    }
    if (body.offsiteBackupEnabled !== undefined) updateData.offsiteBackupEnabled = Boolean(body.offsiteBackupEnabled);
    if (body.offsiteBackupUrl !== undefined) updateData.offsiteBackupUrl = body.offsiteBackupUrl ? String(body.offsiteBackupUrl).trim() : null;
    if (body.offsiteBackupUsername !== undefined) updateData.offsiteBackupUsername = body.offsiteBackupUsername ? String(body.offsiteBackupUsername).trim() : null;
    if (body.offsiteBackupPassword !== undefined && body.offsiteBackupPassword !== "••••••••") {
      updateData.offsiteBackupPassword = body.offsiteBackupPassword ? encryptSecret(String(body.offsiteBackupPassword).trim()) : null;
    }

    const settings = await prisma.settings.upsert({
      where: { id: "default" },
      update: updateData,
      create: { id: "default", ...updateData },
    });

    let issueNewSession = false;
    if (body.disableAppPassword === true) {
      setAppPassword(null);
    } else if (typeof body.newAppPassword === "string" && body.newAppPassword.trim().length > 0) {
      setAppPassword(body.newAppPassword.trim());
      issueNewSession = true;
    }

    if (body.webhookToken !== undefined) {
      setWebhookToken(typeof body.webhookToken === "string" ? body.webhookToken : null);
    }

    const res = NextResponse.json({
      ...settings,
      authEnabled: isAppAuthEnabled(),
      webhookToken: getWebhookToken() || "",
    });

    if (issueNewSession) {
      const token = createSessionToken();
      res.cookies.set({
        name: SESSION_COOKIE_NAME,
        value: token,
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: Math.floor(SESSION_TTL_MS / 1000),
      });
    }

    return res;
  } catch (error) {
    console.error("Failed to update settings:", error);
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}
