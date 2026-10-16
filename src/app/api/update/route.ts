import { NextResponse } from "next/server";
import { execFile, spawn } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);

export async function POST(req: Request) {
  try {
    let targetVersion = "";
    try {
      const body = await req.json();
      if (typeof body?.targetVersion === "string") {
        targetVersion = body.targetVersion.trim();
      }
    } catch {
      // Body may be empty on plain POST
    }

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
        const sudoArgs = ["-n", helperPath];
        if (targetVersion) {
          sudoArgs.push(targetVersion);
        }
        const { stdout } = await execFileAsync("sudo", sudoArgs, {
          timeout: 10_000,
          maxBuffer: 64 * 1024,
        });
        let helperResult: Record<string, unknown> = {};
        try { helperResult = JSON.parse(stdout.trim()); } catch {}
        return NextResponse.json({
          success: true,
          message: helperResult.message || (targetVersion ? `Rollback auf ${targetVersion} gestartet.` : "Update gestartet. App wird in Kürze neu geladen."),
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
    const scriptArgs = [scriptPath];
    if (targetVersion) scriptArgs.push(targetVersion);
    
    const child = spawn("bash", scriptArgs, {
      detached: true,
      stdio: "ignore",
      cwd: process.cwd(),
      env: {
        ...process.env,
        TARGET_VERSION: targetVersion,
      }
    });

    child.unref();

    return NextResponse.json(
      {
        success: true,
        message: targetVersion
          ? `Rollback auf ${targetVersion} im Hintergrund gestartet.`
          : "Update im Hintergrund gestartet. Seite lädt nach Abschluss automatisch neu.",
      },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unbekannter Fehler beim Starten des Updates.";
    return NextResponse.json({ success: false, error: detail }, { status: 500 });
  }
}
