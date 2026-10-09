import { NextResponse } from "next/server";
import { runStorageRetention } from "@/lib/nvr/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const targetId = body?.targetId ? String(body.targetId) : undefined;

    const results = await runStorageRetention(targetId);
    return NextResponse.json({
      ok: true,
      results,
      message: "Speicherbereinigung erfolgreich durchgeführt.",
    });
  } catch (error: any) {
    console.error("POST /api/nvr/storage/cleanup error:", error);
    return NextResponse.json(
      { error: error?.message || "Fehler bei der Speicherbereinigung." },
      { status: 500 }
    );
  }
}
