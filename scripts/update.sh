#!/usr/bin/env bash
# ==============================================================================
# ONVIFscanner - One-Command Update Script
# Updates repository from GitHub, installs dependencies, builds Next.js app,
# and restarts systemd service if active.
# ==============================================================================

set -euo pipefail

# ANSI color codes
C_RESET='\033[0m'
C_BOLD='\033[1m'
C_GREEN='\033[32m'
C_BLUE='\033[34m'
C_CYAN='\033[36m'
C_YELLOW='\033[33m'
C_RED='\033[31m'

log_info() { echo -e "${C_CYAN}${C_BOLD}[INFO]${C_RESET} $*"; }
log_step() { echo -e "${C_BLUE}${C_BOLD}[STEP]${C_RESET} $*"; }
log_ok()   { echo -e "${C_GREEN}${C_BOLD}[OK]${C_RESET} $*"; }
log_warn() { echo -e "${C_YELLOW}${C_BOLD}[WARN]${C_RESET} $*"; }
log_err()  { echo -e "${C_RED}${C_BOLD}[ERROR]${C_RESET} $*"; }

# 1. Determine Project Directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_DIR}"

echo -e "${C_BOLD}======================================================${C_RESET}"
echo -e "${C_BOLD}       ONVIFscanner - GitHub Update Routine           ${C_RESET}"
echo -e "${C_BOLD}======================================================${C_RESET}"
log_info "Arbeitsverzeichnis: ${PROJECT_DIR}"

# 2. Check if this is an LXC /opt/onvifscanner system installation run as root
if [[ -f "/etc/systemd/system/onvifscanner.service" && "${PROJECT_DIR}" == "/opt/onvifscanner" && "${EUID:-$(id -u)}" -eq 0 ]]; then
  if [[ -f "${SCRIPT_DIR}/debian-lxc/update.sh" ]]; then
    log_info "Erkannt: Debian/Proxmox LXC System-Installation (/opt/onvifscanner)."
    log_step "Führe Debian-LXC Update-Skript aus…"
    exec bash "${SCRIPT_DIR}/debian-lxc/update.sh"
  fi
fi

# 3. Check Git availability and remote
if ! command -v git >/dev/null 2>&1; then
  log_err "git ist nicht installiert. Bitte installiere git."
  exit 1
fi

if [[ ! -d ".git" ]]; then
  log_err "Kein Git-Repository in ${PROJECT_DIR} gefunden."
  exit 1
fi

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")"
log_info "Aktueller Git-Branch: ${CURRENT_BRANCH}"

# 4. Handle local uncommitted modifications
if ! git diff-index --quiet HEAD -- 2>/dev/null; then
  log_warn "Lokale, ungespeicherte Änderungen gefunden."
  log_step "Erstelle automatischen Git Stash zur Absicherung…"
  git stash push -m "Auto-stash vor update.sh ($(date +%Y-%m-%d_%H-%M-%S))" || true
fi

# 5. Pull latest changes from GitHub
log_step "Lade neueste Änderungen von GitHub herunter…"
git fetch --all --prune

REMOTE_BRANCH="origin/${CURRENT_BRANCH}"
if git rev-parse --verify "${REMOTE_BRANCH}" >/dev/null 2>&1; then
  git pull --rebase origin "${CURRENT_BRANCH}" || {
    log_warn "Rebase fehlgeschlagen, versuche Standard-Pull…"
    git rebase --abort 2>/dev/null || true
    git pull origin "${CURRENT_BRANCH}"
  }
else
  log_warn "Kein Remote-Branch '${REMOTE_BRANCH}' gefunden, versuche 'git pull'…"
  git pull
fi

NEW_COMMIT="$(git rev-parse --short HEAD)"
log_ok "Projekt aktualisiert auf Commit: ${NEW_COMMIT}"

# 6. Install / Update Node.js dependencies
log_step "Aktualisiere npm-Pakete…"
if [[ -f "package-lock.json" ]]; then
  npm ci --no-audit || npm install --no-audit
else
  npm install --no-audit
fi
log_ok "Abhängigkeiten erfolgreich aktualisiert."

# 7. Build Next.js Application
log_step "Erstelle Next.js Production Build…"
npm run build
log_ok "Build erfolgreich abgeschlossen."

# 8. Restart background service if systemd is present
if command -v systemctl >/dev/null 2>&1; then
  if systemctl is-active --quiet onvifscanner.service 2>/dev/null; then
    log_step "Starte onvifscanner.service neu…"
    if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
      systemctl restart onvifscanner.service
      systemctl --no-pager status onvifscanner.service || true
    else
      if command -v sudo >/dev/null 2>&1; then
        sudo systemctl restart onvifscanner.service
        sudo systemctl --no-pager status onvifscanner.service || true
      else
        log_warn "onvifscanner.service ist aktiv, aber kein sudo verfügbar zum Neustarten."
        log_warn "Bitte führe manuell aus: systemctl restart onvifscanner.service"
      fi
    fi
    log_ok "Dienst neu gestartet."
  fi
fi

# 9. Restart PM2 process if active
if command -v pm2 >/dev/null 2>&1; then
  if pm2 describe onvifscanner >/dev/null 2>&1; then
    log_step "Starte PM2-Prozess 'onvifscanner' neu…"
    pm2 restart onvifscanner
    log_ok "PM2 Prozess neu gestartet."
  fi
fi

echo ""
echo -e "${C_GREEN}${C_BOLD}======================================================${C_RESET}"
echo -e "${C_GREEN}${C_BOLD}  Update erfolgreich abgeschlossen! (Commit: ${NEW_COMMIT})  ${C_RESET}"
echo -e "${C_GREEN}${C_BOLD}======================================================${C_RESET}"
