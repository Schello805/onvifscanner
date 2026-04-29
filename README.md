# ONVIFscanner

Local-first Web-App zum Finden und Identifizieren von ONVIF-, RTSP- und HTTP/IP-Kameras im eigenen Netzwerk.

> Hinweis zur Lizenz: Dieses Projekt ist **source-available** zur freien Nutzung **für nicht-kommerzielle Zwecke** (siehe `LICENSE`). Es ist damit **nicht** “Open Source” im OSI-Sinne, auch wenn der Quellcode öffentlich ist.

## Features

- **Ein-Klick Auto-Scan**: Kombiniert WS-Discovery, IP/CIDR-Portscan und Hersteller-Profile automatisch.
- **Kamera-Identifikation**: Ermittelt Hersteller, Modell und Hostname per ONVIF, Vendor-API und Reverse-DNS soweit verfügbar.
- **Stream- & Snapshot-URLs**: Sammelt bestätigte RTSP-, HTTP-Stream- und Snapshot-URLs und bietet Kopieren per Klick.
- **Hersteller-Profile**: Unterstützt u. a. Hikvision/HiLook/Annke, Reolink, Dahua/Amcrest/Imou, Axis, Uniview, Geutebrück, Foscam/Instar und TP-Link Tapo/VIGI.
- **False-Positive-Filter**: Reine HTTP-Geräte werden im Auto-Scan nicht automatisch als Kamera angezeigt.
- **Responsive UI**: Desktop-Tabelle und Smartphone-Kartenlayout für bessere Bedienung unterwegs.
- **Auto-Korrektur von Kamera-IPs**: Behebt das Problem falscher lokaler IPs, die von Kameras in RTSP-Links gemeldet werden.
- **Vorschaubilder**: Lädt Snapshot-Bilder über einen Thumbnail-Proxy mit Basic/Digest-Unterstützung und begrenzter Parallelität.
- **Verständliche Logs**: Pro Kamera gibt es einen Kurzstatus plus optionales technisches Log zur URL-/Auth-Erkennung.
- **Heimnetz-Gating**: Standardmäßig nur private IP-Ranges (RFC1918) scanbar.

## Wie funktioniert der Auto-Scan?

Der normale Workflow ist bewusst einfach:

1. Suchbereich eintragen, z. B. `192.168.1.0/24`.
2. Optional Benutzername/Passwort für die Kameras eintragen.
3. `Scan Starten` klicken.

Die App kombiniert danach automatisch:

- **WS-Discovery** für ONVIF-Geräte.
- **CIDR/Portscan** für typische Kamera-Ports wie `80`, `443`, `554`, `8554`, `8000`, `8080`, `8899`.
- **ONVIF Media-Abfragen** für echte RTSP-/Snapshot-URLs.
- **Hersteller-Profile** für Kameras, die proprietäre Pfade nutzen.
- **Reverse-DNS / ONVIF Hostname / Vendor-Hostname** zur besseren Identifikation.

Die erweiterten Scan-Einstellungen sind eingeklappt, weil sie im Normalfall nicht geändert werden müssen.

## Woher kommen die Streaming-URLs?

Zuverlässige RTSP-Streaming-URLs kommen **nicht** aus dem ONVIF Device-Service-Endpunkt (`/onvif/device_service`), sondern aus dem ONVIF **Media** bzw. **Media2** Service:

- `GetProfiles` → liefert Profile (oft Main/Sub)
- `GetStreamUri` → liefert die RTSP-URL pro Profil
- `GetSnapshotUri` → liefert Snapshot-URL pro Profil

Zusätzlich prüft ONVIFscanner bekannte Herstellerpfade, z. B. Hikvision:

- Snapshot Main: `/ISAPI/Streaming/channels/101/picture`
- Snapshot Sub: `/ISAPI/Streaming/channels/102/picture`
- RTSP Main: `/Streaming/Channels/101`
- RTSP Sub: `/Streaming/Channels/102`

Wenn eine Kamera Authentifizierung verlangt, können die Zugangsdaten im UI eingetragen werden. Beim Kopieren können Credentials optional direkt an die URL angehängt werden.

## Quickstart

Voraussetzungen: Node.js 20+

```bash
npm install
npm run dev
```

Dann im Browser: http://localhost:3000

## Deployment (Debian LXC)

Schritt-für-Schritt inkl. Requirements (Node 20+, Build-Tools, `libvips` für `sharp`), systemd Service, Reverse Proxy und Updates:

Siehe: `docs/DEPLOY_DEBIAN_LXC.md`

Schnellinstallation/Update:

```bash
curl -fsSL https://raw.githubusercontent.com/Schello805/onvifscanner/main/scripts/debian-lxc/auto.sh | bash
```

## Konfiguration (Environment)

- `NEXT_PUBLIC_REPO_URL` (optional): URL, die im Header/Footer als “Repo/GitHub” verlinkt wird.
- `ALLOW_PUBLIC_SCAN` (default `false`): Wenn `true`, sind auch öffentliche IP-Ranges im CIDR-Scan erlaubt.
- `SCAN_MAX_HOSTS` (default `4096`): Oberes Limit der Hosts pro Scan-Request.
- `SCAN_CONCURRENCY` (default `128`): Standard-Concurrency beim IP/Port-Scan.
- `SCAN_TIMEOUT_MS` (default `1200`): Default-Timeout pro Socket/FETCH.
- `WS_DISCOVERY_TIMEOUT_MS` (default `1800`): Wartezeit auf WS-Discovery Antworten.
- `SCAN_VENDOR_MAX_DEVICES` (optional): Begrenzung der Vendor-/URL-Prüfung pro Scan.
- `VENDOR_PROBE_CAMERA_BUDGET_MS` (default `2500`): Zeitbudget pro Kamera für Hersteller-/URL-Prüfung.
- `THUMBNAIL_MAX_CONCURRENCY` (default `2`): Max. parallele Thumbnail-Requests.
- `THUMBNAIL_SHARP_CONCURRENCY` (default `2`): `sharp`/libvips Parallelität.
- `THUMBNAIL_CACHE_TTL_MS` (default `30000`): Kurzzeit-Cache für generierte Vorschaubilder.

Hinweis: Thumbnails werden separat nach dem Scan geladen. Wenn kein Bild abrufbar ist, bleibt die Kamera trotzdem in der Ergebnisliste und der Grund steht im Kamera-Log.

## Rechtliches

Die Rechtsdokumente findest du in der App unter:

- `/impressum`
- `/datenschutz`
- `/cookies`

Bitte passe die Platzhalter (Name/Firma/Adresse/Hosting/Analytics etc.) an deine Situation an.

Lizenzhinweis (Required Notice): siehe `NOTICE`.

## Nutzung im Heimnetz

Dieses Tool ist für das eigene Heimnetz/LAN gedacht. Standardmäßig akzeptiert der CIDR-Scan nur private IP-Bereiche (RFC1918).

Thumbnails: Wenn aktiviert, werden pro gefundenem ONVIF-Gerät zusätzlich Snapshot-URLs aufgerufen (Image-Download), um eine Vorschau zu zeigen.

## Development Notes

Architektur: `docs/ARCHITECTURE.md`
Troubleshooting: `docs/TROUBLESHOOTING.md`

## Contributing

Siehe `CONTRIBUTING.md`.
