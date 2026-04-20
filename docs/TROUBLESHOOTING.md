# Troubleshooting

## WS-Discovery findet keine Geräte

- Stelle sicher, dass Server und Kamera im **gleichen Layer-2 Segment** sind (LAN/VLAN). Multicast wird oft nicht geroutet.
- Prüfe Firewall/Filter (UDP Port **3702**, Multicast **239.255.255.250**).
- Manche Kameras haben ONVIF/Discovery deaktiviert.

## CIDR-Scan ist langsam

- Reduziere die CIDR-Größe (z. B. `/24` statt `/16`)
- Reduziere Ports oder Concurrency
- Erhöhe `SCAN_TIMEOUT_MS` nur bei Bedarf

## RTSP “Nein” obwohl Stream funktioniert

- Viele Geräte benötigen eine konkrete RTSP-Path-URL (z. B. `/stream1`). Dieser Scanner prüft bewusst nur “leichtgewichtig” per `OPTIONS`.
- Auth kann Basic oder Digest sein; manche Implementierungen sind proprietär oder reagieren nur auf `DESCRIBE`.

## ONVIF Probe “HTTP 401” oder “HTTP 400”

- Viele Geräte nutzen HTTP Digest. Wenn Digest scheitert, teste im Browser/Onvif Device Manager, ob Credentials korrekt sind.
- Manche Geräte erwarten zusätzliche SOAP-Header oder andere Endpoints.

## Dev-Server Fehler: "Cannot find module './###.js'"

Das ist meist ein korrupter Next.js Cache unter `.next/` (z. B. nach abgebrochenen Builds oder Hot-Reload).

Fix:

```bash
rm -rf .next
npm run dev
```

oder:

```bash
npm run dev:clean
```

Ab v0.2.5 nutzt `npm run dev` einen **separaten** Build-Ordner (`.next-dev`), damit sich `next build` (Produktion) und `next dev` nicht gegenseitig kaputt machen.
