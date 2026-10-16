type NtfyMessage = {
  server?: string | null;
  topic?: string | null;
  title: string;
  message: string;
  priority?: "min" | "low" | "default" | "high" | "max";
  tags?: string;
  attachment?: {
    data: Uint8Array;
    contentType?: string;
    filename?: string;
  };
};

function encodeHeaderValue(value: string): string {
  return /^[\x20-\x7e]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`;
}

export function normalizeNtfyServer(value?: string | null): string {
  const trimmed = (value || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "https://ntfy.sh";
  const raw = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Ungültige ntfy-Server-URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Nur http:// oder https:// sind für ntfy erlaubt.");
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host === "[::1]" ||
    host.startsWith("127.") ||
    host.startsWith("169.254.")
  ) {
    throw new Error("Lokale Loopback-Adressen sind als ntfy-Server nicht erlaubt.");
  }
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
}

export async function sendNtfyMessage(input: NtfyMessage): Promise<void> {
  const topic = (input.topic || "").trim();
  if (!topic) throw new Error("Kein ntfy-Topic konfiguriert.");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const attachment = input.attachment?.data?.byteLength ? input.attachment : null;
    const headers: Record<string, string> = {
      Title: encodeHeaderValue(input.title),
      Priority: input.priority || "high",
      Tags: input.tags || "rotating_light,video_camera",
    };
    if (attachment) {
      headers.Message = encodeHeaderValue(input.message);
      headers.Filename = attachment.filename || "kamera.jpg";
      headers["Content-Type"] = attachment.contentType || "image/jpeg";
    }
    const publishUrl = `${normalizeNtfyServer(input.server)}/${encodeURIComponent(topic)}`;
    let response = await fetch(publishUrl, {
      method: "POST",
      body: attachment ? Buffer.from(attachment.data) : input.message,
      headers,
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok && attachment) {
      response = await fetch(publishUrl, {
        method: "POST",
        body: input.message,
        headers: {
          Title: encodeHeaderValue(input.title),
          Priority: input.priority || "high",
          Tags: input.tags || "rotating_light,video_camera",
        },
        signal: controller.signal,
        cache: "no-store",
      });
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).trim().slice(0, 240);
      throw new Error(`ntfy antwortet mit HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("ntfy-Zeitüberschreitung nach 8 Sekunden.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
