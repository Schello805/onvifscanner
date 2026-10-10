import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
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

    // Parse event details
    let message = "Bewegung erkannt";
    if (rawBody.includes("linedetection")) {
      message = "Linienüberschreitung erkannt";
    } else if (rawBody.includes("shelteralarm") || rawBody.includes("tamper")) {
      message = "Sabotage / Abdeckung erkannt";
    } else if (rawBody.includes("fielddetection") || rawBody.includes("intrusion")) {
      message = "Bereichsübertritt erkannt";
    } else if (rawBody.includes("VMD") || rawBody.includes("motion") || rawBody.includes("Motion")) {
      message = "Bewegung erkannt (Hikvision/Webhook)";
    }

    if (matchedCamera) {
      // Anti-flood debounce: Don't log if there was an alarm for this camera in the last 4 seconds
      const recent = await prisma.alarmLog.findFirst({
        where: {
          cameraId: matchedCamera.id,
          timestamp: {
            gte: new Date(Date.now() - 4_000),
          },
        },
      });

      if (!recent) {
        await prisma.alarmLog.create({
          data: {
            cameraId: matchedCamera.id,
            message,
            timestamp: new Date(),
          },
        });
      }

      return NextResponse.json({
        ok: true,
        recorded: !recent,
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
    service: "ONVIFscanner Motion & Alarm Webhook",
    status: "active",
    instructions:
      "Send POST requests from Hikvision Alarm Server / Webhook with XML or JSON payload.",
  });
}
