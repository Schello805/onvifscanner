#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/Schello805/onvifscanner.git}"
APP_DIR="${APP_DIR:-/opt/onvifscanner}"
APP_USER="${APP_USER:-onvifscanner}"
ENV_FILE="${ENV_FILE:-/etc/onvifscanner/onvifscanner.env}"
INSTALL_NGINX="${INSTALL_NGINX:-false}"
RUN_NPM_AUDIT="${RUN_NPM_AUDIT:-false}"
NPM_CACHE_DIR="${NPM_CACHE_DIR:-/var/cache/onvifscanner/npm}"

require_root() {
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    echo "Please run as root (sudo)." >&2
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
    libc6 ffmpeg tesseract-ocr cifs-utils nfs-common sudo
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
  if [[ ! -f /usr/share/keyrings/nodesource.gpg ]]; then
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
      | gpg --dearmor --batch --yes --output /usr/share/keyrings/nodesource.gpg
  fi
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
  install -d -o "$APP_USER" -g "$APP_USER" "$APP_DIR/data"
  install -d -o "$APP_USER" -g "$APP_USER" "$APP_DIR/data/recordings"
  install -d -o "$APP_USER" -g "$APP_USER" "$APP_DIR/data/motion-buffer"
  install -d -o "$APP_USER" -g "$APP_USER" "$APP_DIR/data/motion-staging"
  install -d -o "$APP_USER" -g "$APP_USER" "$APP_DIR/data/playback-cache"
  install -d -m 0750 -o "$APP_USER" -g "$APP_USER" "$NPM_CACHE_DIR"
  install -d -o root -g root /etc/onvifscanner
}

checkout_repo() {
  if [[ -d "${APP_DIR}/.git" ]]; then
    chown -R "$APP_USER:$APP_USER" "$APP_DIR" || true
    runuser -u "$APP_USER" -- bash -lc "export HOME='/home/${APP_USER}'; git -C '$APP_DIR' fetch --all --prune"
    runuser -u "$APP_USER" -- bash -lc "export HOME='/home/${APP_USER}'; git -C '$APP_DIR' checkout -f main"
    runuser -u "$APP_USER" -- bash -lc "export HOME='/home/${APP_USER}'; git -C '$APP_DIR' pull --ff-only"
  else
    rm -rf "$APP_DIR"
    install -d -o "$APP_USER" -g "$APP_USER" "$APP_DIR"
    runuser -u "$APP_USER" -- bash -lc "export HOME='/home/${APP_USER}'; git clone '$REPO_URL' '$APP_DIR'"
    runuser -u "$APP_USER" -- bash -lc "export HOME='/home/${APP_USER}'; git -C '$APP_DIR' checkout -f main"
  fi
  install -d -o "$APP_USER" -g "$APP_USER" "$APP_DIR/data"
  install -d -o "$APP_USER" -g "$APP_USER" "$APP_DIR/data/recordings"
  install -d -o "$APP_USER" -g "$APP_USER" "$APP_DIR/data/motion-buffer"
  install -d -o "$APP_USER" -g "$APP_USER" "$APP_DIR/data/motion-staging"
  install -d -o "$APP_USER" -g "$APP_USER" "$APP_DIR/data/playback-cache"
  chown -R "$APP_USER:$APP_USER" "$APP_DIR"
}

ensure_env_file() {
  if [[ ! -f "$ENV_FILE" ]]; then
    cat >"$ENV_FILE" <<'EOF'
# Bind address for Next.js
HOST=0.0.0.0
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
THUMBNAIL_MAX_CONCURRENCY=2
THUMBNAIL_CACHE_TTL_MS=10000

# Lightweight background health monitor
MONITOR_INTERVAL_MS=60000
ENABLE_AUTO_DISCOVERY=false
ENABLE_MOTION_DETECTION=true
MOTION_DETECTION_INTERVAL_MS=3000
MOTION_DETECTION_CONCURRENCY=2
MOTION_CONFIRMATION_FRAMES=2
MOTION_ANALYSIS_WIDTH=192
MOTION_SOURCE_WIDTH=640
# MOTION_DETECTION_V2_DEFAULT_APPLIED=true
# MOTION_CPU_OPTIMIZATION_V1_APPLIED=true

# Motion recording ring buffer
MOTION_BUFFER_SEGMENT_SECONDS=5
EOF
    chmod 0640 "$ENV_FILE"
    chown root:"$APP_USER" "$ENV_FILE"
  fi

  if ! grep -q '^# MOTION_DETECTION_V2_DEFAULT_APPLIED=true$' "$ENV_FILE"; then
    if grep -q '^ENABLE_MOTION_DETECTION=false$' "$ENV_FILE"; then
      sed -i 's/^ENABLE_MOTION_DETECTION=false$/ENABLE_MOTION_DETECTION=true/' "$ENV_FILE"
    elif ! grep -q '^ENABLE_MOTION_DETECTION=' "$ENV_FILE"; then
      printf '\nENABLE_MOTION_DETECTION=true\n' >>"$ENV_FILE"
    fi
    grep -q '^MOTION_DETECTION_INTERVAL_MS=' "$ENV_FILE" || printf 'MOTION_DETECTION_INTERVAL_MS=3000\n' >>"$ENV_FILE"
    grep -q '^MOTION_DETECTION_CONCURRENCY=' "$ENV_FILE" || printf 'MOTION_DETECTION_CONCURRENCY=3\n' >>"$ENV_FILE"
    printf '# MOTION_DETECTION_V2_DEFAULT_APPLIED=true\n' >>"$ENV_FILE"
    chmod 0640 "$ENV_FILE"
    chown root:"$APP_USER" "$ENV_FILE"
  fi

  if ! grep -q '^# MOTION_CPU_OPTIMIZATION_V1_APPLIED=true$' "$ENV_FILE"; then
    sed -i 's/^MOTION_DETECTION_CONCURRENCY=3$/MOTION_DETECTION_CONCURRENCY=2/' "$ENV_FILE"
    sed -i 's/^MOTION_ANALYSIS_WIDTH=256$/MOTION_ANALYSIS_WIDTH=192/' "$ENV_FILE"
    sed -i 's/^MOTION_SOURCE_WIDTH=384$/MOTION_SOURCE_WIDTH=640/' "$ENV_FILE"
    grep -q '^MOTION_DETECTION_CONCURRENCY=' "$ENV_FILE" || printf 'MOTION_DETECTION_CONCURRENCY=2\n' >>"$ENV_FILE"
    grep -q '^MOTION_ANALYSIS_WIDTH=' "$ENV_FILE" || printf 'MOTION_ANALYSIS_WIDTH=192\n' >>"$ENV_FILE"
    grep -q '^MOTION_SOURCE_WIDTH=' "$ENV_FILE" || printf 'MOTION_SOURCE_WIDTH=640\n' >>"$ENV_FILE"
    printf '# MOTION_CPU_OPTIMIZATION_V1_APPLIED=true\n' >>"$ENV_FILE"
    chmod 0640 "$ENV_FILE"
    chown root:"$APP_USER" "$ENV_FILE"
  fi
}

build_app() {
  runuser -u "$APP_USER" -- bash -lc "export HOME='/home/${APP_USER}' NPM_CONFIG_CACHE='$NPM_CACHE_DIR'; cd '$APP_DIR' && NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false npm ci"
  APP_DIR="$APP_DIR" APP_USER="$APP_USER" bash "$APP_DIR/scripts/debian-lxc/setup-media.sh"
  runuser -u "$APP_USER" -- bash -lc "export HOME='/home/${APP_USER}' NPM_CONFIG_CACHE='$NPM_CACHE_DIR'; cd '$APP_DIR' && npx prisma generate && npx prisma db push --accept-data-loss"
  runuser -u "$APP_USER" -- bash -lc "export HOME='/home/${APP_USER}' NPM_CONFIG_CACHE='$NPM_CACHE_DIR' NODE_OPTIONS='--max-old-space-size=1536'; cd '$APP_DIR' && npm run build"
  local state_dir dependency_hash schema_hash
  state_dir="$APP_DIR/data/.update-state"
  install -d -o "$APP_USER" -g "$APP_USER" "$state_dir"
  dependency_hash="$(node -e '
    const fs = require("fs");
    const pkg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const lock = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
    delete lock.name;
    delete lock.version;
    if (lock.packages?.[""]) {
      delete lock.packages[""].name;
      delete lock.packages[""].version;
    }
    process.stdout.write(JSON.stringify({ dependencies: pkg.dependencies, devDependencies: pkg.devDependencies, optionalDependencies: pkg.optionalDependencies, packageManager: pkg.packageManager, lock }));
  ' "$APP_DIR/package.json" "$APP_DIR/package-lock.json" | sha256sum | awk '{print $1}')"
  schema_hash="$(sha256sum "$APP_DIR/prisma/schema.prisma" | awk '{print $1}')"
  printf '%s\n' "$dependency_hash" >"$state_dir/dependencies.sha256"
  printf '%s\n' "$schema_hash" >"$state_dir/prisma-schema.sha256"
  chown -R "$APP_USER:$APP_USER" "$state_dir"
  if [[ "$RUN_NPM_AUDIT" == "true" ]]; then
    echo "Running runtime dependency audit (omit=dev)..."
    runuser -u "$APP_USER" -- bash -lc "export HOME='/home/${APP_USER}' NPM_CONFIG_CACHE='$NPM_CACHE_DIR'; cd '$APP_DIR' && npm audit --omit=dev || true"
  fi
}

install_service() {
  install -m 0755 "$APP_DIR/deploy/onvifscanner-start" /usr/local/bin/onvifscanner-start
  install -m 0755 "$APP_DIR/deploy/onvifscanner-storage-helper" /usr/local/bin/onvifscanner-storage-helper
  install -d -m 0755 /usr/local/libexec
  install -m 0755 "$APP_DIR/scripts/debian-lxc/update.sh" /usr/local/libexec/onvifscanner-update
  install -m 0755 "$APP_DIR/deploy/onvifscanner-update-helper" /usr/local/bin/onvifscanner-update-helper
  echo "onvifscanner ALL=(root) NOPASSWD: /usr/local/bin/onvifscanner-storage-helper, /usr/local/bin/onvifscanner-update-helper" > /etc/sudoers.d/onvifscanner
  chmod 0440 /etc/sudoers.d/onvifscanner
  install -m 0644 "$APP_DIR/deploy/onvifscanner.service" /etc/systemd/system/onvifscanner.service
  systemctl daemon-reload
  systemctl enable onvifscanner.service
  systemctl restart --no-block onvifscanner.service
}

print_next_steps() {
  echo
  echo "Installed ONVIFscanner."
  echo "- Service: systemctl status onvifscanner"
  echo "- Logs:    journalctl -u onvifscanner -f"
  echo
  echo "Optional nginx reverse proxy:"
  echo "- INSTALL_NGINX=true curl -fsSL https://raw.githubusercontent.com/Schello805/onvifscanner/main/scripts/debian-lxc/auto.sh | bash"
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
  if [[ "$INSTALL_NGINX" == "true" ]]; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get install -y --no-install-recommends nginx
    cp "$APP_DIR/deploy/nginx-onvifscanner.conf" /etc/nginx/sites-available/onvifscanner
    ln -sf /etc/nginx/sites-available/onvifscanner /etc/nginx/sites-enabled/onvifscanner
    rm -f /etc/nginx/sites-enabled/default || true
    nginx -t
    systemctl reload nginx
  fi
  print_next_steps
}

main "$@"
