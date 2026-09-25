import type { OnvifResult, OnvifUri } from "@/lib/types";
import { extractText } from "@/lib/util/xml";
import { onvifSoapCall } from "@/lib/onvif/soap";
import { sanitizeUrlString } from "@/lib/util/url";

export async function probeOnvifFromXaddr(args: {
  ip: string;
  xaddrs: string[];
  timeoutMs: number;
  credentials?: { username: string; password: string };
}): Promise<OnvifResult> {
  const log: string[] = [];
  const rawDeviceServiceUrl = args.xaddrs[0];
  const deviceServiceUrl = rawDeviceServiceUrl
    ? normalizeUriHost(rawDeviceServiceUrl, args.ip, log, "DeviceService")
    : undefined;
  if (!deviceServiceUrl) {
    return {
      ok: false,
      xaddrs: args.xaddrs,
      log: limitLog(log),
      error: "Kein XAddr vorhanden."
    };
  }

  try {
    log.push(`DeviceService: ${deviceServiceUrl}`);

    // Query camera system date & time (unauthenticated) to compensate for clock skew.
    let timeOffsetMs: number | undefined;
    try {
      const timeRes = await onvifSoapCall({
        url: deviceServiceUrl,
        action: "http://www.onvif.org/ver10/device/wsdl/GetSystemDateAndTime",
        timeoutMs: Math.min(args.timeoutMs, 1200),
        body: `<tds:GetSystemDateAndTime xmlns:tds="http://www.onvif.org/ver10/device/wsdl" />`
      });
      if (timeRes.ok) {
        const cameraDate = parseOnvifDate(timeRes.text);
        if (cameraDate && !Number.isNaN(cameraDate.getTime())) {
          timeOffsetMs = cameraDate.getTime() - Date.now();
          if (Math.abs(timeOffsetMs) > 10_000) {
            log.push(
              `GetSystemDateAndTime: Zeitversatz zur Kamera (${Math.round(timeOffsetMs / 1000)}s) wird kompensiert.`
            );
          }
        }
      }
    } catch {
      // ignore, proceed with local time
    }

    const devInfo = await onvifSoapCall({
      url: deviceServiceUrl,
      action: "http://www.onvif.org/ver10/device/wsdl/GetDeviceInformation",
      timeoutMs: args.timeoutMs,
      credentials: args.credentials,
      timeOffsetMs,
      body: `<tds:GetDeviceInformation xmlns:tds="http://www.onvif.org/ver10/device/wsdl" />`
    });
    log.push(`GetDeviceInformation: HTTP ${devInfo.status} (SOAP ${devInfo.soap})`);
    if (!devInfo.ok) {
      return {
        ok: false,
        xaddrs: args.xaddrs,
        deviceServiceUrl,
        log: limitLog(log),
        error: `HTTP ${devInfo.status}`
      };
    }

    const manufacturer = extractText(devInfo.text, "Manufacturer");
    const model = extractText(devInfo.text, "Model");
    const firmwareVersion = extractText(devInfo.text, "FirmwareVersion");
    const serialNumber = extractText(devInfo.text, "SerialNumber");
    const hardwareId = extractText(devInfo.text, "HardwareId");
    let hostname: string | undefined;

    const host = await onvifSoapCall({
      url: deviceServiceUrl,
      action: "http://www.onvif.org/ver10/device/wsdl/GetHostname",
      timeoutMs: args.timeoutMs,
      credentials: args.credentials,
      timeOffsetMs,
      body: `<tds:GetHostname xmlns:tds="http://www.onvif.org/ver10/device/wsdl" />`
    });
    log.push(`GetHostname: HTTP ${host.status} (SOAP ${host.soap})`);
    hostname = host.ok ? extractText(host.text, "Name") : undefined;

    const caps = await onvifSoapCall({
      url: deviceServiceUrl,
      action: "http://www.onvif.org/ver10/device/wsdl/GetCapabilities",
      timeoutMs: args.timeoutMs,
      credentials: args.credentials,
      timeOffsetMs,
      body: `<tds:GetCapabilities xmlns:tds="http://www.onvif.org/ver10/device/wsdl"><tds:Category>All</tds:Category></tds:GetCapabilities>`
    });
    log.push(`GetCapabilities: HTTP ${caps.status} (SOAP ${caps.soap})`);

    const mediaServiceUrl = caps.ok ? extractCapabilityXAddr(caps.text, "Media") : undefined;
    const media2ServiceUrl = caps.ok ? extractCapabilityXAddr(caps.text, "Media2") : undefined;
    if (caps.ok) {
      log.push(
        `Capabilities: Media=${mediaServiceUrl ? "yes" : "no"}, Media2=${media2ServiceUrl ? "yes" : "no"}`
      );
    } else {
      log.push("Capabilities call failed; cannot discover Media/Media2.");
    }
    const rtspUris: OnvifUri[] = [];
    const snapshotUris: OnvifUri[] = [];

    // Prefer Media2 if available (newer devices), fallback to Media (ver10).
    const mediaUrlToUse = media2ServiceUrl ?? mediaServiceUrl;
    const isMedia2 = mediaUrlToUse === media2ServiceUrl;

    if (mediaUrlToUse) {
      log.push(`Using media service: ${isMedia2 ? "Media2" : "Media"} (${mediaUrlToUse})`);
      const profiles = await onvifSoapCall({
        url: mediaUrlToUse,
        action: isMedia2
          ? "http://www.onvif.org/ver20/media/wsdl/GetProfiles"
          : "http://www.onvif.org/ver10/media/wsdl/GetProfiles",
        timeoutMs: args.timeoutMs,
        credentials: args.credentials,
        timeOffsetMs,
        body: isMedia2
          ? `<tr2:GetProfiles xmlns:tr2="http://www.onvif.org/ver20/media/wsdl" />`
          : `<trt:GetProfiles xmlns:trt="http://www.onvif.org/ver10/media/wsdl" />`
      });
      log.push(`GetProfiles: HTTP ${profiles.status} (SOAP ${profiles.soap})`);

      const profileCandidates = profiles.ok ? extractProfiles(profiles.text) : [];
      const profileList = profileCandidates.slice(0, 6);
      log.push(`Profiles parsed: ${profileCandidates.length} (using ${profileList.length})`);

      for (const profile of profileList) {
        if (!profile.token) continue;
        log.push(
          `Profile: token=${profile.token}${profile.name ? ` name="${profile.name}"` : ""}`
        );

        const stream = await onvifSoapCall({
          url: mediaUrlToUse,
          action: isMedia2
            ? "http://www.onvif.org/ver20/media/wsdl/GetStreamUri"
            : "http://www.onvif.org/ver10/media/wsdl/GetStreamUri",
          timeoutMs: args.timeoutMs,
          credentials: args.credentials,
          timeOffsetMs,
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
        log.push(
          `GetStreamUri(${profile.token}): HTTP ${stream.status} (SOAP ${stream.soap})`
        );
        const rtsp = stream.ok ? extractText(stream.text, "Uri") : undefined;
        if (rtsp) {
          rtspUris.push({
            profileToken: profile.token,
            profileName: profile.name,
            resolution: profile.resolution,
            width: profile.width,
            height: profile.height,
            encoding: profile.encoding,
            fps: profile.fps,
            uri: normalizeUriHost(rtsp, args.ip, log, "RTSP")
          });
        } else {
          log.push(`GetStreamUri(${profile.token}): no Uri in response`);
        }

        const snap = await onvifSoapCall({
          url: mediaUrlToUse,
          action: isMedia2
            ? "http://www.onvif.org/ver20/media/wsdl/GetSnapshotUri"
            : "http://www.onvif.org/ver10/media/wsdl/GetSnapshotUri",
          timeoutMs: args.timeoutMs,
          credentials: args.credentials,
          timeOffsetMs,
          body: isMedia2
            ? `<tr2:GetSnapshotUri xmlns:tr2="http://www.onvif.org/ver20/media/wsdl">
  <tr2:ProfileToken>${escapeXml(profile.token)}</tr2:ProfileToken>
</tr2:GetSnapshotUri>`
            : `<trt:GetSnapshotUri xmlns:trt="http://www.onvif.org/ver10/media/wsdl">
  <trt:ProfileToken>${escapeXml(profile.token)}</trt:ProfileToken>
</trt:GetSnapshotUri>`
        });
        log.push(
          `GetSnapshotUri(${profile.token}): HTTP ${snap.status} (SOAP ${snap.soap})`
        );
        const snapUri = snap.ok ? extractText(snap.text, "Uri") : undefined;
        if (snapUri) {
          snapshotUris.push({
            profileToken: profile.token,
            profileName: profile.name,
            resolution: profile.resolution,
            width: profile.width,
            height: profile.height,
            uri: normalizeUriHost(snapUri, args.ip, log, "Snapshot")
          });
        } else {
          log.push(`GetSnapshotUri(${profile.token}): no Uri in response`);
        }
      }
    } else {
      log.push("No Media/Media2 XAddr found; no Stream/Snapshot URIs available.");
    }

    return {
      ok: true,
      xaddrs: args.xaddrs.map((x) => normalizeUriHost(x, args.ip, log, "XAddr")),
      deviceServiceUrl,
      mediaServiceUrl: mediaServiceUrl ?? undefined,
      mediaServiceUrl2: media2ServiceUrl ?? undefined,
      rtspUris: rtspUris.length ? rtspUris : undefined,
      snapshotUris: snapshotUris.length ? snapshotUris : undefined,
      log: limitLog(log),
      deviceInformation: {
        manufacturer,
        model,
        hostname,
        firmwareVersion,
        serialNumber,
        hardwareId
      }
    };
  } catch (e) {
    log.push(`Exception: ${e instanceof Error ? e.message : String(e)}`);
    return {
      ok: false,
      xaddrs: args.xaddrs,
      deviceServiceUrl,
      log: limitLog(log),
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

function extractProfiles(
  xml: string
): Array<{
  token?: string;
  name?: string;
  resolution?: string;
  width?: number;
  height?: number;
  encoding?: string;
  fps?: number;
}> {
  const out: Array<{
    token?: string;
    name?: string;
    resolution?: string;
    width?: number;
    height?: number;
    encoding?: string;
    fps?: number;
  }> = [];
  const re = /<(?:[A-Za-z0-9_]+:)?Profiles\b([^>]*)>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?Profiles>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const attrs = m[1] ?? "";
    const inner = m[2] ?? "";
    const token = /(?:\s|^)token="([^"]+)"/i.exec(attrs)?.[1]?.trim();
    const name = extractText(inner, "Name");

    // Extract resolution
    const width = Number(extractText(inner, "Width"));
    const height = Number(extractText(inner, "Height"));
    const validDims = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
    const resolution = validDims ? `${width}×${height}` : undefined;

    const encoding = extractText(inner, "Encoding");
    const frameRate = Number(extractText(inner, "FrameRateLimit"));
    const fps = Number.isFinite(frameRate) && frameRate > 0 ? frameRate : undefined;

    out.push({
      token,
      name,
      resolution,
      width: validDims ? width : undefined,
      height: validDims ? height : undefined,
      encoding,
      fps
    });
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

function normalizeUriHost(uri: string, ip: string, log: string[], label: string): string {
  try {
    const before = uri;
    const sanitized = sanitizeUrlString(uri);
    const u = new URL(sanitized);
    // Cameras often report incorrect IPs (e.g. static IP from another network, 0.0.0.0, etc.).
    // We already know the correct IP because we just successfully queried it.
    u.hostname = ip;
    const out = u.toString();
    if (out !== before) log.push(`${label}: "${before}" -> "${out}"`);
    return out;
  } catch {
    const out = sanitizeUrlString(uri);
    if (out !== uri) log.push(`${label}: "${uri}" -> "${out}"`);
    return out;
  }
}

function limitLog(lines: string[]): string[] {
  const max = 80;
  if (lines.length <= max) return lines;
  return [...lines.slice(0, 20), `... (${lines.length - 40} more) ...`, ...lines.slice(-19)];
}

function parseOnvifDate(xml: string): Date | undefined {
  const matchUtc = xml.match(/<(?:[A-Za-z0-9_]+:)?UTCDateTime\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?UTCDateTime>/i);
  const matchLocal = xml.match(/<(?:[A-Za-z0-9_]+:)?LocalDateTime\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?LocalDateTime>/i);
  const block = matchUtc?.[1] ?? matchLocal?.[1];
  if (!block) return undefined;

  const year = Number(extractText(block, "Year"));
  const month = Number(extractText(block, "Month"));
  const day = Number(extractText(block, "Day"));
  const hour = Number(extractText(block, "Hour"));
  const minute = Number(extractText(block, "Minute"));
  const second = Number(extractText(block, "Second"));

  if (Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day) && year >= 1970) {
    return new Date(Date.UTC(year, month - 1, day, hour || 0, minute || 0, second || 0));
  }
  return undefined;
}
