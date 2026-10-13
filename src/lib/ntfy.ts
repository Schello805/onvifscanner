type NtfyMessage = {
  server?: string | null;
  topic?: string | null;
  title: string;
  message: string;
  priority?: "min" | "low" | "default" | "high" | "max";
  tags?: string;
};

export function normalizeNtfyServer(value?: string | null): string {
  const trimmed = (value || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "https://ntfy.sh";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export async function sendNtfyMessage(input: NtfyMessage): Promise<void> {
  const topic = (input.topic || "").trim();
  if (!topic) throw new Error("Kein ntfy-Topic konfiguriert.");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(`${normalizeNtfyServer(input.server)}/${encodeURIComponent(topic)}`, {
      method: "POST",
      body: input.message,
      headers: {
        Title: input.title,
        Priority: input.priority || "high",
        Tags: input.tags || "rotating_light,video_camera",
      },
      signal: controller.signal,
      cache: "no-store",
    });
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
