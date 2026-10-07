#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/onvifscanner}"
APP_USER="${APP_USER:-onvifscanner}"
MEDIAMTX_VERSION="${MEDIAMTX_VERSION:-1.9.0}"

case "$(uname -m)" in
  x86_64) media_arch="amd64" ;;
  aarch64|arm64) media_arch="arm64v8" ;;
  armv7*) media_arch="armv7" ;;
  *)
    echo "Unsupported architecture for MediaMTX: $(uname -m)" >&2
    exit 1
    ;;
esac

if [[ ! -x "$APP_DIR/mediamtx" ]]; then
  echo "Downloading MediaMTX v${MEDIAMTX_VERSION} (${media_arch})..."
  archive="$APP_DIR/mediamtx.tar.gz"
  curl -fL "https://github.com/bluenviron/mediamtx/releases/download/v${MEDIAMTX_VERSION}/mediamtx_v${MEDIAMTX_VERSION}_linux_${media_arch}.tar.gz" -o "$archive"
  tar -xzf "$archive" -C "$APP_DIR" mediamtx
  rm -f "$archive"
fi

if [[ ! -f "$APP_DIR/mediamtx.yml" ]]; then
  cat >"$APP_DIR/mediamtx.yml" <<'EOF'
api: yes
apiAddress: 127.0.0.1:9997
webrtc: yes
webrtcAddress: :8889
rtsp: no
rtmp: no
hls: no
EOF
fi

chmod 0755 "$APP_DIR/mediamtx"
chown "$APP_USER:$APP_USER" "$APP_DIR/mediamtx" "$APP_DIR/mediamtx.yml"
