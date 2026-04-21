#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/onvifscanner}"
APP_USER="${APP_USER:-onvifscanner}"
REPO_URL="${REPO_URL:-https://github.com/Schello805/onvifscanner.git}"

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Please run as root (sudo)." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends \
  ca-certificates curl git gnupg \
  build-essential python3 make g++ pkg-config \
  libvips libvips-dev \
  libc6

if command -v node >/dev/null 2>&1; then
  major="$(node -p 'process.versions.node.split(\".\")[0]' 2>/dev/null || echo 0)"
else
  major=0
fi
if [[ "${major:-0}" -lt 20 ]]; then
  mkdir -p /usr/share/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor -o /usr/share/keyrings/nodesource.gpg
  echo "deb [signed-by=/usr/share/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -y
  apt-get install -y --no-install-recommends nodejs
fi

if [[ ! -d "$APP_DIR/.git" ]]; then
  echo "No git repo found in $APP_DIR. Installing fresh..." >&2
  rm -rf "$APP_DIR"
  git clone "$REPO_URL" "$APP_DIR"
  git -C "$APP_DIR" checkout -f main
else
  git -C "$APP_DIR" fetch --all --prune
  git -C "$APP_DIR" checkout -f main
  git -C "$APP_DIR" pull --ff-only
fi

chown -R "$APP_USER:$APP_USER" "$APP_DIR"

runuser -u "$APP_USER" -- bash -lc "export HOME='/home/${APP_USER}'; cd '$APP_DIR' && npm ci"
runuser -u "$APP_USER" -- bash -lc "export HOME='/home/${APP_USER}'; cd '$APP_DIR' && npm run build"
runuser -u "$APP_USER" -- bash -lc "export HOME='/home/${APP_USER}'; cd '$APP_DIR' && npm prune --omit=dev"

systemctl restart --no-block onvifscanner.service
systemctl --no-pager --full --no-ask-password status onvifscanner.service || true
