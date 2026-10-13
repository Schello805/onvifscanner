import { NextResponse } from "next/server";
import { sendNtfyMessage } from "@/lib/ntfy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    await sendNtfyMessage({
      server: body?.ntfyServer,
      topic: body?.ntfyTopic,
      title: "ONVIFscanner Test",
      message: "Die Push-Benachrichtigungen funktionieren.",
      priority: "default",
      tags: "white_check_mark,video_camera",
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Testnachricht konnte nicht gesendet werden.";
    console.error("ntfy test failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
