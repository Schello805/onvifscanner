#!/usr/bin/env node
const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");

const PROJECT_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.join(PROJECT_DIR, "data");
const SECURITY_FILE = path.join(DATA_DIR, "security.json");
const { setAppPassword, loadSecurityConfig } = require("./security");

const newPass = process.argv[2];

// 1. Remove APP_PASSWORD from /etc/onvifscanner/onvifscanner.env if present
const ENV_FILE = "/etc/onvifscanner/onvifscanner.env";
try {
  if (fs.existsSync(ENV_FILE)) {
    let envContent = fs.readFileSync(ENV_FILE, "utf8");
    if (envContent.includes("APP_PASSWORD")) {
      envContent = envContent.replace(/^APP_PASSWORD=.*$/gm, "").trim() + "\n";
      fs.writeFileSync(ENV_FILE, envContent, "utf8");
      console.log("ℹ️  APP_PASSWORD aus " + ENV_FILE + " entfernt.");
    }
  }
} catch (e) {
  // ignore
}

// 2. Set or reset password
if (!newPass || newPass === "off" || newPass === "none" || newPass === "clear") {
  setAppPassword(null);
  console.log("✅ App-Passwort wurde komplett ENTFERNT.");
  console.log("   Die App ist nun wieder frei ohne Passwort zugänglich.");
} else {
  const pass = newPass.trim();
  setAppPassword(pass);
  console.log(`✅ App-Passwort wurde erfolgreich auf "${pass}" gesetzt.`);
}

// 3. Fix permissions so systemd service user 'onvifscanner' can read and write it
try {
  if (fs.existsSync(SECURITY_FILE)) {
    fs.chmodSync(SECURITY_FILE, 0o666);
    try {
      execSync("chown -R onvifscanner:onvifscanner " + DATA_DIR, { stdio: "ignore" });
    } catch {}
  }
} catch (e) {
  // ignore
}

console.log("ℹ️  Datei: " + SECURITY_FILE);
console.log("👉 Führe jetzt 'systemctl restart onvifscanner' aus und lade deinen Browser neu.");
