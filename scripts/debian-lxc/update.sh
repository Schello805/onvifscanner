#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/onvifscanner}"
APP_USER="${APP_USER:-onvifscanner}"
ENV_FILE="${ENV_FILE:-/etc/onvifscanner/onvifscanner.env}"
REPO_URL="${REPO_URL:-https://github.com/Schello805/onvifscanner.git}"
RUN_NPM_AUDIT="${RUN_NPM_AUDIT:-false}"
NPM_CACHE_DIR="${NPM_CACHE_DIR:-/var/cache/onvifscanner/npm}"
FORCE_SYSTEM_PACKAGES="${FORCE_SYSTEM_PACKAGES:-false}"
FORCE_REBUILD="${FORCE_REBUILD:-false}"
DEPENDENCIES_CHANGED=false

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Please run as root (sudo)." >&2
  exit 1
fi

if [[ "$FORCE_SYSTEM_PACKAGES" == "true" ]] ||
  ! command -v curl >/dev/null 2>&1 ||
  ! command -v git >/dev/null 2>&1 ||
  ! command -v gpg >/dev/null 2>&1 ||
  ! command -v python3 >/dev/null 2>&1 ||
  ! command -v make >/dev/null 2>&1 ||
  ! command -v g++ >/dev/null 2>&1 ||
  ! command -v pkg-config >/dev/null 2>&1 ||
  ! command -v ffmpeg >/dev/null 2>&1 ||
  ! command -v tesseract >/dev/null 2>&1 ||
  ! command -v mount.cifs >/dev/null 2>&1 ||
  ! command -v mount.nfs >/dev/null 2>&1 ||
  ! command -v sudo >/dev/null 2>&1 ||
  ! pkg-config --exists vips; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y --no-install-recommends \
    ca-certificates curl git gnupg \
    build-essential python3 make g++ pkg-config \
    libvips libvips-dev \
    libc6 ffmpeg tesseract-ocr \
    cifs-utils nfs-common sudo
else
  echo "System requirements already installed; skipping apt."
fi

if command -v node >/dev/null 2>&1; then
  major="$(node -p 'process.versions.node.split(\".\")[0]' 2>/dev/null || echo 0)"
else
  major=0
fi
if [[ "${major:-0}" -lt 20 ]]; then
  mkdir -p /usr/share/keyrings
  if [[ ! -f /usr/share/keyrings/nodesource.gpg ]]; then
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
      | gpg --dearmor --batch --yes --output /usr/share/keyrings/nodesource.gpg
  fi
  echo "deb [signed-by=/usr/share/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -y
  apt-get install -y --no-install-recommends nodejs
fi

# Automatic pre-update database backup
if [[ -f "$APP_DIR/data/onvifscanner.db" ]]; then
  echo "Erstelle Sicherheits-Backup der Datenbank..."
  cp "$APP_DIR/data/onvifscanner.db" "$APP_DIR/data/onvifscanner.db.backup-pre-update" || true
  cp "$APP_DIR/data/onvifscanner.db" "$APP_DIR/data/onvifscanner.db.backup-$(date +%Y%m%d_%H%M%S)" || true
  # Keep only 5 most recent timestamped backups
  ls -1t "$APP_DIR/data"/onvifscanner.db.backup-[0-9]* 2>/dev/null | tail -n +6 | xargs rm -f 2>/dev/null || true
fi

previous_commit=""
if [[ ! -d "$APP_DIR/.git" ]]; then
  echo "No git repo found in $APP_DIR. Installing fresh..." >&2
  rm -rf "$APP_DIR"
  install -d -o "$APP_USER" -g "$APP_USER" "$APP_DIR"
  runuser -u "$APP_USER" -- bash -lc "export HOME='/home/${APP_USER}'; git clone '$REPO_URL' '$APP_DIR'"
  if [[ -n "${TARGET_VERSION:-}" ]]; then
    runuser -u "$APP_USER" -- bash -lc "export HOME='/home/${APP_USER}'; git -C '$APP_DIR' checkout -f '$TARGET_VERSION'"
  else
    runuser -u "$APP_USER" -- bash -lc "export HOME='/home/${APP_USER}'; git -C '$APP_DIR' checkout -f main"
  fi
else
  chown -R "$APP_USER:$APP_USER" "$APP_DIR" || true
  previous_commit="$(runuser -u "$APP_USER" -- git -C "$APP_DIR" rev-parse HEAD 2>/dev/null || echo "")"
  runuser -u "$APP_USER" -- bash -lc "export HOME='/home/${APP_USER}'; git -C '$APP_DIR' fetch --all --tags --prune"
  if [[ -n "${TARGET_VERSION:-}" ]]; then
    echo "Führe Rollback / Wechsel auf Version '$TARGET_VERSION' durch..."
    runuser -u "$APP_USER" -- bash -lc "export HOME='/home/${APP_USER}'; git -C '$APP_DIR' checkout -f '$TARGET_VERSION'"
    FORCE_REBUILD=true
  else
    runuser -u "$APP_USER" -- bash -lc "export HOME='/home/${APP_USER}'; git -C '$APP_DIR' checkout -f main"
    runuser -u "$APP_USER" -- bash -lc "export HOME='/home/${APP_USER}'; git -C '$APP_DIR' pull --ff-only"
  fi
fi
current_commit="$(runuser -u "$APP_USER" -- git -C "$APP_DIR" rev-parse HEAD)"

chown -R "$APP_USER:$APP_USER" "$APP_DIR"
install -d -o "$APP_USER" -g "$APP_USER" "$APP_DIR/data/motion-buffer"
install -d -o "$APP_USER" -g "$APP_USER" "$APP_DIR/data/motion-staging"
install -d -o "$APP_USER" -g "$APP_USER" "$APP_DIR/data/playback-cache"
install -d -m 0750 -o "$APP_USER" -g "$APP_USER" "$NPM_CACHE_DIR"
state_dir="$APP_DIR/data/.update-state"
install -d -o "$APP_USER" -g "$APP_USER" "$state_dir"
ENV_CHANGED=false

if [[ -f "$ENV_FILE" ]] && ! grep -q '^# MOTION_DETECTION_V2_DEFAULT_APPLIED=true$' "$ENV_FILE"; then
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
  ENV_CHANGED=true
  echo "Enabled efficient server-side motion detection in $ENV_FILE."
fi

if [[ -f "$ENV_FILE" ]] && ! grep -q '^# MOTION_CPU_OPTIMIZATION_V1_APPLIED=true$' "$ENV_FILE"; then
  sed -i 's/^MOTION_DETECTION_CONCURRENCY=3$/MOTION_DETECTION_CONCURRENCY=2/' "$ENV_FILE"
  sed -i 's/^MOTION_ANALYSIS_WIDTH=256$/MOTION_ANALYSIS_WIDTH=192/' "$ENV_FILE"
  sed -i 's/^MOTION_SOURCE_WIDTH=384$/MOTION_SOURCE_WIDTH=640/' "$ENV_FILE"
  grep -q '^MOTION_DETECTION_CONCURRENCY=' "$ENV_FILE" || printf 'MOTION_DETECTION_CONCURRENCY=2\n' >>"$ENV_FILE"
  grep -q '^MOTION_ANALYSIS_WIDTH=' "$ENV_FILE" || printf 'MOTION_ANALYSIS_WIDTH=192\n' >>"$ENV_FILE"
  grep -q '^MOTION_SOURCE_WIDTH=' "$ENV_FILE" || printf 'MOTION_SOURCE_WIDTH=640\n' >>"$ENV_FILE"
  printf '# MOTION_CPU_OPTIMIZATION_V1_APPLIED=true\n' >>"$ENV_FILE"
  chmod 0640 "$ENV_FILE"
  chown root:"$APP_USER" "$ENV_FILE"
  ENV_CHANGED=true
  echo "Applied CPU-optimized motion detection defaults in $ENV_FILE."
fi

if [[ -f "$ENV_FILE" ]] && ! grep -q '^# OBJECT_DETECTION_QUALITY_V1_APPLIED=true$' "$ENV_FILE"; then
  sed -i 's/^MOTION_SOURCE_WIDTH=640$/MOTION_SOURCE_WIDTH=768/' "$ENV_FILE"
  grep -q '^MOTION_SOURCE_WIDTH=' "$ENV_FILE" || printf 'MOTION_SOURCE_WIDTH=768\n' >>"$ENV_FILE"
  grep -q '^OBJECT_DETECTION_MODEL_BASE=' "$ENV_FILE" || printf 'OBJECT_DETECTION_MODEL_BASE=mobilenet_v2\n' >>"$ENV_FILE"
  printf '# OBJECT_DETECTION_QUALITY_V1_APPLIED=true\n' >>"$ENV_FILE"
  chmod 0640 "$ENV_FILE"
  chown root:"$APP_USER" "$ENV_FILE"
  ENV_CHANGED=true
  echo "Applied higher-quality local object detection defaults in $ENV_FILE."
fi

# Ensure timezone is Europe/Berlin for system, cron and journal logs
if [[ -f /usr/share/zoneinfo/Europe/Berlin ]]; then
  ln -sf /usr/share/zoneinfo/Europe/Berlin /etc/localtime
  echo "Europe/Berlin" > /etc/timezone 2>/dev/null || true
fi
if [[ -f "$ENV_FILE" ]] && ! grep -q '^TZ=' "$ENV_FILE"; then
  printf 'TZ=Europe/Berlin\n' >>"$ENV_FILE"
  chmod 0640 "$ENV_FILE"
  chown root:"$APP_USER" "$ENV_FILE"
  ENV_CHANGED=true
  echo "Configured TZ=Europe/Berlin in $ENV_FILE."
fi

if [[ -n "$previous_commit" && "$previous_commit" == "$current_commit" && "$FORCE_REBUILD" != "true" && "$ENV_CHANGED" != "true" && -f "$APP_DIR/.next/BUILD_ID" && -x "$APP_DIR/mediamtx" ]] && systemctl is-active --quiet onvifscanner.service; then
  echo "ONVIFscanner is already current; skipping dependencies, build and restart."
  exit 0
fi

echo "Stopping onvifscanner.service for rebuild..."
systemctl stop onvifscanner.service || true

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
  process.stdout.write(JSON.stringify({
    dependencies: pkg.dependencies,
    devDependencies: pkg.devDependencies,
    optionalDependencies: pkg.optionalDependencies,
    packageManager: pkg.packageManager,
    lock
  }));
' "$APP_DIR/package.json" "$APP_DIR/package-lock.json" | sha256sum | awk '{print $1}')"
dependency_marker="$state_dir/dependencies.sha256"
installed_hash="$(cat "$dependency_marker" 2>/dev/null || true)"
if [[ -x "$APP_DIR/node_modules/.bin/next" && -x "$APP_DIR/node_modules/.bin/prisma" && "$dependency_hash" == "$installed_hash" ]]; then
  echo "Node dependencies unchanged; skipping npm ci."
else
  runuser -u "$APP_USER" -- bash -lc "export HOME='/home/${APP_USER}' NPM_CONFIG_CACHE='$NPM_CACHE_DIR'; cd '$APP_DIR' && NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false npm ci"
  printf '%s\n' "$dependency_hash" >"$dependency_marker"
  chown "$APP_USER:$APP_USER" "$dependency_marker"
  DEPENDENCIES_CHANGED=true
fi

APP_DIR="$APP_DIR" APP_USER="$APP_USER" bash "$APP_DIR/scripts/debian-lxc/setup-media.sh"

schema_hash="$(sha256sum "$APP_DIR/prisma/schema.prisma" | awk '{print $1}')"
schema_marker="$state_dir/prisma-schema.sha256"
installed_schema_hash="$(cat "$schema_marker" 2>/dev/null || true)"
if [[ "$schema_hash" != "$installed_schema_hash" ]]; then
  runuser -u "$APP_USER" -- bash -lc "export HOME='/home/${APP_USER}' NPM_CONFIG_CACHE='$NPM_CACHE_DIR'; cd '$APP_DIR' && npx prisma generate && npx prisma db push --accept-data-loss"
  printf '%s\n' "$schema_hash" >"$schema_marker"
  chown "$APP_USER:$APP_USER" "$schema_marker"
elif [[ "$DEPENDENCIES_CHANGED" == "true" ]]; then
  runuser -u "$APP_USER" -- bash -lc "export HOME='/home/${APP_USER}' NPM_CONFIG_CACHE='$NPM_CACHE_DIR'; cd '$APP_DIR' && npx prisma generate"
  echo "Database schema unchanged; skipping Prisma migration."
else
  echo "Database schema unchanged; skipping Prisma migration."
fi

runuser -u "$APP_USER" -- bash -lc "export HOME='/home/${APP_USER}' NPM_CONFIG_CACHE='$NPM_CACHE_DIR' NODE_OPTIONS='--max-old-space-size=512'; cd '$APP_DIR' && npm run build"
if [[ "$RUN_NPM_AUDIT" == "true" ]]; then
  echo "Running runtime dependency audit (omit=dev)..."
  runuser -u "$APP_USER" -- bash -lc "export HOME='/home/${APP_USER}' NPM_CONFIG_CACHE='$NPM_CACHE_DIR'; cd '$APP_DIR' && npm audit --omit=dev || true"
fi

echo "Prüfe und sichere Bewegungsempfindlichkeit der Kameras..."
runuser -u "$APP_USER" -- bash -lc "export HOME='/home/${APP_USER}'; cd '$APP_DIR' && node scripts/reset-sensitivity.js" || true

install -m 0755 "$APP_DIR/deploy/onvifscanner-start" /usr/local/bin/onvifscanner-start
if [[ -f "$APP_DIR/deploy/onvifscanner-storage-helper" ]]; then
  install -m 0755 "$APP_DIR/deploy/onvifscanner-storage-helper" /usr/local/bin/onvifscanner-storage-helper
  install -d -m 0755 /usr/local/libexec
  install -m 0755 "$APP_DIR/scripts/debian-lxc/update.sh" /usr/local/libexec/onvifscanner-update
  install -m 0755 "$APP_DIR/deploy/onvifscanner-update-helper" /usr/local/bin/onvifscanner-update-helper
  mkdir -p /etc/sudoers.d
  echo "${APP_USER} ALL=(root) NOPASSWD: /usr/local/bin/onvifscanner-storage-helper, /usr/local/bin/onvifscanner-update-helper" > /etc/sudoers.d/onvifscanner
  chmod 0440 /etc/sudoers.d/onvifscanner
fi
install -m 0644 "$APP_DIR/deploy/onvifscanner.service" /etc/systemd/system/onvifscanner.service
systemctl daemon-reload
systemctl restart --no-block onvifscanner.service
systemctl --no-pager --full --no-ask-password status onvifscanner.service || true
