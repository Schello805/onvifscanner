export type TelegramAttachment = {
  data: Uint8Array;
  contentType?: string;
  filename?: string;
};

export type TelegramMessageInput = {
  botToken: string;
  chatId: string;
  text: string;
  caption?: string;
  parseMode?: "HTML" | "Markdown" | "MarkdownV2";
  attachment?: TelegramAttachment | null;
};

export function cleanTelegramToken(token?: string | null): string {
  return String(token || "").trim();
}

export function cleanTelegramChatId(chatId?: string | null): string {
  return String(chatId || "").trim();
}

export async function sendTelegramMessage(input: TelegramMessageInput): Promise<void> {
  const botToken = cleanTelegramToken(input.botToken);
  const chatId = cleanTelegramChatId(input.chatId);

  if (!botToken) {
    throw new Error("Telegram Bot-Token fehlt.");
  }
  if (!chatId) {
    throw new Error("Telegram Chat-ID fehlt.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    const attachment = input.attachment?.data?.byteLength ? input.attachment : null;

    if (attachment) {
      try {
        const formData = new FormData();
        formData.append("chat_id", chatId);
        formData.append("caption", input.caption || input.text);
        if (input.parseMode) {
          formData.append("parse_mode", input.parseMode);
        }

        const blob = new Blob([Buffer.from(attachment.data)], {
          type: attachment.contentType || "image/jpeg",
        });
        formData.append("photo", blob, attachment.filename || "kamera.jpg");

        const photoRes = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
          method: "POST",
          body: formData,
          signal: controller.signal,
          cache: "no-store",
        });

        if (photoRes.ok) {
          return;
        }

        const errorData = await photoRes.json().catch(() => null);
        console.warn(
          `Telegram sendPhoto failed (${photoRes.status}: ${errorData?.description || "unknown"}), falling back to sendMessage...`
        );
      } catch (photoErr) {
        if (photoErr instanceof Error && photoErr.name === "AbortError") {
          throw new Error("Telegram-Zeitüberschreitung nach 8 Sekunden.");
        }
        console.warn("Telegram sendPhoto exception, falling back to sendMessage:", photoErr);
      }
    }

    // Text fallback or text-only message
    const msgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: input.text,
        parse_mode: input.parseMode,
      }),
      signal: controller.signal,
      cache: "no-store",
    });

    if (!msgRes.ok) {
      const errorData = await msgRes.json().catch(() => null);
      throw new Error(
        `Telegram Fehler (${msgRes.status}): ${errorData?.description || "Unbekannter Fehler"}`
      );
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Telegram-Zeitüberschreitung nach 8 Sekunden.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
