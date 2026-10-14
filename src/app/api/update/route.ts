import { NextResponse } from "next/server";
import { execFile, spawn } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);

export async function POST() {
  try {
    const helperPath = "/usr/local/bin/onvifscanner-update-helper";
    const isSystemInstallation = fs.existsSync("/etc/systemd/system/onvifscanner.service")
      || fs.existsSync(helperPath);

    if (isSystemInstallation) {
      if (!fs.existsSync(helperPath)) {
        return NextResponse.json({
          success: false,
          needsBootstrap: true,
          error: "Der 1-Klick-Updater ist noch nicht installiert. Bitte dieses Update einmalig über den angezeigten Terminal-Befehl installieren.",
        }, { status: 503 });
      }

      try {
        const { stdout } = await execFileAsync("sudo", ["-n", helperPath], {
          timeout: 10_000,
          maxBuffer: 64 * 1024,
        });
        let helperResult: Record<string, unknown> = {};
        try { helperResult = JSON.parse(stdout.trim()); } catch {}
        return NextResponse.json({
          success: true,
          message: helperResult.message || "Update gestartet. App wird in Kürze neu geladen.",
          alreadyRunning: Boolean(helperResult.alreadyRunning),
        }, { headers: { "cache-control": "no-store" } });
      } catch (error) {
        const detail = error && typeof error === "object" && "stderr" in error
          ? String(error.stderr).trim()
          : "";
        return NextResponse.json({
          success: false,
          error: detail || "Der Update-Dienst konnte nicht gestartet werden.",
        }, { status: 500 });
      }
    }

    const scriptPath = path.join(process.cwd(), "scripts", "update.sh");
    
    const child = spawn("bash", [scriptPath], {
      detached: true,
      stdio: "ignore",
      cwd: process.cwd()
    });

    child.unref();

    return NextResponse.json(
      { success: true, message: "Update gestartet. App wird in Kürze neu geladen." },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Update fehlgeschlagen" },
      { status: 500 }
    );
  }
}
