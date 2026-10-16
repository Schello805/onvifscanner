#!/usr/bin/env bash
# ==============================================================================
# ONVIFscanner - Interactive CLI Rollback Script
# Allows rolling back or switching to any previous release tag.
# ==============================================================================

set -euo pipefail

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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_DIR}"

echo -e "${C_BOLD}======================================================${C_RESET}"
echo -e "${C_BOLD}       ONVIFscanner - Version Rollback Tool           ${C_RESET}"
echo -e "${C_BOLD}======================================================${C_RESET}"

if ! command -v git >/dev/null 2>&1; then
  log_err "Git ist nicht installiert."
  exit 1
fi

log_step "Lade aktuelle Tags von GitHub..."
git fetch --all --tags --prune >/dev/null 2>&1 || true

CURRENT_REV="$(git describe --tags --always 2>/dev/null || echo "unbekannt")"
log_info "Aktuelle Version / Commit: ${C_BOLD}${CURRENT_REV}${C_RESET}"

TARGET_VERSION="${1:-}"

if [[ -z "$TARGET_VERSION" ]]; then
  echo ""
  log_info "Verfügbare Versionen (Tags):"
  TAGS=()
  while IFS= read -r line; do
    [[ -n "$line" ]] && TAGS+=("$line")
  done < <(git tag -l --sort=-v:refname | head -n 12)

  if [[ ${#TAGS[@]} -eq 0 ]]; then
    log_err "Keine Git-Tags im Repository gefunden."
    log_info "Du kannst stattdessen einen Commit-Hash oder 'main' eingeben."
  else
    for i in "${!TAGS[@]}"; do
      echo -e "  [${C_BOLD}$((i+1))${C_RESET}] ${TAGS[$i]}"
    done
    echo ""
  fi

  read -r -p "Zielversion eingeben (z. B. v0.15.13 oder Nummer 1-${#TAGS[@]}): " USER_INPUT
  USER_INPUT="$(echo "$USER_INPUT" | tr -d '[:space:]')"

  if [[ -z "$USER_INPUT" ]]; then
    log_warn "Keine Eingabe - Rollback abgebrochen."
    exit 0
  fi

  # Check if numeric selection
  if [[ "$USER_INPUT" =~ ^[0-9]+$ ]] && [[ "$USER_INPUT" -ge 1 ]] && [[ "$USER_INPUT" -le ${#TAGS[@]} ]]; then
    TARGET_VERSION="${TAGS[$((USER_INPUT-1))]}"
  else
    TARGET_VERSION="$USER_INPUT"
  fi
fi

# Normalize tag name: add 'v' if missing and tag exists with 'v'
if ! git rev-parse --verify "$TARGET_VERSION" >/dev/null 2>&1; then
  if git rev-parse --verify "v$TARGET_VERSION" >/dev/null 2>&1; then
    TARGET_VERSION="v$TARGET_VERSION"
  elif git rev-parse --verify "tags/$TARGET_VERSION" >/dev/null 2>&1; then
    TARGET_VERSION="tags/$TARGET_VERSION"
  else
    log_err "Zielversion oder Tag '${TARGET_VERSION}' nicht im Git-Repository gefunden!"
    exit 1
  fi
fi

echo ""
log_step "Starten des Rollbacks auf: ${C_BOLD}${C_GREEN}${TARGET_VERSION}${C_RESET}"
echo -e "${C_YELLOW}Hinweis:${C_RESET} Die SQLite-Datenbank wird vorab automatisch gesichert."
echo ""

# Delegate to debian-lxc update script if running as root on LXC
if [[ -f "/etc/systemd/system/onvifscanner.service" && "${PROJECT_DIR}" == "/opt/onvifscanner" && "${EUID:-$(id -u)}" -eq 0 ]]; then
  TARGET_VERSION="$TARGET_VERSION" FORCE_REBUILD=true bash "${SCRIPT_DIR}/debian-lxc/update.sh"
else
  TARGET_VERSION="$TARGET_VERSION" bash "${SCRIPT_DIR}/update.sh" "$TARGET_VERSION"
fi

echo ""
log_ok "Rollback auf ${TARGET_VERSION} erfolgreich abgeschlossen!"
