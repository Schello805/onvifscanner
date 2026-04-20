# Deployment: Debian LXC

Diese Anleitung installiert ONVIFscanner in einem Debian-LXC-Container als systemd Service.

## Voraussetzungen

- Debian 12 (bookworm) empfohlen
- Container hat Netzwerkkonnektivität ins LAN (Bridge)
- Für **WS-Discovery** (ONVIF) muss Multicast im Netz/Container funktionieren:
  - UDP 3702 / Multicast `239.255.255.250`
  - Oft funktioniert Discovery nur im gleichen L2 Segment (LAN/VLAN)

## Install (one-liner)

Als root im Container:

```bash
apt-get update -y && apt-get install -y ca-certificates curl
curl -fsSL https://raw.githubusercontent.com/Schello805/onvifscanner/main/scripts/debian-lxc/install.sh | bash
```

Danach läuft der Service standardmäßig auf `127.0.0.1:3000`.

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

## Reverse Proxy (nginx, optional)

```bash
apt-get install -y nginx
cp /opt/onvifscanner/deploy/nginx-onvifscanner.conf /etc/nginx/sites-available/onvifscanner
ln -sf /etc/nginx/sites-available/onvifscanner /etc/nginx/sites-enabled/onvifscanner
nginx -t && systemctl reload nginx
```

## Update

```bash
curl -fsSL https://raw.githubusercontent.com/Schello805/onvifscanner/main/scripts/debian-lxc/update.sh | bash
```

## Logs

```bash
journalctl -u onvifscanner -f
```

