#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/onvifscanner}"
APP_USER="${APP_USER:-onvifscanner}"

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Please run as root (sudo)." >&2
  exit 1
fi

if [[ ! -d "$APP_DIR/.git" ]]; then
  echo "No git repo found in $APP_DIR. Run install.sh first." >&2
  exit 1
fi

git -C "$APP_DIR" fetch --all --prune
git -C "$APP_DIR" checkout -f main
git -C "$APP_DIR" pull --ff-only

chown -R "$APP_USER:$APP_USER" "$APP_DIR"

sudo -u "$APP_USER" -H bash -lc "cd '$APP_DIR' && npm ci"
sudo -u "$APP_USER" -H bash -lc "cd '$APP_DIR' && npm run build"
sudo -u "$APP_USER" -H bash -lc "cd '$APP_DIR' && npm prune --omit=dev"

systemctl restart onvifscanner.service
systemctl --no-pager --full status onvifscanner.service || true

