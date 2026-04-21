#!/usr/bin/env bash
set -euo pipefail

# Debian LXC "one script" installer/updater.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/Schello805/onvifscanner/main/scripts/debian-lxc/auto.sh | bash
#
# Optional env vars:
#   REPO_URL=https://github.com/Schello805/onvifscanner.git
#   APP_DIR=/opt/onvifscanner
#   APP_USER=onvifscanner
#   ENV_FILE=/etc/onvifscanner/onvifscanner.env
#   INSTALL_NGINX=true
#

REPO_URL="${REPO_URL:-https://github.com/Schello805/onvifscanner.git}"
APP_DIR="${APP_DIR:-/opt/onvifscanner}"
APP_USER="${APP_USER:-onvifscanner}"
ENV_FILE="${ENV_FILE:-/etc/onvifscanner/onvifscanner.env}"
INSTALL_NGINX="${INSTALL_NGINX:-false}"

require_root() {
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    echo "Please run as root (sudo)." >&2
    exit 1
  fi
}

require_systemd() {
  if ! command -v systemctl >/dev/null 2>&1; then
    echo "systemd/systemctl not found. This installer expects a Debian LXC with systemd." >&2
    exit 1
  fi
}

ensure_packages() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y --no-install-recommends \
    ca-certificates curl git gnupg \
    build-essential python3 make g++ pkg-config \
    libvips libvips-dev \
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
  apt-get install -y --no-install-recommends nodejs
}

ensure_user() {
  if ! id -u "$APP_USER" >/dev/null 2>&1; then
    useradd --system --create-home --home-dir "/home/${APP_USER}" --shell /usr/sbin/nologin "$APP_USER"
  fi
  install -d -o "$APP_USER" -g "$APP_USER" "$APP_DIR"
  install -d -o root -g root /etc/onvifscanner
}

as_app_user() {
  local cmd="$1"
  # runuser is provided by util-linux (present on Debian minimal).
  runuser -u "$APP_USER" -- bash -lc "export HOME='/home/${APP_USER}'; ${cmd}"
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
THUMBNAILS_MAX=24
EOF
    chmod 0640 "$ENV_FILE"
    chown root:"$APP_USER" "$ENV_FILE"
  fi
}

build_app() {
  as_app_user "cd '$APP_DIR' && npm ci"
  as_app_user "cd '$APP_DIR' && npm run build"
  as_app_user "cd '$APP_DIR' && npm prune --omit=dev"
}

install_service() {
  install -m 0755 "$APP_DIR/deploy/onvifscanner-start" /usr/local/bin/onvifscanner-start
  install -m 0644 "$APP_DIR/deploy/onvifscanner.service" /etc/systemd/system/onvifscanner.service
  systemctl daemon-reload
  systemctl enable onvifscanner.service
  # Start in background so the installer returns control to the shell immediately.
  systemctl start --no-block onvifscanner.service
}

setup_nginx() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get install -y --no-install-recommends nginx
  cp "$APP_DIR/deploy/nginx-onvifscanner.conf" /etc/nginx/sites-available/onvifscanner
  ln -sf /etc/nginx/sites-available/onvifscanner /etc/nginx/sites-enabled/onvifscanner
  rm -f /etc/nginx/sites-enabled/default || true
  nginx -t
  systemctl reload nginx
}

print_summary() {
  echo
  echo "ONVIFscanner installed/updated."
  echo "- Service (starting in background): systemctl status onvifscanner"
  echo "- Logs:    journalctl -u onvifscanner -f"
  echo "- Config:  ${ENV_FILE}"
  echo
  if [[ "$INSTALL_NGINX" == "true" ]]; then
    echo "nginx is configured as reverse proxy."
  else
    echo "Optional nginx:"
    echo "  INSTALL_NGINX=true curl -fsSL https://raw.githubusercontent.com/Schello805/onvifscanner/main/scripts/debian-lxc/auto.sh | bash"
  fi
  echo
}

main() {
  require_root
  require_systemd
  ensure_packages
  install_node20
  ensure_user
  checkout_repo
  ensure_env_file
  build_app
  install_service
  if [[ "$INSTALL_NGINX" == "true" ]]; then
    setup_nginx
  fi
  print_summary
}

main "$@"
