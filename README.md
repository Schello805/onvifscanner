<p align="center">
  <img src="public/logo.png" alt="ONVIFscanner NVR" width="240">
</p>

# ONVIFscanner NVR

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
- **Kontextbezogene Kamerasteuerung**: Zeigt Live- und Aktionsschaltflächen nur beim Antippen beziehungsweise per Desktop-Hover; seltene Aktionen liegen platzsparend im Drei-Punkte-Menü.
- **Live-Ansicht**: Wandelt gespeicherte RTSP-Streams über MediaMTX in browserfähiges WebRTC um; ohne Live-Modus bleibt die robuste Snapshot-Aktualisierung aktiv.
- **Bewegungsaufnahme mit Ringpuffer**: Speichert auf Wunsch nur relevante Bewegungsclips inklusive konfigurierbarem Vor- und Nachlauf; eine klassische Daueraufnahme bleibt weiterhin auswählbar.
- **Bewegungsmasken pro Kamera**: Beliebig geformte rote Ignorierbereiche lassen sich mit einem Pinsel direkt auf das Kamerabild malen, damit etwa Bäume, Straßen oder Zeitstempel keine Aufnahme auslösen.
- **Lokale Objekterkennung**: Optional bestätigt ein lokales COCO-SSD-Modell Bewegungen als Person, Fahrzeug oder Tier, ohne Kamerabilder an einen KI-Dienst zu senden.
- **Zeitprofile pro Kamera**: Wochentage, Start-/Endzeit und eine eigene Empfindlichkeit begrenzen Bewegungserkennung und Aufnahmen auf gewünschte Zeitfenster.
- **Tageszusammenfassung**: Die Wiedergabe fasst Ereignisse und erkannte Objekte pro Tag und Kamera zusammen.
- **Kamera-Protokoll**: Zeigt mit Zeitstempel, welche Kamera eine Bewegung gemeldet hat oder offline beziehungsweise wieder online gegangen ist.
- **Optionale Status-Pushs**: Meldet Kamera-Wechsel zwischen online und offline auf Wunsch zusätzlich über das konfigurierte ntfy-Topic.
- **Zentraler Aufnahme-Kalender**: Monatsansicht mit markierten Aufnahmetagen, Clip-Anzahl und direkter Auswahl der an diesem Tag aktiven Kameras.
- **Gestengesteuerte Wiedergabe**: Doppeltippen links oder rechts springt zehn Sekunden, längeres Halten spult schnell; weitere Player-Funktionen bleiben in einem kompakten Optionsbereich verborgen.
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

Im Kamera-Editor können außerdem rote Ignorierbereiche mit einem Pinsel direkt auf das Vorschaubild gemalt und mit dem Radierer wieder entfernt werden. Ein Raster ermöglicht mehrere kleine oder unregelmäßige Masken statt nur eines großen Rechtecks. Die Koordinaten werden proportional gespeichert und funktionieren daher unabhängig von der Analyseauflösung. Sobald eine Kamera eine Maske besitzt, wird ihre Bewegung ausschließlich durch die serverseitige Bildanalyse bewertet, da ONVIF- und Webhook-Ereignisse keine räumlichen Koordinaten für die Maske liefern.

Optional kann pro Kamera die lokale KI-Objekterkennung für Personen, Fahrzeuge und Tiere aktiviert werden. Sie läuft erst nach einer erkannten Bildbewegung in einem separaten Worker und belastet dadurch weder den Webserver noch dauerhaft die CPU. Das Modell wird beim ersten Einsatz geladen; die Auswertung selbst findet vollständig auf dem ONVIFscanner-Server statt. Der Objektfilter arbeitet bewusst fehlersicher: Ist die lokale KI nicht verfügbar oder liefert sie kein ausgewähltes Objekt, entsteht kein ungefilterter Bewegungsalarm. Zeitprofile erlauben zusätzlich Wochentage, auch über Mitternacht laufende Zeitfenster und eine eigene Empfindlichkeit. Masken, Objektfilter, Zeitprofil und Cooldown gelten einheitlich für Serveranalyse, ONVIF- und Webhook-Ereignisse. In der Wiedergabe zeigt die Tageszusammenfassung die Ereignis- und Objektzahlen je Tag.

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

Ab Version `0.13.2` installiert das LXC-Skript außerdem einen eng begrenzten systemd-Helper für den **1-Klick-Update-Button** im Footer. Bei einer älteren Installation muss das Update auf `0.13.2` einmalig mit dem obigen Terminal-Befehl erfolgen; danach können weitere Updates direkt in der Oberfläche gestartet werden.

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
- `ENABLE_MOTION_DETECTION` (default `true`): Aktiviert die serverseitige Bildanalyse für Kameras ohne gesunde ONVIF-Ereignisquelle.
- `MOTION_DETECTION_INTERVAL_MS` (default `3000`): Zielintervall der serverseitigen Bildanalyse; laufende Zyklen überlappen sich nicht.
- `MOTION_DETECTION_CONCURRENCY` (default `2`): Maximal parallel analysierte Kamerabilder; kleinere Werte begrenzen CPU-Spitzen.
- `MOTION_CONFIRMATION_FRAMES` (default `2`): Anzahl aufeinanderfolgender Bilder, in denen eine Änderung bestehen muss; reduziert kurze Bildfehler und Fehlalarme.
- `MOTION_ANALYSIS_WIDTH` (default `192`): Breite der CPU-schonenden Graustufen-Bewegungsanalyse.
- `MOTION_SOURCE_WIDTH` (default `640`): Breite des nur bei erkannter Bewegung nachgeladenen Detailbildes für Objekterkennung und Benachrichtigung.
- `MOTION_PIXEL_THRESHOLD`, `MOTION_AREA_THRESHOLD`, `MOTION_MEAN_THRESHOLD`: Optionale Feineinstellung für Pixel-, Flächen- und mittlere Differenzschwelle.
- `ENABLE_OBJECT_DETECTION` (default `true`): Erlaubt die pro Kamera aktivierbare lokale Person-/Fahrzeug-/Tiererkennung.
- **Lokale Kennzeichenerkennung:** Im Kamera-Dialog optional pro Kamera aktivierbar. Nach bestätigter Bewegung wird nur bei einem erkannten Fahrzeug die lokale Tesseract-OCR gestartet. Die Bewegungsmaske gilt auch für OCR, erkannte Kennzeichen erscheinen strukturiert im Protokoll und Bilder werden nicht an einen Cloud-Dienst übertragen.
- `OBJECT_DETECTION_MODEL_URL` (optional): Eigene lokale oder erreichbare URL für das COCO-SSD-Modell. Ohne Angabe wird beim ersten Einsatz das Standardmodell geladen; Kamerabilder verlassen den Server nicht.
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
