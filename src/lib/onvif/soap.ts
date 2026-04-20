import { fetchWithDigestAuth } from "@/lib/http/digestFetch";
import { buildWsseSecurityHeader } from "@/lib/onvif/wsse";

export async function onvifSoapCall(args: {
  url: string;
  action: string;
  body: string;
  timeoutMs: number;
  credentials?: { username: string; password: string };
}): Promise<{ ok: boolean; status: number; text: string }> {
  const envelope = buildSoapEnvelope({
    body: args.body,
    wsse:
      args.credentials?.username
        ? buildWsseSecurityHeader({
            username: args.credentials.username,
            password: args.credentials.password
          })
        : undefined
  });

  const res = await fetchWithDigestAuth({
    url: args.url,
    method: "POST",
    timeoutMs: args.timeoutMs,
    credentials: args.credentials,
    headers: {
      // Some devices prefer SOAP 1.2 content type; SOAPAction is added for compatibility.
      "content-type": 'application/soap+xml; charset="utf-8"',
      soapaction: `"${args.action}"`,
      "user-agent": "ONVIFscanner/0.1"
    },
    body: envelope
  });

  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

function buildSoapEnvelope(args: { body: string; wsse?: string }): string {
  const header = args.wsse ? `<s:Header>${args.wsse}</s:Header>` : "";
  return `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope">
  ${header}
  <s:Body>
    ${args.body}
  </s:Body>
</s:Envelope>`;
}

