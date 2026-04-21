import { fetchWithDigestAuth } from "@/lib/http/digestFetch";
import { buildWsseSecurityHeader } from "@/lib/onvif/wsse";
import crypto from "node:crypto";

export async function onvifSoapCall(args: {
  url: string;
  action: string;
  body: string;
  timeoutMs: number;
  credentials?: { username: string; password: string };
}): Promise<{ ok: boolean; status: number; text: string; soap: "1.2" | "1.1" }> {
  const wsse =
    args.credentials?.username
      ? buildWsseSecurityHeader({
          username: args.credentials.username,
          password: args.credentials.password
        })
      : undefined;
  const wsa = buildWsAddressingHeader({ action: args.action, to: args.url });

  // Try SOAP 1.2 first.
  const env12 = buildSoapEnvelope({
    soapNs: "http://www.w3.org/2003/05/soap-envelope",
    body: args.body,
    wsse,
    wsa
  });
  const res12 = await fetchWithDigestAuth({
    url: args.url,
    method: "POST",
    timeoutMs: args.timeoutMs,
    credentials: args.credentials,
    headers: {
      "content-type": 'application/soap+xml; charset="utf-8"',
      // Some devices still require SOAPAction even with SOAP 1.2.
      SOAPAction: `"${args.action}"`,
      "user-agent": "ONVIFscanner/0.1"
    },
    body: env12
  });
  const text12 = await res12.text();
  if (res12.status !== 400 && res12.status !== 415) {
    return { ok: res12.ok, status: res12.status, text: text12, soap: "1.2" };
  }

  // Fallback: SOAP 1.1 (common for older Hikvision firmwares and some embedded stacks).
  const env11 = buildSoapEnvelope({
    soapNs: "http://schemas.xmlsoap.org/soap/envelope/",
    body: args.body,
    wsse,
    wsa
  });
  const res11 = await fetchWithDigestAuth({
    url: args.url,
    method: "POST",
    timeoutMs: args.timeoutMs,
    credentials: args.credentials,
    headers: {
      "content-type": 'text/xml; charset="utf-8"',
      SOAPAction: `"${args.action}"`,
      "user-agent": "ONVIFscanner/0.1"
    },
    body: env11
  });
  const text11 = await res11.text();
  return { ok: res11.ok, status: res11.status, text: text11, soap: "1.1" };
}

function buildSoapEnvelope(args: {
  soapNs: string;
  body: string;
  wsse?: string;
  wsa?: string;
}): string {
  const headerInner = `${args.wsa ?? ""}${args.wsse ?? ""}`.trim();
  const header = headerInner ? `<s:Header>${headerInner}</s:Header>` : "";
  return `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="${args.soapNs}">
  ${header}
  <s:Body>
    ${args.body}
  </s:Body>
</s:Envelope>`;
}

function buildWsAddressingHeader(args: { action: string; to: string }): string {
  const messageId =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : crypto.randomBytes(16).toString("hex");
  const action = escapeXml(args.action);
  const to = escapeXml(args.to);
  return `<wsa:Action xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing">${action}</wsa:Action>
<wsa:To xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing">${to}</wsa:To>
<wsa:MessageID xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing">uuid:${messageId}</wsa:MessageID>`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
