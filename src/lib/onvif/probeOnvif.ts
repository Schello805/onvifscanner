import type { OnvifResult } from "@/lib/types";
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

    const mediaServiceUrl = caps.ok ? extractXAddrAttribute(caps.text, "Media") : undefined;
    const rtspUris: string[] = [];
    const snapshotUris: string[] = [];

    if (mediaServiceUrl) {
      const profiles = await onvifSoapCall({
        url: mediaServiceUrl,
        action: "http://www.onvif.org/ver10/media/wsdl/GetProfiles",
        timeoutMs: args.timeoutMs,
        credentials: args.credentials,
        body: `<trt:GetProfiles xmlns:trt="http://www.onvif.org/ver10/media/wsdl" />`
      });

      const profileToken = profiles.ok ? extractFirstAttribute(profiles.text, "Profiles", "token") : undefined;
      if (profileToken) {
        const stream = await onvifSoapCall({
          url: mediaServiceUrl,
          action: "http://www.onvif.org/ver10/media/wsdl/GetStreamUri",
          timeoutMs: args.timeoutMs,
          credentials: args.credentials,
          body: `<trt:GetStreamUri xmlns:trt="http://www.onvif.org/ver10/media/wsdl">
  <trt:StreamSetup>
    <tt:Stream xmlns:tt="http://www.onvif.org/ver10/schema">RTP-Unicast</tt:Stream>
    <tt:Transport xmlns:tt="http://www.onvif.org/ver10/schema">
      <tt:Protocol>RTSP</tt:Protocol>
    </tt:Transport>
  </trt:StreamSetup>
  <trt:ProfileToken>${escapeXml(profileToken)}</trt:ProfileToken>
</trt:GetStreamUri>`
        });
        const rtsp = stream.ok ? extractText(stream.text, "Uri") : undefined;
        if (rtsp) rtspUris.push(rtsp);

        const snap = await onvifSoapCall({
          url: mediaServiceUrl,
          action: "http://www.onvif.org/ver10/media/wsdl/GetSnapshotUri",
          timeoutMs: args.timeoutMs,
          credentials: args.credentials,
          body: `<trt:GetSnapshotUri xmlns:trt="http://www.onvif.org/ver10/media/wsdl">
  <trt:ProfileToken>${escapeXml(profileToken)}</trt:ProfileToken>
</trt:GetSnapshotUri>`
        });
        const snapUri = snap.ok ? extractText(snap.text, "Uri") : undefined;
        if (snapUri) snapshotUris.push(snapUri);
      }
    }

    return {
      ok: true,
      xaddrs: args.xaddrs,
      deviceServiceUrl,
      mediaServiceUrl,
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

function extractXAddrAttribute(xml: string, serviceName: string): string | undefined {
  const re = new RegExp(
    `<(?:[A-Za-z0-9_]+:)?${escapeRegExp(serviceName)}\\b[^>]*\\bXAddr="([^"]+)"`,
    "i"
  );
  const m = re.exec(xml);
  const value = m?.[1]?.trim();
  return value || undefined;
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
