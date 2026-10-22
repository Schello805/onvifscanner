#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_BIN="$1"
shift
relay_args=()
while IFS= read -r -d '' argument; do
  relay_args+=("$argument")
done < <("$NODE_BIN" "$SCRIPT_DIR/legacy-rtsp-source.js" "$@")

if [[ "${#relay_args[@]}" -eq 0 || "${relay_args[0]:-}" != "ffmpeg" ]]; then
  echo "[Legacy RTSP] Relay-Konfiguration fehlt; MediaMTX übernimmt den Wiederanlauf." >&2
  exit 1
fi

echo "[Legacy RTSP] FFmpeg-Relay startet (PID $$); Video und Audio werden ohne Neukodierung kopiert." >&2
exec "${relay_args[@]}"
