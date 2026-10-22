<p align="center">
  <img src="public/logo.png" alt="ONVIFscanner NVR" width="240">
</p>

# ONVIFscanner NVR

Local-first Web-App zum Finden und Identifizieren von ONVIF-, RTSP- und HTTP/IP-Kameras im eigenen Netzwerk.

> Hinweis zur Lizenz: Dieses Projekt ist **source-available** zur freien Nutzung **für nicht-kommerzielle Zwecke** (siehe `LICENSE`). Es ist damit **nicht** “Open Source” im OSI-Sinne, auch wenn der Quellcode öffentlich ist.

## Features

- **Kiosk- & Wand-Tablet-Modus**: Spezieller Vollbild-Modus für Flur- und Wand-Tablets mit automatischer Display-Wachhaltung (Screen Wake-Lock API), Auto-Pop-up der aktiven Kamera bei erkannter Bewegung mit konfigurierbarem Countdown und intelligentem Bildschirmschoner (Display-Dimmer mit Digitaluhr).
- **Kennzeichen- & Fahrzeugspeicher (LPR)**: Zentrale Verwaltung bekannter Fahrzeuge und Personen. Erkennt bei Kameras mit aktivierter OCR automatisch bekannte Kennzeichen (*„Michaels Auto“*) vs. unbekannte Fahrzeuge, sendet personalisierte Push-Benachrichtigungen und ermöglicht 1-Klick-Übernahme direkt aus dem Protokoll.
- **Web-Push Benachrichtigungen**: Direkte Browser- und Smartphone-Push-Nachrichten (PWA) bei Alarmen ohne externe Dienste wie Telegram oder ntfy; automatische VAPID-Schlüsselverwaltung und Bereinigung inaktiver Abonnements.
- **Konfigurations-Backup & Wiederherstellung**: Kameras, Zugangsdaten, Speicherziele und Einstellungen mit 1-Klick als portables JSON exportieren und wieder einspielen (Merge- und Replace-Modus).
- **Versionsverwaltung & Rollback**: Schnelles Zurücksetzen auf vorherige Release-Versionen per 1-Klick im Web-Interface oder über die CLI (`npm run rollback`), inklusive automatischem SQLite-Datenbank-Backup.
- **Telegram- & ntfy-Alarmierung**: Push-Benachrichtigungen inklusive Live-Vorschaubild bei Bewegungen oder Statuswechseln direkt aufs Smartphone (Bot-Token/Chat-ID für Telegram oder Topic für ntfy).
- **Zweisprachige Oberfläche**: Vollständige Unterstützung für Deutsch und Englisch mit 1-Klick-Umschaltung im Header und in den Einstellungen.
- **Cybersecurity & Zugriffsschutz**: Integriertes AuthGate für Passwort- oder PIN-Schutz der Web-App mit Brute-Force-Sperre, sicherem Session-Cookie und AES-256-GCM-Verschlüsselung gespeicherter Kamera-Passwörter (Zero-Plaintext on Disk).
- **Notfall-Reset via CLI**: Passwort oder PIN jederzeit direkt über die Konsole zurücksetzen oder deaktivieren (`npm run reset-password`).
- **Speichermanagement & NAS-Anbindung**: Lokale Speicheranzeige, 1-Klick-Rechte-Reparatur, Mounten von SMB/CIFS- und NFS-Netzwerkfreigaben direkt in der UI sowie automatische Bereinigung mit Mindest-Pufferschutz und konfigurierbarer Vorhaltezeit (Retention).
- **Interaktive Vorfall-Zeitleiste**: Zoomstufen von 15 Minuten bis 24 Stunden, Mini-Map, Farbmarkierungen für Personen/Fahrzeuge und flüssiges Scrubben durch alle Aufnahmen.
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
- **Flexible Aufnahme-Strategien**: Dauer- und Bewegungsaufnahme lassen sich pro Kamera rund um die Uhr, nur in einem Zeitfenster oder als automatische Kombination konfigurieren.
- **Tageszusammenfassung**: Die Wiedergabe fasst Ereignisse und erkannte Objekte pro Tag und Kamera zusammen.
- **Kamera-Protokoll**: Zeigt mit Zeitstempel, welche Kamera eine Bewegung gemeldet hat oder offline beziehungsweise wieder online gegangen ist.
- **Optionale Status-Pushs**: Meldet Kamera-Wechsel zwischen online und offline auf Wunsch per Telegram und/oder ntfy.
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

## Aufnahme-Strategien

Für jede gespeicherte Kamera wird unter `Aufnahmen` oder direkt beim Bearbeiten genau eine verständliche Strategie gewählt. Ein separater, missverständlicher Zeitprofil-Schalter ist nicht mehr nötig:

- **Aus**: Es werden keine Videodateien geschrieben.
- **Nur Bewegung – immer**: Rund um die Uhr werden nur erkannte Bewegungen gespeichert.
- **Daueraufnahme – immer**: Der RTSP-Stream wird rund um die Uhr in konfigurierbaren Segmenten archiviert.
- **Nur Bewegung – im Zeitfenster**: Innerhalb des Zeitfensters werden Bewegungen gespeichert, außerhalb wird nicht aufgenommen.
- **Daueraufnahme – im Zeitfenster**: Innerhalb des Zeitfensters wird dauerhaft aufgenommen, außerhalb nicht.
- **Im Zeitfenster Bewegung, sonst dauerhaft**: Im Zeitfenster werden nur Bewegungen gespeichert, außerhalb läuft die Daueraufnahme.
- **Im Zeitfenster dauerhaft, sonst Bewegung**: Im Zeitfenster läuft die Daueraufnahme, außerhalb werden nur Bewegungen gespeichert.

Bei allen zeitgesteuerten Strategien werden Start, Ende und Wochentage direkt darunter eingestellt. Zeitfenster über Mitternacht werden unterstützt. Der Monitor setzt einen Strategiewechsel spätestens innerhalb einer Minute um.

Bei einer Bewegungsstrategie schreibt MediaMTX kurze Segmente in einen temporären Ringpuffer. Bei einem ONVIF-, Webhook- oder optionalen Bildanalyse-Ereignis werden nur die Segmente vom Vorlauf bis zum Ende des Nachlaufs in das Aufnahme-Archiv übernommen. Nicht benötigte Pufferdaten werden automatisch gelöscht.

Standardmäßig nutzt die Bewegungsaufnahme 10 Sekunden Vorlauf und 30 Sekunden Nachlauf. Wiederholte Ereignisse verlängern das persistente Aufnahmefenster automatisch. Nach dem Nachlauf verbindet `ffmpeg` alle zugehörigen Ringpuffer-Segmente verlustfrei zu einem Bewegungsclip. Der temporäre Puffer liegt unter `data/motion-buffer`, Arbeitsdateien unter `data/motion-staging`; nur der fertige Clip wird in das gewählte Speicherziel übernommen. Aufnahmefenster und Ereignis-Zuordnung liegen in SQLite und überstehen dadurch einen Neustart der Anwendung.

Im Kamera-Editor können außerdem rote Ignorierbereiche mit einem Pinsel direkt auf das Vorschaubild gemalt und mit dem Radierer wieder entfernt werden. Ein Raster ermöglicht mehrere kleine oder unregelmäßige Masken statt nur eines großen Rechtecks. Die Koordinaten werden proportional gespeichert und funktionieren daher unabhängig von der Analyseauflösung. Sobald eine Kamera eine Maske besitzt, wird ihre Bewegung ausschließlich durch die serverseitige Bildanalyse bewertet, da ONVIF- und Webhook-Ereignisse keine räumlichen Koordinaten für die Maske liefern.

Optional kann pro Kamera die lokale KI-Objekterkennung für Personen, Fahrzeuge und Tiere aktiviert werden. Sie läuft erst nach einer erkannten Bildbewegung in einem separaten Worker und belastet dadurch weder den Webserver noch dauerhaft die CPU. Das Modell wird beim ersten Einsatz geladen; die Auswertung selbst findet vollständig auf dem ONVIFscanner-Server statt. Der Objektfilter arbeitet bewusst fehlersicher: Ist die lokale KI nicht verfügbar oder liefert sie kein ausgewähltes Objekt, entsteht kein ungefilterter Bewegungsalarm. Zeitprofile erlauben zusätzlich Wochentage, auch über Mitternacht laufende Zeitfenster und eine eigene Empfindlichkeit. Masken, Objektfilter, Zeitprofil und Cooldown gelten einheitlich für Serveranalyse, ONVIF- und Webhook-Ereignisse. In der Wiedergabe zeigt die Tageszusammenfassung die Ereignis- und Objektzahlen je Tag.

Die Wiedergabe lädt Aufnahmen als HLS-Stream in sechs Sekunden langen H.264/AAC-Segmenten. Nur angeforderte Abschnitte werden vorbereitet; ein vollständiger 15-Minuten-Clip muss nicht vorab konvertiert oder heruntergeladen werden. Der HLS-Player hält ungefähr 30 Sekunden vor der aktuellen Position und zwölf Sekunden dahinter im Puffer. Bei aktivem Auto-Play lädt ein zweiter, unsichtbarer Player den Anfang der nächsten Aufnahme derselben Kamera vor und übernimmt beim Clipwechsel mit der gewählten Geschwindigkeit. Browser ohne MediaSource-Unterstützung verwenden, soweit verfügbar, den nativen HLS-Player; dessen Puffergröße bestimmt der Browser. Echte Aufnahmelücken und ein zu langsames Speicherziel können weiterhin Unterbrechungen verursachen.

Videosegmente liegen unter `data/playback-cache/segments` und werden wiederverwendet. Maximal zwei Segmente werden gleichzeitig mit je zwei FFmpeg-Threads vorbereitet. Bei neuen Segmenten werden alte Cachedateien nach 24 Stunden bereinigt; über etwa 2 GiB werden zusätzlich die ältesten, mindestens fünf Minuten alten Segmente entfernt. Die Originalaufnahmen und Downloads bleiben unverändert. `npm run test:playback` prüft Zeitzuordnung, Segmentgrenzen und FFmpeg-Ausgabe und benötigt `ffmpeg` und `ffprobe`.

Unter `Aufnahmen` zeigt jede Kamera außerdem den Zustand ihrer Bewegungsquelle an: aktive ONVIF-PullPoint-Verbindung, Webhook, Snapshot-Fallback, laufende Prüfung oder einen konkreten Fehler. In der Wiedergabe ist jedes Bewegungsereignis direkt mit dem daraus erzeugten Clip verknüpft; die bisherige zeitbasierte Zuordnung bleibt als Fallback für ältere Aufnahmen erhalten.

Der systemd-Dienst startet die Anwendung im Produktionsmodus und startet sie nach einem unerwarteten Ende automatisch neu. Der Endpunkt `/api/health` steht für externe Zustandsprüfungen bereit. Der Kamera-Statusmonitor läuft standardmäßig alle 60 Sekunden. ONVIF-Bewegungsereignisse und Kamera-Webhooks werden unabhängig davon verarbeitet. Für Kameras ohne zuverlässige ONVIF-Ereignisse ist zusätzlich die ressourcenschonende serverseitige Bildanalyse standardmäßig aktiv. Die automatische Netzwerksuche bleibt standardmäßig deaktiviert.

## Sicherheit & Zugriffsschutz (Cybersecurity)

ONVIFscanner legt großen Wert auf Datensparsamkeit und robuste Absicherung im LAN:

- **AuthGate (App-Passwort & PIN)**:
  - In den Einstellungen (`/settings`) kann ein Master-Passwort oder eine PIN aktiviert werden.
  - Sobald aktiv, schützt ein Anmeldedialog den Zugriff auf Kameras, Streams, Wall, Einstellungen und Aufnahmen.
  - Sichere Session-Cookies (`HttpOnly`, `SameSite=Lax`, mit 30 Tagen Gültigkeit).
  - Progressive Sperre (Brute-Force-Schutz): Nach mehreren Fehlversuchen wird der Login temporär gesperrt.
- **Passwort-Verschlüsselung auf der Festplatte (Zero Plaintext)**:
  - Alle für Kameras hinterlegten Passwörter werden vor dem Speichern in der SQLite-Datenbank mit **AES-256-GCM** verschlüsselt.
  - Der Verschlüsselungsschlüssel wird automatisch generiert und geschützt unter `data/security.json` verwaltet.
- **CSRF- & SSRF-Schutz**:
  - Strenges Origin-Gating für alle mutierenden API-Endpunkte (POST/PUT/DELETE).
  - Validierung lokaler IP-Bereiche verhindert unberechtigte Zugriffe auf externe Netze.
- **Path-Traversal-Schutz**:
  - Alle Dateizugriffe (Clips, Snapshots, Puffer) werden strikt auf erlaubte Zielverzeichnisse begrenzt.
- **HTTP Security Header**:
  - Automatische Header wie `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN` und restriktive Berechtigungsrichtlinien.

### Notfall-Reset des App-Passworts

Solltest du das App-Passwort oder die PIN einmal vergessen haben oder ausgesperrt sein, kannst du den Schutz direkt über die Shell auf dem Server (z. B. im Proxmox Debian LXC) zurücksetzen:

```bash
# Interaktives Tool aufrufen (im Projektverzeichnis):
npm run reset-password

# Oder direkt via Node:
node scripts/reset-password.js
```

Das Skript erlaubt es dir, das Passwort direkt im Terminal neu zu vergeben, den Schutz vollständig zu deaktivieren oder die Dateiberechtigungen der Konfiguration zu reparieren. Alternativ kann die Datei `data/security.json` gelöscht werden, um den Auth-Schutz manuell zu entfernen.

## Speichermanagement, NAS & Notfall-Schutz

Unter `/nvr/storage` (bzw. über das Menü "Speicher") bietet ONVIFscanner vollständige Kontrolle über lokale und entfernte Speichermedien:

- **Echtzeit-Speicheranzeige**:
  - Zeigt den aktuellen Speicherplatz, belegten und freien Platz in Gigabyte sowie Prozent an.
- **NAS & Netzlaufwerke (SMB/CIFS & NFS)**:
  - Freigaben von Synology, QNAP, TrueNAS oder Linux-Servern können direkt über die Weboberfläche eingebunden werden – ganz ohne manuelles Hantieren im Terminal.
  - Automatische Integration in `/etc/fstab` für persistente Mounts auch nach einem Server-Neustart.
- **1-Klick-Rechte-Reparatur**:
  - Repariert Dateiberechtigungen (`0775`) und Eigentümer (`onvifscanner:onvifscanner`), falls ein Netzlaufwerk oder USB-Datenträger Schreibprobleme verursacht.
- **Automatischer Notfall-Pufferschutz & Retention**:
  - **Mindest-Freispeicher (Buffer)**: Garantiert, dass z. B. immer mindestens 5 GB freier Speicherplatz auf der Partition verbleiben. Fällt der freie Speicher darunter, löscht das System automatisch die ältesten Videosegmente.
  - **Vorhaltezeit (Tage)**: Begrenzt die Lebensdauer von Aufnahmen (z. B. maximal 14 oder 30 Tage gemäß DSGVO).
  - **Ordner-Hygiene**: Automatische Bereinigung verwaister temporärer Ringpuffer- und Staging-Dateien.

## Interaktive Zeitleiste & Vorfall-Prüfung

Unter `/timeline` steht eine intuitive Zeitleiste für die Überprüfung aller Überwachungsaufnahmen bereit:

- **Flexible Zoomstufen**: Umschalten zwischen 15 Minuten, 30 Minuten, 1 Stunde, 3 Stunden, 6 Stunden, 12 Stunden und 24 Stunden.
- **Visuelle Mini-Map**: Zeigt den gesamten Tagesverlauf auf einen Blick mit direkter Sprungfunktion zu auffälligen Ereignissen.
- **Farbcodierung**: Aufnahmen mit erkannten Personen, Fahrzeugen oder reinen Bewegungsereignissen sind farblich hervorgehoben.
- **Flüssiges Scrubben**: Direktes Spulen und präzise Zeitpunktauswahl synchronisiert mit der Videowiedergabe.
- **Kamera-Filter**: Einzelne Kameras gezielt isolieren oder die Gesamtsituation im Überblick betrachten.

## Zweisprachige Oberfläche (Deutsch & Englisch)

ONVIFscanner unterstützt Deutsch und Englisch vollständig:
- Schnellumschaltung direkt über das Sprach-Symbol (DE/EN) im Header oder in den Einstellungen.
- Alle Navigationselemente, Einstellungen, Kalender, Tageszusammenfassungen, Speicherstatistiken und Dialoge passen sich sofort an.
- Datums- und Zeitformate sowie Monatsnamen im Archiv und in der Zeitleiste werden automatisch in der gewählten Sprache formatiert.

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

## Updates & Versions-Rollback

ONVIFscanner nutzt offizielle Git-Tags und GitHub-Releases (`v0.16.0`, `v0.15.14`, etc.). Sollte ein Update unerwartet Probleme bereiten, kann jederzeit auf eine vorherige Version zurückgesetzt werden.

### 1-Klick Update & Rollback (Web-Oberfläche)
Im Footer zeigt die Versionsanzeige (z. B. `Rev. v0.16.0`) den aktuellen Versionsstatus an:
- **1-Klick Update:** Aktualisiert auf die neueste Version von GitHub.
- **Rollback / Version wechseln:** Aus einem Dropdown kann direkt eine beliebige vorherige Release-Version (oder `main`) ausgewählt und per Klick aktiviert werden.
- **Automatisches Datenbank-Backup:** Vor jedem Update oder Rollback wird die SQLite-Datenbank automatisch gesichert (`data/onvifscanner.db.backup-*`).

### Rollback über das Terminal (CLI)
Sollte die Web-App nach einem fehlerhaften Stand nicht mehr erreichbar sein, steht ein interaktives CLI-Tool bereit:

```bash
# Interaktives Rollback-Menü (zeigt die letzten Tags zur Auswahl):
npm run rollback

# Oder direkt mit Zielversion aufrufen:
npm run rollback v0.15.14
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
- `MOTION_SOURCE_WIDTH` (default `768`): Breite des nur bei erkannter Bewegung nachgeladenen Detailbildes für Objekterkennung und Benachrichtigung.
- `MOTION_PIXEL_THRESHOLD`, `MOTION_AREA_THRESHOLD`, `MOTION_MEAN_THRESHOLD`: Optionale Feineinstellung für Pixel-, Flächen- und mittlere Differenzschwelle.
- `ENABLE_OBJECT_DETECTION` (default `true`): Erlaubt die pro Kamera aktivierbare lokale Person-/Fahrzeug-/Tiererkennung.
- `OBJECT_DETECTION_MODEL_BASE` (default `mobilenet_v2`): Qualitätsstufe der lokalen COCO-SSD-Erkennung. `lite_mobilenet_v2` reduziert CPU-Last, erkennt kleine Objekte aber ungenauer.
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
