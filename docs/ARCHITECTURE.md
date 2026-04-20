# Architektur

## Überblick

Next.js (App Router) liefert UI + API:

- UI: `src/app/page.tsx`
- API: `src/app/api/scan/route.ts`
- Scanner/Protokolle: `src/lib/*`

## Scan-Modi

1. **WS-Discovery (ONVIF)**
   - UDP Probe an Multicast 239.255.255.250:3702
   - Antworten enthalten i. d. R. `XAddrs` (HTTP Endpoints)

2. **CIDR/Port Scan**
   - Expandiert CIDR in IPv4 Hosts
   - TCP connect() auf Ports, dann Probing (RTSP/HTTP)

## Sicherheitsprinzipien

- Default: nur private IP-Ranges (RFC1918) erlauben
- Begrenzung: Max Hosts pro Request + Default Timeouts
- Keine Speicherung von Credentials (nur Request-scope)

