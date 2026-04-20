import type { OnvifResult, OnvifUri } from "@/lib/types";
import { extractText } from "@/lib/util/xml";
import { onvifSoapCall } from "@/lib/onvif/soap";

export async function probeOnvifFromXaddr(args: {
  ip: string;
  xaddrs: string[];
  timeoutMs: number;
  credentials?: { username: string; password: string };
}): Promise<OnvifResult> {
  const deviceServiceUrl = args.xaddrs[0];
  if (!deviceServiceUrl) {
    return { ok: false, xaddrs: args.xaddrs, error: "Kein XAddr vorhanden." };
  }

  try {
    const devInfo = await onvifSoapCall({
      url: deviceServiceUrl,
      action: "http://www.onvif.org/ver10/device/wsdl/GetDeviceInformation",
      timeoutMs: args.timeoutMs,
      credentials: args.credentials,
      body: `<tds:GetDeviceInformation xmlns:tds="http://www.onvif.org/ver10/device/wsdl" />`
    });
    if (!devInfo.ok) {
      return {
        ok: false,
        xaddrs: args.xaddrs,
        deviceServiceUrl,
        error: `HTTP ${devInfo.status}`
      };
    }

    const manufacturer = extractText(devInfo.text, "Manufacturer");
    const model = extractText(devInfo.text, "Model");
    const firmwareVersion = extractText(devInfo.text, "FirmwareVersion");
    const serialNumber = extractText(devInfo.text, "SerialNumber");
    const hardwareId = extractText(devInfo.text, "HardwareId");

    const caps = await onvifSoapCall({
      url: deviceServiceUrl,
      action: "http://www.onvif.org/ver10/device/wsdl/GetCapabilities",
      timeoutMs: args.timeoutMs,
      credentials: args.credentials,
      body: `<tds:GetCapabilities xmlns:tds="http://www.onvif.org/ver10/device/wsdl"><tds:Category>All</tds:Category></tds:GetCapabilities>`
    });

    const mediaServiceUrl = caps.ok ? extractCapabilityXAddr(caps.text, "Media") : undefined;
    const media2ServiceUrl = caps.ok ? extractCapabilityXAddr(caps.text, "Media2") : undefined;
    const rtspUris: OnvifUri[] = [];
    const snapshotUris: OnvifUri[] = [];

    // Prefer Media2 if available (newer devices), fallback to Media (ver10).
    const mediaUrlToUse = media2ServiceUrl ?? mediaServiceUrl;
    const isMedia2 = mediaUrlToUse === media2ServiceUrl;

    if (mediaUrlToUse) {
      const profiles = await onvifSoapCall({
        url: mediaUrlToUse,
        action: isMedia2
          ? "http://www.onvif.org/ver20/media/wsdl/GetProfiles"
          : "http://www.onvif.org/ver10/media/wsdl/GetProfiles",
        timeoutMs: args.timeoutMs,
        credentials: args.credentials,
        body: isMedia2
          ? `<tr2:GetProfiles xmlns:tr2="http://www.onvif.org/ver20/media/wsdl" />`
          : `<trt:GetProfiles xmlns:trt="http://www.onvif.org/ver10/media/wsdl" />`
      });

      const profileCandidates = profiles.ok ? extractProfiles(profiles.text) : [];
      const profileList = profileCandidates.slice(0, 6);

      for (const profile of profileList) {
        if (!profile.token) continue;

        const stream = await onvifSoapCall({
          url: mediaUrlToUse,
          action: isMedia2
            ? "http://www.onvif.org/ver20/media/wsdl/GetStreamUri"
            : "http://www.onvif.org/ver10/media/wsdl/GetStreamUri",
          timeoutMs: args.timeoutMs,
          credentials: args.credentials,
          body: isMedia2
            ? `<tr2:GetStreamUri xmlns:tr2="http://www.onvif.org/ver20/media/wsdl">
  <tr2:Protocol>RTSP</tr2:Protocol>
  <tr2:ProfileToken>${escapeXml(profile.token)}</tr2:ProfileToken>
</tr2:GetStreamUri>`
            : `<trt:GetStreamUri xmlns:trt="http://www.onvif.org/ver10/media/wsdl">
  <trt:StreamSetup>
    <tt:Stream xmlns:tt="http://www.onvif.org/ver10/schema">RTP-Unicast</tt:Stream>
    <tt:Transport xmlns:tt="http://www.onvif.org/ver10/schema">
      <tt:Protocol>RTSP</tt:Protocol>
    </tt:Transport>
  </trt:StreamSetup>
  <trt:ProfileToken>${escapeXml(profile.token)}</trt:ProfileToken>
</trt:GetStreamUri>`
        });
        const rtsp = stream.ok ? extractText(stream.text, "Uri") : undefined;
        if (rtsp) {
          rtspUris.push({
            profileToken: profile.token,
            profileName: profile.name,
            uri: normalizeUriHost(rtsp, args.ip)
          });
        }

        const snap = await onvifSoapCall({
          url: mediaUrlToUse,
          action: isMedia2
            ? "http://www.onvif.org/ver20/media/wsdl/GetSnapshotUri"
            : "http://www.onvif.org/ver10/media/wsdl/GetSnapshotUri",
          timeoutMs: args.timeoutMs,
          credentials: args.credentials,
          body: isMedia2
            ? `<tr2:GetSnapshotUri xmlns:tr2="http://www.onvif.org/ver20/media/wsdl">
  <tr2:ProfileToken>${escapeXml(profile.token)}</tr2:ProfileToken>
</tr2:GetSnapshotUri>`
            : `<trt:GetSnapshotUri xmlns:trt="http://www.onvif.org/ver10/media/wsdl">
  <trt:ProfileToken>${escapeXml(profile.token)}</trt:ProfileToken>
</trt:GetSnapshotUri>`
        });
        const snapUri = snap.ok ? extractText(snap.text, "Uri") : undefined;
        if (snapUri) {
          snapshotUris.push({
            profileToken: profile.token,
            profileName: profile.name,
            uri: normalizeUriHost(snapUri, args.ip)
          });
        }
      }
    }

    return {
      ok: true,
      xaddrs: args.xaddrs,
      deviceServiceUrl,
      mediaServiceUrl: mediaServiceUrl ?? undefined,
      mediaServiceUrl2: media2ServiceUrl ?? undefined,
      rtspUris: rtspUris.length ? rtspUris : undefined,
      snapshotUris: snapshotUris.length ? snapshotUris : undefined,
      deviceInformation: {
        manufacturer,
        model,
        firmwareVersion,
        serialNumber,
        hardwareId
      }
    };
  } catch (e) {
    return {
      ok: false,
      xaddrs: args.xaddrs,
      deviceServiceUrl,
      error: e instanceof Error ? e.message : String(e)
    };
  }
}

function extractCapabilityXAddr(xml: string, serviceName: string): string | undefined {
  // In ONVIF GetCapabilities responses, endpoints are usually nested like:
  // <tt:Media> ... <tt:XAddr>http://ip/onvif/media_service</tt:XAddr> ... </tt:Media>
  const blockRe = new RegExp(
    `<(?:[A-Za-z0-9_]+:)?${escapeRegExp(serviceName)}\\b[^>]*>([\\s\\S]*?)</(?:[A-Za-z0-9_]+:)?${escapeRegExp(
      serviceName
    )}>`,
    "i"
  );
  const block = blockRe.exec(xml)?.[1];
  if (block) {
    const xaddr = extractText(block, "XAddr");
    if (xaddr) return xaddr.trim();
  }

  // Fallback: some vendors may return as attribute.
  const attrRe = new RegExp(
    `<(?:[A-Za-z0-9_]+:)?${escapeRegExp(serviceName)}\\b[^>]*\\bXAddr="([^"]+)"`,
    "i"
  );
  const attr = attrRe.exec(xml)?.[1]?.trim();
  return attr || undefined;
}

function extractFirstAttribute(
  xml: string,
  tagName: string,
  attributeName: string
): string | undefined {
  const re = new RegExp(
    `<(?:[A-Za-z0-9_]+:)?${escapeRegExp(tagName)}\\b[^>]*\\b${escapeRegExp(
      attributeName
    )}="([^"]+)"`,
    "i"
  );
  const m = re.exec(xml);
  const value = m?.[1]?.trim();
  return value || undefined;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function extractProfiles(xml: string): Array<{ token?: string; name?: string }> {
  // Very small XML parser: we only need token + optional Name for <Profiles ... token="..."> ... <Name>..</Name>
  const out: Array<{ token?: string; name?: string }> = [];
  const re = /<(?:[A-Za-z0-9_]+:)?Profiles\b([^>]*)>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?Profiles>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const attrs = m[1] ?? "";
    const inner = m[2] ?? "";
    const token = /(?:\s|^)token="([^"]+)"/i.exec(attrs)?.[1]?.trim();
    const name = extractText(inner, "Name");
    out.push({ token, name });
  }
  // De-dup by token
  const seen = new Set<string>();
  return out.filter((p) => {
    if (!p.token) return false;
    if (seen.has(p.token)) return false;
    seen.add(p.token);
    return true;
  });
}

function normalizeUriHost(uri: string, ip: string): string {
  try {
    const u = new URL(uri);
    const host = u.hostname;
    // Many devices return 0.0.0.0 / localhost / private placeholder.
    if (!host || host === "0.0.0.0" || host === "127.0.0.1" || host === "localhost") {
      u.hostname = ip;
      return u.toString();
    }
    return uri;
  } catch {
    return uri;
  }
}
