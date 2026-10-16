import { NextResponse } from "next/server";
import { sendNtfyMessage } from "@/lib/ntfy";
import { sendTelegramMessage } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const provider = body?.provider || (body?.telegramBotToken ? "telegram" : "ntfy");

    if (provider === "telegram") {
      const botToken = String(body?.telegramBotToken || "").trim();
      const chatId = String(body?.telegramChatId || "").trim();
      if (!botToken || !chatId) {
        return NextResponse.json(
          { ok: false, error: "Bitte gib sowohl den Telegram Bot-Token als auch die Chat-ID an." },
          { status: 400 }
        );
      }

      await sendTelegramMessage({
        botToken,
        chatId,
        text: "✅ <b>ONVIFscanner NVR Test</b>\nDie Telegram-Benachrichtigungen funktionieren einwandfrei!",
        parseMode: "HTML",
      });

      return NextResponse.json({ ok: true, provider: "telegram" });
    }

    // Default to ntfy
    const topic = String(body?.ntfyTopic || "").trim();
    if (!topic) {
      return NextResponse.json(
        { ok: false, error: "Bitte gib ein ntfy-Topic an." },
        { status: 400 }
      );
    }

    await sendNtfyMessage({
      server: body?.ntfyServer,
      topic,
      title: "ONVIFscanner NVR Test",
      message: "Die Push-Benachrichtigungen funktionieren einwandfrei.",
      priority: "default",
      tags: "white_check_mark,video_camera",
    });

    return NextResponse.json({ ok: true, provider: "ntfy" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Testnachricht konnte nicht gesendet werden.";
    console.error("Notification test failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
