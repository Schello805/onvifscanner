import { NextResponse } from "next/server";
import { fixPathPermissions, testStoragePath } from "@/lib/nvr/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { path } = body;

    if (!path || typeof path !== "string") {
      return NextResponse.json({ ok: false, error: "Pfad ist erforderlich." }, { status: 400 });
    }

    const fixResult = await fixPathPermissions(path.trim());
    if (!fixResult.ok) {
      return NextResponse.json({ ok: false, error: fixResult.error || fixResult.message }, { status: 400 });
    }

    // Verify by testing write immediately
    const testResult = await testStoragePath(path.trim(), false);

    return NextResponse.json({
      ok: testResult.writable,
      message: testResult.writable
        ? "Berechtigungen erfolgreich korrigiert. Der Ordner ist nun beschreibbar."
        : "Berechtigungen wurden angewendet, Schreibtest meldet aber weiterhin Fehler.",
      stats: testResult,
    });
  } catch (error: any) {
    console.error("API Error POST /api/nvr/storage/fix-permission", error);
    return NextResponse.json({ ok: false, error: error?.message || "Fehler beim Anpassen der Berechtigungen." }, { status: 500 });
  }
}
