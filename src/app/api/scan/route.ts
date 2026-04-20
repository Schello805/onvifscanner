import { NextResponse } from "next/server";
import { runScan } from "@/lib/scan/runScan";
import { parseScanRequest } from "@/lib/scan/validation";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = parseScanRequest(body);
    const result = await runScan(parsed);
    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unbekannter Fehler";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

