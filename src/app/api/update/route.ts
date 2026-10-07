import { NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";

export const runtime = "nodejs";

export async function POST() {
  try {
    const scriptPath = path.join(process.cwd(), "scripts", "update.sh");
    
    // Wir starten das Update-Skript im Hintergrund (detached)
    const child = spawn("bash", [scriptPath], {
      detached: true,
      stdio: "ignore",
      cwd: process.cwd()
    });

    child.unref();

    return NextResponse.json({ success: true, message: "Update gestartet. App wird in Kürze neu geladen." });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Update fehlgeschlagen" },
      { status: 500 }
    );
  }
}
