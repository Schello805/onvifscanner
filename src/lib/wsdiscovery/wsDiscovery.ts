import dgram from "node:dgram";
import crypto from "node:crypto";
import type { ScanResult } from "@/lib/types";
import { mapLimit } from "@/lib/util/mapLimit";
import { probeOnvifFromXaddr } from "@/lib/onvif/probeOnvif";

const WS_DISCOVERY_ADDRESS = "239.255.255.250";
const WS_DISCOVERY_PORT = 3702;

export async function wsDiscoveryProbe(args: {
  timeoutMs: number;
  deepProbe: boolean;
  credentials?: { username: string; password: string };
}): Promise<ScanResult[]> {
  const discovered = await wsDiscoveryRaw(args.timeoutMs);

  // Unique by IP.
  const byIp = new Map<string, { ip: string; xaddrs: string[] }>();
  for (const d of discovered) {
    const existing = byIp.get(d.ip);
    if (!existing) {
      byIp.set(d.ip, { ip: d.ip, xaddrs: d.xaddrs });
    } else {
      const merged = Array.from(new Set([...existing.xaddrs, ...d.xaddrs]));
      byIp.set(d.ip, { ip: d.ip, xaddrs: merged });
    }
  }

  const items = Array.from(byIp.values());
  if (!args.deepProbe) {
    return items.map((item) => ({
      ip: item.ip,
      onvif: {
        ok: false,
        discoveryOnly: true,
        deviceServiceUrl: item.xaddrs[0],
        xaddrs: item.xaddrs,
        log: [
          `WS-Discovery: ${item.xaddrs.length} XAddr(s) gefunden.`,
          "ONVIF SOAP Probe: übersprungen (Fast Scan)."
        ]
      }
    }));
  }

  const probed = await mapLimit(items, Math.min(32, items.length || 1), async (item) => {
    const onvif = await probeOnvifFromXaddr({
      ip: item.ip,
      xaddrs: item.xaddrs,
      timeoutMs: args.timeoutMs,
      credentials: args.credentials
    });
    return { ip: item.ip, onvif };
  });

  return probed;
}

async function wsDiscoveryRaw(
  timeoutMs: number
): Promise<Array<{ ip: string; xaddrs: string[] }>> {
  const probe = buildProbeMessage();
  const socket = dgram.createSocket("udp4");

  const results: Array<{ ip: string; xaddrs: string[] }> = [];
  const seen = new Set<string>();

  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => resolve(), timeoutMs);

    socket.once("error", (e) => {
      clearTimeout(t);
      socket.close();
      reject(e);
    });

    socket.on("message", (msg, rinfo) => {
      const xml = msg.toString("utf8");
      const xaddrs = extractXAddrs(xml);
      if (!xaddrs.length) return;

      const key = `${rinfo.address}|${xaddrs.join(" ")}`;
      if (seen.has(key)) return;
      seen.add(key);
      results.push({ ip: rinfo.address, xaddrs });
    });

    socket.bind(0, () => {
      socket.setBroadcast(true);
      socket.setMulticastTTL(2);
      socket.send(probe, WS_DISCOVERY_PORT, WS_DISCOVERY_ADDRESS, (err) => {
        if (err) {
          clearTimeout(t);
          socket.close();
          reject(err);
        }
      });
    });
  });

  socket.close();
  return results;
}

function buildProbeMessage(): Buffer {
  // WS-Discovery Probe for NetworkVideoTransmitter.
  const messageId = `uuid:${cryptoRandomUuid()}`;
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope"
  xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing"
  xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"
  xmlns:dn="http://www.onvif.org/ver10/network/wsdl">
  <e:Header>
    <w:MessageID>${messageId}</w:MessageID>
    <w:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To>
    <w:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action>
  </e:Header>
  <e:Body>
    <d:Probe>
      <d:Types>dn:NetworkVideoTransmitter</d:Types>
    </d:Probe>
  </e:Body>
</e:Envelope>`;
  return Buffer.from(xml, "utf8");
}

function extractXAddrs(xml: string): string[] {
  const match = /<[^>]*XAddrs[^>]*>([^<]+)<\/[^>]*XAddrs>/i.exec(xml);
  if (!match?.[1]) return [];
  return match[1]
    .trim()
    .split(/\s+/g)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 10);
}

function cryptoRandomUuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = b.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20
  )}-${hex.slice(20)}`;
}
