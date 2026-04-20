#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/Schello805/onvifscanner.git}"
APP_DIR="${APP_DIR:-/opt/onvifscanner}"
APP_USER="${APP_USER:-onvifscanner}"
ENV_FILE="${ENV_FILE:-/etc/onvifscanner/onvifscanner.env}"

require_root() {
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    echo "Please run as root (sudo)." >&2
    exit 1
  fi
}

ensure_packages() {
  apt-get update -y
  apt-get install -y --no-install-recommends \
    ca-certificates curl git gnupg \
    libc6
}

install_node20() {
  if command -v node >/dev/null 2>&1; then
    local major
    major="$(node -p 'process.versions.node.split(\".\")[0]' 2>/dev/null || echo 0)"
    if [[ "$major" -ge 20 ]]; then
      return 0
    fi
  fi

  mkdir -p /usr/share/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor -o /usr/share/keyrings/nodesource.gpg
  echo "deb [signed-by=/usr/share/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -y
  apt-get install -y nodejs
}

ensure_user() {
  if ! id -u "$APP_USER" >/dev/null 2>&1; then
    useradd --system --create-home --home-dir "/home/${APP_USER}" --shell /usr/sbin/nologin "$APP_USER"
  fi
  install -d -o "$APP_USER" -g "$APP_USER" "$APP_DIR"
  install -d -o root -g root /etc/onvifscanner
}

checkout_repo() {
  if [[ -d "${APP_DIR}/.git" ]]; then
    git -C "$APP_DIR" fetch --all --prune
    git -C "$APP_DIR" checkout -f main
    git -C "$APP_DIR" pull --ff-only
  else
    rm -rf "$APP_DIR"
    git clone "$REPO_URL" "$APP_DIR"
    git -C "$APP_DIR" checkout -f main
  fi
  chown -R "$APP_USER:$APP_USER" "$APP_DIR"
}

ensure_env_file() {
  if [[ ! -f "$ENV_FILE" ]]; then
    cat >"$ENV_FILE" <<'EOF'
# Bind address for Next.js
HOST=127.0.0.1
PORT=3000
APP_DIR=/opt/onvifscanner

# UI
NEXT_PUBLIC_REPO_URL=https://github.com/Schello805/onvifscanner

# Scanning limits
ALLOW_PUBLIC_SCAN=false
SCAN_MAX_HOSTS=4096
SCAN_CONCURRENCY=128
SCAN_TIMEOUT_MS=1200
WS_DISCOVERY_TIMEOUT_MS=1800

# Thumbnails
ENABLE_THUMBNAILS=true
THUMBNAILS_MAX=12
EOF
    chmod 0640 "$ENV_FILE"
    chown root:"$APP_USER" "$ENV_FILE"
  fi
}

build_app() {
  sudo -u "$APP_USER" -H bash -lc "cd '$APP_DIR' && npm ci"
  sudo -u "$APP_USER" -H bash -lc "cd '$APP_DIR' && npm run build"
  sudo -u "$APP_USER" -H bash -lc "cd '$APP_DIR' && npm prune --omit=dev"
}

install_service() {
  install -m 0755 "$APP_DIR/deploy/onvifscanner-start" /usr/local/bin/onvifscanner-start
  install -m 0644 "$APP_DIR/deploy/onvifscanner.service" /etc/systemd/system/onvifscanner.service
  systemctl daemon-reload
  systemctl enable --now onvifscanner.service
}

print_next_steps() {
  echo
  echo "Installed ONVIFscanner."
  echo "- Service: systemctl status onvifscanner"
  echo "- Logs:    journalctl -u onvifscanner -f"
  echo
  echo "If you want HTTP on port 80 via nginx:"
  echo "- apt-get install nginx"
  echo "- cp '$APP_DIR/deploy/nginx-onvifscanner.conf' /etc/nginx/sites-available/onvifscanner"
  echo "- ln -s /etc/nginx/sites-available/onvifscanner /etc/nginx/sites-enabled/onvifscanner"
  echo "- nginx -t && systemctl reload nginx"
  echo
}

main() {
  require_root
  ensure_packages
  install_node20
  ensure_user
  checkout_repo
  ensure_env_file
  build_app
  install_service
  print_next_steps
}

main "$@"

