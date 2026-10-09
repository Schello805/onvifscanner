import { NextResponse } from "next/server";
import { testStoragePath } from "@/lib/nvr/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const rawPath = String(body.path || "").trim();
    const autoCreate = Boolean(body.autoCreate);

    if (!rawPath) {
      return NextResponse.json({ error: "Pfad darf nicht leer sein." }, { status: 400 });
    }

    const result = await testStoragePath(rawPath, autoCreate);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("POST /api/nvr/storage/test error:", error);
    return NextResponse.json({ error: error?.message || "Fehler beim Testen des Pfades." }, { status: 500 });
  }
}
