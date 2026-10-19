import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SNAPSHOTS_DIR = path.join(process.cwd(), "data", "snapshots");

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const rawId = params?.id || "";
    const safeId = rawId.replace(/[^a-zA-Z0-9_\-]/g, "");
    if (!safeId) {
      return new NextResponse("Ungültige Snapshot-ID", { status: 400 });
    }

    const filePath = path.join(SNAPSHOTS_DIR, `${safeId}.jpg`);
    if (!fs.existsSync(filePath)) {
      return new NextResponse("Snapshot nicht gefunden", { status: 404 });
    }

    const fileBuffer = await fs.promises.readFile(filePath);
    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, max-age=86400, stale-while-revalidate=3600",
      },
    });
  } catch {
    return new NextResponse("Fehler beim Laden des Snapshots", { status: 500 });
  }
}
