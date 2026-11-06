import { NextResponse } from "next/server";
import { execFile, spawn } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);

export async function GET() {
  try {
    const helperPath = "/usr/local/bin/onvifscanner-update-helper";
    const isSystemInstallation =
      fs.existsSync("/etc/systemd/system/onvifscanner.service") || fs.existsSync(helperPath);

    let isRunning = false;
    if (isSystemInstallation) {
      try {
        await execFileAsync("systemctl", ["is-active", "--quiet", "onvifscanner-update.service"], { timeout: 2000 });
        isRunning = true;
      } catch {
        isRunning = false;
      }
    }

    let lastLog = "";
    const logPath = "/var/log/onvifscanner-update.log";
    if (fs.existsSync(logPath)) {
      try {
        const content = fs.readFileSync(logPath, "utf8");
        const lines = content.trim().split("\n");
        lastLog = lines.slice(-25).join("\n");
      } catch {}
    }

    return NextResponse.json({
      isRunning,
      isSystemInstallation,
      helperInstalled: fs.existsSync(helperPath),
      lastLog,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

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
      } catch (error: unknown) {
        const err = error as { stderr?: string; stdout?: string; message?: string } | null;
        const stderr = typeof err?.stderr === "string" ? err.stderr.trim() : "";
        const stdout = typeof err?.stdout === "string" ? err.stdout.trim() : "";
        const msg = typeof err?.message === "string" ? err.message.trim() : "";
        const detail = stderr || stdout || msg || "Der Update-Dienst konnte nicht gestartet werden.";
        return NextResponse.json({
          success: false,
          error: detail,
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
