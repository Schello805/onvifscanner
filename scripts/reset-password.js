#!/usr/bin/env node
const path = require("path");
const fs = require("fs");
const { setAppPassword, loadSecurityConfig } = require("./security");

const newPass = process.argv[2];

if (!newPass) {
  setAppPassword(null);
  console.log("✅ App-Passwort wurde erfolgreich deaktiviert (Schutz entfernt).");
  console.log("   Du kannst die Web-App jetzt wieder ohne Passwort aufrufen.");
} else {
  setAppPassword(newPass.trim());
  console.log(`✅ Neues App-Passwort / PIN wurde erfolgreich gesetzt.`);
  console.log("   Du kannst dich jetzt mit diesem Passwort anmelden.");
}
