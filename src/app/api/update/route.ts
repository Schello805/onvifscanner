import { NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";

export const runtime = "nodejs";

export async function POST() {
  try {
    // Prevent self-destruction in systemd/LXC environments if not root
    if (
      fs.existsSync("/etc/systemd/system/onvifscanner.service") &&
      process.cwd() === "/opt/onvifscanner" &&
      process.getuid && process.getuid() !== 0
    ) {
      return NextResponse.json(
        { success: false, error: "System-Installation erkannt. Update muss im Terminal als root ausgeführt werden." },
        { status: 403 }
      );
    }

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
