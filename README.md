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
- **Kamera-Wall**: Speichert Scan-Ergebnisse lokal auf dem ONVIFscanner-Server und zeigt die Kameras in einem konfigurierbaren Raster mit Vollbildmodus und automatischer Aktualisierung.
- **Mobile Fokusansicht**: Nutzt auf Smartphones die gesamte verfügbare Fläche, blendet Bedienelemente standardmäßig aus und zeigt Kameranamen als dezentes Overlay.
- **Live-Ansicht**: Wandelt gespeicherte RTSP-Streams über MediaMTX in browserfähiges WebRTC um; ohne Live-Modus bleibt die robuste Snapshot-Aktualisierung aktiv.
- **Bewegungsaufnahme mit Ringpuffer**: Speichert auf Wunsch nur relevante Bewegungsclips inklusive konfigurierbarem Vor- und Nachlauf; eine klassische Daueraufnahme bleibt weiterhin auswählbar.
- **Bewegungsmasken pro Kamera**: Rote Ignorierbereiche lassen sich direkt auf dem Kamerabild einzeichnen, damit etwa Bäume, Straßen oder Zeitstempel keine Aufnahme auslösen.
- **Zentraler Aufnahme-Kalender**: Monatsansicht mit markierten Aufnahmetagen, Clip-Anzahl und direkter Auswahl der an diesem Tag aktiven Kameras.
- **Filterbares Aufnahme-Archiv**: Sortiert Aufnahmen direkt über die Tabellenspalten und filtert nach Kamera, Datum, Uhrzeit, Bewegung, Speicherort, Dateigröße oder Freitext.
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

## Kamera-Wall

Nach einem Scan können einzelne Kameras oder alle Ergebnisse über `+ Wall` bzw. `Alle zur Wall` gespeichert werden. Unter `/wall` stehen anschließend zur Verfügung:

- Raster mit 1 bis 6 Spalten (auf Smartphones automatisch einspaltig)
- Überwachungsmodus im echten Browser-Vollbild ohne App-Header, Footer oder dauerhaft sichtbare Bedienelemente
- automatische Snapshot-Aktualisierung oder manuelles Neuladen
- Bearbeiten von Anzeigename, Snapshot-/Stream-URLs und lokal gespeicherten Zugangsdaten
- Sortieren und Entfernen gespeicherter Kameras

Die Wall-Konfiguration wird lokal auf dem ONVIFscanner-Server in einer SQLite-Datenbank gespeichert. Falls ein Snapshot oder Stream eine Anmeldung benötigt, werden die Zugangsdaten ebenfalls dort gespeichert und nicht an externe Dienste übertragen. RTSP kann ein Browser nicht direkt darstellen; die normale Wall-Ansicht nutzt daher HTTP-Snapshots.

Der Schalter `Live` bereitet den ersten gespeicherten RTSP-Stream serverseitig über MediaMTX auf. Das Installationsskript richtet MediaMTX und `ffmpeg` automatisch ein. Vor dem Start prüft ONVIFscanner den Codec; nicht WebRTC-kompatible Streams wie H.265/HEVC bleiben automatisch in der Snapshot-Ansicht. Auf Smartphones werden zum Schutz vor Decoder- und Verbindungsabbrüchen höchstens vier Live-Streams parallel geöffnet. Für WebRTC muss der Client den LXC zusätzlich über UDP-Port `8189` erreichen können. Die Signalisierung läuft über dieselbe ONVIFscanner-Adresse und funktioniert dadurch auch hinter einem HTTP-Reverse-Proxy.

## Aufnahmemodi

Für jede gespeicherte Kamera kann unter `Aufnahmen` oder direkt beim Bearbeiten der Kamera einer von drei Modi gewählt werden:

- **Aus**: Es werden keine Videodateien geschrieben.
- **Nur Bewegung (empfohlen)**: MediaMTX schreibt kurze Segmente in einen temporären Ringpuffer. Bei einem ONVIF-, Webhook- oder optionalen Bildanalyse-Ereignis werden nur die Segmente vom Vorlauf bis zum Ende des Nachlaufs in das Aufnahme-Archiv übernommen. Nicht benötigte Pufferdaten werden automatisch gelöscht.
- **Daueraufnahme**: Der RTSP-Stream wird wie bisher ohne Unterbrechung in konfigurierbaren Segmenten archiviert.

Standardmäßig nutzt die Bewegungsaufnahme 10 Sekunden Vorlauf und 30 Sekunden Nachlauf. Wiederholte Ereignisse verlängern das persistente Aufnahmefenster automatisch. Nach dem Nachlauf verbindet `ffmpeg` alle zugehörigen Ringpuffer-Segmente verlustfrei zu einem Bewegungsclip. Der temporäre Puffer liegt unter `data/motion-buffer`, Arbeitsdateien unter `data/motion-staging`; nur der fertige Clip wird in das gewählte Speicherziel übernommen. Aufnahmefenster und Ereignis-Zuordnung liegen in SQLite und überstehen dadurch einen Neustart der Anwendung.

Im Kamera-Editor können außerdem rote Ignorierbereiche direkt auf dem Vorschaubild eingezeichnet werden. Die Koordinaten werden proportional gespeichert und funktionieren daher unabhängig von der Analyseauflösung. Sobald eine Kamera eine Maske besitzt, wird ihre Bewegung ausschließlich durch die serverseitige Bildanalyse bewertet, da ONVIF- und Webhook-Ereignisse keine räumlichen Koordinaten für die Maske liefern.

Für Smartphones normalisiert ONVIFscanner neue Bewegungsclips in ein kompatibles MP4/H.264-Format. Falls ein älterer oder kontinuierlich aufgezeichneter Clip vom Browser nicht unterstützt wird, erzeugt die Wiedergabeseite automatisch eine zwischengespeicherte H.264-Version unter `data/playback-cache` und versucht die Wiedergabe erneut.

Unter `Aufnahmen` zeigt jede Kamera außerdem den Zustand ihrer Bewegungsquelle an: aktive ONVIF-PullPoint-Verbindung, Webhook, Snapshot-Fallback, laufende Prüfung oder einen konkreten Fehler. In der Wiedergabe ist jedes Bewegungsereignis direkt mit dem daraus erzeugten Clip verknüpft; die bisherige zeitbasierte Zuordnung bleibt als Fallback für ältere Aufnahmen erhalten.

Der systemd-Dienst startet die Anwendung im Produktionsmodus und startet sie nach einem unerwarteten Ende automatisch neu. Der Endpunkt `/api/health` steht für externe Zustandsprüfungen bereit. Der Kamera-Statusmonitor läuft standardmäßig alle 60 Sekunden. ONVIF-Bewegungsereignisse und Kamera-Webhooks werden unabhängig davon verarbeitet. Für Kameras ohne zuverlässige ONVIF-Ereignisse ist zusätzlich die ressourcenschonende serverseitige Bildanalyse standardmäßig aktiv. Die automatische Netzwerksuche bleibt standardmäßig deaktiviert.

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

Das Update verwendet einen Schnellpfad: Bereits installierte Systempakete, unveränderte npm-Abhängigkeiten und ein unverändertes Prisma-Schema werden übersprungen. Ist Git bereits aktuell, entfallen Build und Service-Neustart vollständig. Für eine erzwungene Neuprüfung und einen sauberen Rebuild:

```bash
FORCE_SYSTEM_PACKAGES=true FORCE_REBUILD=true curl -fsSL https://raw.githubusercontent.com/Schello805/onvifscanner/main/scripts/debian-lxc/auto.sh | bash
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
- `THUMBNAIL_CACHE_TTL_MS` (default `10000`): Kurzzeit-Cache für generierte Vorschaubilder.
- `MOTION_BUFFER_SEGMENT_SECONDS` (default `5`): Länge der temporären Ringpuffer-Segmente für Bewegungsaufnahmen.
- `MOTION_BUFFER_DIR` (default `data/motion-buffer`): Lokales Verzeichnis für den temporären Ringpuffer.
- `MOTION_STAGING_DIR` (default `data/motion-staging`): Arbeitsverzeichnis zum Zusammenführen eines Bewegungsclips.
- `ENABLE_MOTION_DETECTION` (default `true`): Aktiviert die serverseitige Bildanalyse für Kameras ohne kürzlich empfangenes ONVIF-Bewegungsereignis.
- `MOTION_DETECTION_INTERVAL_MS` (default `3000`): Zielintervall der serverseitigen Bildanalyse; laufende Zyklen überlappen sich nicht.
- `MOTION_DETECTION_CONCURRENCY` (default `3`): Maximal parallel analysierte Kamerabilder.
- `MOTION_SOURCE_WIDTH` (default `384`): Breite des frisch geladenen Bildes für die Bewegungserkennung.
- `MOTION_ANALYSIS_WIDTH` (default `256`): Interne Analysebreite; statt der früheren 96 px bleiben dadurch kleine Bewegungen besser sichtbar.
- `MOTION_PIXEL_THRESHOLD`, `MOTION_AREA_THRESHOLD`, `MOTION_MEAN_THRESHOLD`: Optionale Feineinstellung für Pixel-, Flächen- und mittlere Differenzschwelle.
- `NTFY_IMAGE_WIDTH` (default `960`) und `NTFY_IMAGE_QUALITY` (default `82`): Qualität des separat geladenen Alarmbildes für Ntfy.

Hinweis: Thumbnails werden separat nach dem Scan geladen. Wenn kein Bild abrufbar ist, bleibt die Kamera trotzdem in der Ergebnisliste und der Grund steht im Kamera-Log.

## Lizenz

Siehe `LICENSE` und `NOTICE`.

## Nutzung im Heimnetz

Dieses Tool ist für das eigene Heimnetz/LAN gedacht. Standardmäßig akzeptiert der CIDR-Scan nur private IP-Bereiche (RFC1918).

Thumbnails: Wenn aktiviert, werden pro gefundenem ONVIF-Gerät zusätzlich Snapshot-URLs aufgerufen (Image-Download), um eine Vorschau zu zeigen.

## Development Notes

Architektur: `docs/ARCHITECTURE.md`
Troubleshooting: `docs/TROUBLESHOOTING.md`

## Contributing

Siehe `CONTRIBUTING.md`.
