# ONVIFscanner

Local-first Web-App zum Finden von ONVIF- und RTSP-Kameras im eigenen Netzwerk (WS-Discovery + optionaler IP/Port-Scan).

> Hinweis zur Lizenz: Dieses Projekt ist **source-available** zur freien Nutzung **für nicht-kommerzielle Zwecke** (siehe `LICENSE`). Es ist damit **nicht** “Open Source” im OSI-Sinne, auch wenn der Quellcode öffentlich ist.

## Features

- **Premium UI mit DaisyUI**: Hochwertiges, responsives und modernes Dark-Mode-Dashboard (Dracula Theme) mit sauberen Tabellen, Badges und Animationen.
- **Auto-Korrektur von Kamera-IPs**: Behebt das Problem falscher lokaler IPs, die von Kameras in RTSP-Links gemeldet werden.
- **Verlängerte Snapshot-Timeouts**: Vorschaubilder (Thumbnails) laden nun zuverlässiger, auch bei längeren Antwortzeiten der Kameras (Content-Type Toleranz).
- **WS-Discovery (ONVIF)**: Findet ONVIF-Devices per UDP Probe (ohne “/24 bruteforce”).
- **IP/CIDR Scan** (optional): Prüft typische Ports (z. B. 80/443/554/8554/8000/8080).
- **Credential-Test** (optional):
  - RTSP `OPTIONS` mit Basic/Digest (sofern unterstützt).
  - ONVIF `GetDeviceInformation` + Media (WS-Security UsernameToken; zusätzlich HTTP Basic/Digest, sofern verfügbar).
- **Preview (optional)**: ONVIF Snapshot-URI wird abgefragt und als Thumbnail angezeigt (wenn Kamera das unterstützt).
- **Sicherheits-Gating**: Standardmäßig nur private IP-Ranges (RFC1918) scanbar.

## Woher kommen die Streaming-URLs?

Zuverlässige RTSP-Streaming-URLs kommen **nicht** aus dem ONVIF Device-Service-Endpunkt (`/onvif/device_service`), sondern aus dem ONVIF **Media** bzw. **Media2** Service:

- `GetProfiles` → liefert Profile (oft Main/Sub)
- `GetStreamUri` → liefert die RTSP-URL pro Profil
- `GetSnapshotUri` → liefert Snapshot-URL pro Profil

In der UI sind RTSP-URLs deshalb als **RTSP (ONVIF)** markiert. Zusätzlich zeigt die App (optional) **Kandidaten** (typische Vendor-Pfade) als “Vermutung”, weil manche Geräte proprietäre Pfade nutzen.

## Quickstart

Voraussetzungen: Node.js 20+

```bash
npm install
npm run dev
```

Dann im Browser: http://localhost:3000

## Deployment (Debian LXC)

Siehe: `docs/DEPLOY_DEBIAN_LXC.md`

## Konfiguration (Environment)

- `NEXT_PUBLIC_REPO_URL` (optional): URL, die im Header/Footer als “Repo/GitHub” verlinkt wird.
- `ALLOW_PUBLIC_SCAN` (default `false`): Wenn `true`, sind auch öffentliche IP-Ranges im CIDR-Scan erlaubt.
- `SCAN_MAX_HOSTS` (default `4096`): Oberes Limit der Hosts pro Scan-Request.
- `SCAN_CONCURRENCY` (default `128`): Standard-Concurrency beim IP/Port-Scan.
- `SCAN_TIMEOUT_MS` (default `1200`): Default-Timeout pro Socket/FETCH.
- `WS_DISCOVERY_TIMEOUT_MS` (default `1800`): Wartezeit auf WS-Discovery Antworten.
- `ENABLE_THUMBNAILS` (default `true`): Thumbnails via ONVIF Snapshot-URI laden.
- `THUMBNAILS_MAX` (default `12`): Max. Anzahl Thumbnails pro Scan-Response.

## Rechtliches

Die Rechtsdokumente findest du in der App unter:

- `/impressum`
- `/datenschutz`
- `/cookies`

Bitte passe die Platzhalter (Name/Firma/Adresse/Hosting/Analytics etc.) an deine Situation an.

Lizenzhinweis (Required Notice): siehe `NOTICE`.

## Security / Responsible Use

Dieses Tool ist nur für **eigene oder ausdrücklich autorisierte** Netzwerke gedacht. Scans können als Angriff wahrgenommen werden und sind in fremden Netzen ggf. rechtswidrig.

Thumbnails: Wenn aktiviert, werden pro gefundenem ONVIF-Gerät zusätzlich Snapshot-URLs aufgerufen (Image-Download), um eine Vorschau zu zeigen.

## Development Notes

Architektur: `docs/ARCHITECTURE.md`
Troubleshooting: `docs/TROUBLESHOOTING.md`

## Contributing

Siehe `CONTRIBUTING.md`.
