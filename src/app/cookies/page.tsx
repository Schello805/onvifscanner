export default function CookiesPage() {
  return (
    <article className="prose prose-invert max-w-none">
      <h1>Cookiehinweis</h1>
      <p>
        Diese Anwendung setzt standardmäßig keine Tracking-Cookies. Je nach
        Hosting/Setup können technisch notwendige Cookies durch das Framework
        oder einen Reverse Proxy entstehen (z. B. Session/CSRF in Erweiterungen).
      </p>
      <h2>Technisch notwendige Cookies</h2>
      <p>
        Falls du Authentifizierung oder Persistenz ergänzt, dokumentiere hier
        Zweck, Speicherdauer und Rechtsgrundlage.
      </p>
    </article>
  );
}

