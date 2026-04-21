# Deployment: Debian LXC

Diese Anleitung installiert ONVIFscanner in einem Debian-LXC-Container als systemd Service.

## Voraussetzungen

- Debian 12 (bookworm) empfohlen
- systemd im Container aktiv (Standard bei Debian-LXC, sonst Container-Template/Config prüfen)
- Container hat Netzwerkkonnektivität ins LAN (Bridge)
- Für **WS-Discovery** (ONVIF) muss Multicast im Netz/Container funktionieren:
  - UDP 3702 / Multicast `239.255.255.250`
  - Oft funktioniert Discovery nur im gleichen L2 Segment (LAN/VLAN)

## Requirements (Pakete)

ONVIFscanner ist eine Next.js App. Für den Build/Start werden benötigt:

- Node.js **20+**
- `git`, `curl`, `ca-certificates`
- Für `sharp`/native Dependencies (je nach Architektur): Build-Tools + `libvips`

Auf einem „blanken“ Debian 12:

```bash
apt-get update -y
apt-get install -y --no-install-recommends \
  ca-certificates curl git gnupg \
  build-essential python3 make g++ pkg-config \
  libvips
```

Hinweis: Auf amd64 klappt `sharp` meist mit prebuilt Binaries ohne `libvips`, auf arm64/anderen Setups ist `libvips` + Build-Toolchain oft nötig.

## Install (one-liner)

Als root im Container:

```bash
apt-get update -y && apt-get install -y ca-certificates curl
curl -fsSL https://raw.githubusercontent.com/Schello805/onvifscanner/main/scripts/debian-lxc/auto.sh | bash
```

Danach läuft der Service standardmäßig auf `127.0.0.1:3000`.

### Was macht das Install-Script?

- installiert Node.js 20 (via NodeSource)
- legt User `onvifscanner` an
- cloned nach `/opt/onvifscanner`
- `npm ci` → `npm run build` → `npm prune --omit=dev`
- installiert systemd service `onvifscanner.service`
- legt eine Env-Datei an: `/etc/onvifscanner/onvifscanner.env`

## Konfiguration

Env-Datei:

- `/etc/onvifscanner/onvifscanner.env`

Wichtige Werte:

- `HOST` / `PORT` (Bind-Adresse/Port)
- `ALLOW_PUBLIC_SCAN` (default `false`)
- `ENABLE_THUMBNAILS` (default `true`)

Service neu starten:

```bash
systemctl restart onvifscanner
```

## Zugriff von außen (LXC / LAN)

Standard ist `HOST=127.0.0.1` (nur im Container erreichbar). Wenn du im LAN zugreifen willst:

1) in `/etc/onvifscanner/onvifscanner.env` setzen:

```bash
HOST=0.0.0.0
PORT=3000
```

2) Service neu starten:

```bash
systemctl restart onvifscanner
```

3) Dann aufrufen: `http://<LXC-IP>:3000`

Empfehlung: Für „schön“ und TLS nutze nginx als Reverse Proxy (siehe unten).

## Reverse Proxy (nginx, optional)

```bash
apt-get install -y nginx
cp /opt/onvifscanner/deploy/nginx-onvifscanner.conf /etc/nginx/sites-available/onvifscanner
ln -sf /etc/nginx/sites-available/onvifscanner /etc/nginx/sites-enabled/onvifscanner
nginx -t && systemctl reload nginx
```

## Update

```bash
curl -fsSL https://raw.githubusercontent.com/Schello805/onvifscanner/main/scripts/debian-lxc/auto.sh | bash
```

## Update (ohne Script, manuell)

```bash
cd /opt/onvifscanner
git fetch --all --prune
git checkout -f main
git pull --ff-only
npm ci
npm run build
npm prune --omit=dev
systemctl restart onvifscanner
```

## Logs

```bash
journalctl -u onvifscanner -f
```

## Troubleshooting

- **WS-Discovery findet nichts:** Multicast/UDP 3702 kommt im Container nicht an (häufig bei VLAN/Bridges/Firewall). Workaround: in der App auf **CIDR Scan** wechseln.
- **Port 3000 nicht erreichbar:** Prüfe `HOST` in `/etc/onvifscanner/onvifscanner.env` (für LAN: `0.0.0.0`).
- **Build bricht bei `sharp` ab:** installiere `build-essential` + `libvips` (siehe Requirements oben) und starte `update.sh`/Build erneut.
