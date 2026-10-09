import { NextResponse } from "next/server";
import { discoverSystemVolumes } from "@/lib/nvr/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const volumes = await discoverSystemVolumes();
    return NextResponse.json({ volumes });
  } catch (error: any) {
    console.error("GET /api/nvr/storage/discover error:", error);
    return NextResponse.json(
      { error: error?.message || "Fehler beim Erkennen von Systemlaufwerken." },
      { status: 500 }
    );
  }
}
