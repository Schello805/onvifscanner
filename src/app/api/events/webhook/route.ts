import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendNtfyMessage } from "@/lib/ntfy";
import { sendTelegramMessage } from "@/lib/telegram";
import { decryptSecret, getWebhookToken } from "@/lib/security";
import {
  motionCooldownSeconds,
  motionMonitoringRequested,
  requiresServerMotionValidation,
} from "@/lib/motionPolicy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function classifyAlarmPayload(rawBody: string): string | null {
  const payload = rawBody.toLowerCase();
  if (payload.includes("linedetection")) return "Linienüberschreitung erkannt";
  if (payload.includes("shelteralarm") || payload.includes("tamper")) return "Sabotage / Abdeckung erkannt";
  if (payload.includes("fielddetection") || payload.includes("intrusion")) return "Bereichsübertritt erkannt";
  if (payload.includes("vmd") || payload.includes("motion")) return "Bewegung erkannt (Hikvision/Webhook)";
  return null;
}

function payloadIsExplicitlyInactive(rawBody: string): boolean {
  return /<\s*(?:[a-z0-9_-]+:)?eventstate\s*>\s*(?:inactive|false|0)\s*<\//i.test(rawBody)
    || /["']eventstate["']\s*:\s*["']?(?:inactive|false|0)/i.test(rawBody);
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const configuredToken = getWebhookToken();
    if (configuredToken) {
      const queryToken = url.searchParams.get("token")?.trim();
      const headerToken = req.headers.get("x-webhook-token")?.trim();
      const authHeader = req.headers.get("authorization") || "";
      const bearerToken = authHeader.toLowerCase().startsWith("bearer ")
        ? authHeader.slice(7).trim()
        : "";
      const provided = queryToken || headerToken || bearerToken;
      if (provided !== configuredToken) {
        return NextResponse.json(
          { ok: false, error: "Ungültiger oder fehlender Webhook-Token." },
          { status: 401 }
        );
      }
    }

    const queryCameraId = url.searchParams.get("cameraId");
    const queryIp = url.searchParams.get("ip");

    // Extract client IP
    const forwardedFor = req.headers.get("x-forwarded-for");
    const realIp = req.headers.get("x-real-ip");
    const clientIp = (forwardedFor ? forwardedFor.split(",")[0].trim() : realIp || "").trim();

    const contentType = req.headers.get("content-type") || "";
    let rawBody = "";
    try {
      rawBody = await req.text();
    } catch {
      // body empty or unreadable
    }

    // Try finding the matching camera
    let matchedCamera = null;

    if (queryCameraId) {
      matchedCamera = await prisma.camera.findUnique({
        where: { id: queryCameraId },
      });
    }

    if (!matchedCamera && queryIp) {
      matchedCamera = await prisma.camera.findFirst({
        where: { ip: queryIp },
      });
    }

    if (!matchedCamera && clientIp) {
      matchedCamera = await prisma.camera.findFirst({
        where: { ip: clientIp },
      });
    }

    // Fallback: check if the body contains any camera IP
    if (!matchedCamera && rawBody) {
      const ipMatch = rawBody.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
      if (ipMatch) {
        matchedCamera = await prisma.camera.findFirst({
          where: { ip: ipMatch[0] },
        });
      }
    }

    const message = classifyAlarmPayload(rawBody);

    if (matchedCamera) {
      if (!message || payloadIsExplicitlyInactive(rawBody)) {
        return NextResponse.json({
          ok: true,
          recorded: false,
          cameraId: matchedCamera.id,
          cameraName: matchedCamera.name,
          note: !message ? "Kein unterstütztes Bewegungsereignis erkannt." : "Inaktives/abgeschlossenes Kamera-Ereignis ignoriert.",
        });
      }
      if (!motionMonitoringRequested(matchedCamera)) {
        return NextResponse.json({
          ok: true,
          recorded: false,
          cameraId: matchedCamera.id,
          cameraName: matchedCamera.name,
          note: "Bewegungsüberwachung und Benachrichtigungen sind für diese Kamera deaktiviert.",
        });
      }
      if (requiresServerMotionValidation(matchedCamera)) {
        return NextResponse.json({
          ok: true,
          recorded: false,
          cameraId: matchedCamera.id,
          cameraName: matchedCamera.name,
          note: "Kamera-Ereignis ignoriert; Maske, Objekt- oder Kennzeichenfilter werden durch die Server-Bildanalyse ausgewertet.",
        });
      }
      const eventTime = new Date();
      await prisma.camera.update({
        where: { id: matchedCamera.id },
        data: {
          motionEventState: "active",
          motionEventSource: "webhook",
          motionEventLastSeen: eventTime,
          motionEventCheckedAt: eventTime,
          motionEventLastError: null,
        },
      });
      // Anti-flood debounce: Don't log if there was an alarm for this camera in the configured cooldown period
      const cooldownSec = motionCooldownSeconds(matchedCamera);
      const recent = await prisma.alarmLog.findFirst({
        where: {
          cameraId: matchedCamera.id,
          timestamp: {
            gte: new Date(Date.now() - cooldownSec * 1000),
          },
        },
      });

      if (!recent) {
        await prisma.alarmLog.create({
          data: {
            cameraId: matchedCamera.id,
            message,
            timestamp: eventTime,
          },
        });

        if (matchedCamera.notificationsEnabled) {
          try {
            const settings = await prisma.settings.findUnique({ where: { id: "default" } });
            let attachment: { data: Uint8Array; contentType: string; filename: string } | undefined;
            try {
              const snapshotUris = JSON.parse(matchedCamera.snapshotUris || "[]");
              const streamUris = JSON.parse(matchedCamera.streamUris || "[]");
              const imageResponse = await fetch(`http://127.0.0.1:${process.env.PORT || "3000"}/api/thumbnail`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  cameraId: matchedCamera.id,
                  urls: [...snapshotUris, ...streamUris],
                  size: 480,
                  timeoutMs: 3_000,
                  fastAuth: true,
                  fresh: true,
                  credentials: matchedCamera.username
                    ? { username: matchedCamera.username, password: decryptSecret(matchedCamera.password) }
                    : undefined,
                }),
                signal: AbortSignal.timeout(5_000),
              });
              const imageContentType = imageResponse.headers.get("content-type") || "";
              if (imageResponse.ok && imageContentType.toLowerCase().startsWith("image/")) {
                attachment = {
                  data: new Uint8Array(await imageResponse.arrayBuffer()),
                  contentType: imageContentType,
                  filename: `kamera-${matchedCamera.ip}-${Date.now()}.jpg`,
                };
              }
            } catch {}
            if (settings?.ntfyTopic?.trim()) {
              try {
                await sendNtfyMessage({
                  server: settings?.ntfyServer,
                  topic: settings?.ntfyTopic,
                  title: "ONVIFscanner NVR Alarm",
                  message: `Kamera: ${matchedCamera.name}\nEreignis: ${message}`,
                  attachment,
                });
              } catch (pushErr) {
                console.error(`ntfy notification for ${matchedCamera.name} failed:`, pushErr);
              }
            }

            if (settings?.telegramBotToken?.trim() && settings?.telegramChatId?.trim() && settings?.telegramEnabled !== false) {
              try {
                await sendTelegramMessage({
                  botToken: settings.telegramBotToken,
                  chatId: settings.telegramChatId,
                  text: `🚨 <b>ONVIFscanner Alarm</b>\nKamera: <b>${matchedCamera.name}</b>\nEreignis: ${message}`,
                  caption: `🚨 <b>ONVIFscanner Alarm</b>\nKamera: <b>${matchedCamera.name}</b>\nEreignis: ${message}`,
                  parseMode: "HTML",
                  attachment,
                });
              } catch (tgErr) {
                console.error(`telegram notification for ${matchedCamera.name} failed:`, tgErr);
              }
            }
          } catch (pushErr) {
            console.error(`notification processing for ${matchedCamera.name} failed:`, pushErr);
          }
        }
      }

      return NextResponse.json({
        ok: true,
        recorded: !recent,
        cooldownSeconds: cooldownSec,
        cameraId: matchedCamera.id,
        cameraName: matchedCamera.name,
      });
    }

    // If no camera matched, acknowledge anyway so Hikvision doesn't retry infinitely
    return NextResponse.json({
      ok: true,
      recorded: false,
      note: `Keine passende Kamera für IP ${clientIp || "unbekannt"} gefunden`,
    });
  } catch (err) {
    console.error("Webhook processing error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}

// Support GET for testing and pinging
export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "ONVIFscanner NVR Motion & Alarm Webhook",
    status: "active",
    instructions:
      "Send POST requests from Hikvision Alarm Server / Webhook with XML or JSON payload.",
  });
}
