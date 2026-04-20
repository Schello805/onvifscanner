export default function DatenschutzPage() {
  return (
    <article className="prose prose-invert max-w-none">
      <h1>Datenschutzerklärung</h1>
      <p>
        Vorlage – bitte anpassen. Diese App ist “local-first”: Der Scan passiert
        auf dem Server, den du selbst betreibst (z. B. lokal auf deinem Rechner
        oder in deinem LAN).
      </p>

      <h2>Verantwortlicher</h2>
      <p>
        Name / Firma
        <br />
        Adresse
        <br />
        E-Mail
      </p>

      <h2>Welche Daten werden verarbeitet?</h2>
      <ul>
        <li>
          Scan-Ziele (CIDR / WS-Discovery) und technische Metadaten (IP, Ports,
          ONVIF Endpoints), um Geräte im Netzwerk zu erkennen.
        </li>
        <li>
          Optional eingegebene Zugangsdaten (Username/Passwort) werden nur für
          den konkreten Scan verwendet und nicht gespeichert.
        </li>
      </ul>

      <h2>Zweck der Verarbeitung</h2>
      <p>Erkennen und Inventarisieren von ONVIF/RTSP Geräten im Netzwerk.</p>

      <h2>Speicherdauer</h2>
      <p>
        Standardmäßig keine dauerhafte Speicherung der Scan-Ergebnisse auf dem
        Server (nur während der Anfrage). Bitte prüfe deine Hosting-/Server-Logs
        (z. B. Reverse Proxy), falls vorhanden.
      </p>
    </article>
  );
}

