import { NextResponse } from "next/server";
import { runStorageRetention, getLastRetentionStatus } from "@/lib/nvr/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const status = await getLastRetentionStatus();
    return NextResponse.json({
      ok: true,
      status,
    });
  } catch (error: any) {
    console.error("GET /api/nvr/storage/cleanup error:", error);
    return NextResponse.json(
      { error: error?.message || "Fehler beim Abrufen des Bereinigungs-Status." },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const targetId = body?.targetId ? String(body.targetId) : undefined;

    const results = await runStorageRetention(targetId);
    const status = await getLastRetentionStatus();
    return NextResponse.json({
      ok: true,
      results,
      status,
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
