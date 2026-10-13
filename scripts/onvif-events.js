const crypto = require('crypto');
const { sendCameraNotification } = require('./ntfy');

function escapeXml(value) {
  if (!value) return '';
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function buildWsse(username, password) {
  if (!username) return '';
  const nonce = crypto.randomBytes(16);
  const created = new Date().toISOString();
  const passwordDigest = crypto
    .createHash('sha1')
    .update(Buffer.concat([nonce, Buffer.from(created, 'utf8'), Buffer.from(password || '', 'utf8')]))
    .digest('base64');
  const nonceB64 = nonce.toString('base64');

  return `<wsse:Security s:mustUnderstand="1"
    xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"
    xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
    <wsse:UsernameToken>
      <wsse:Username>${escapeXml(username)}</wsse:Username>
      <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${passwordDigest}</wsse:Password>
      <wsse:Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${nonceB64}</wsse:Nonce>
      <wsu:Created>${created}</wsu:Created>
    </wsse:UsernameToken>
  </wsse:Security>`;
}

async function sendSoapRequest(url, action, bodyXml, credentials, timeoutMs = 15000) {
  const wsse = buildWsse(credentials?.username, credentials?.password);
  const messageId = `urn:uuid:${crypto.randomUUID()}`;

  const envelope = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
            xmlns:wsa="http://www.w3.org/2005/08/addressing">
  <s:Header>
    <wsa:Action s:mustUnderstand="1">${action}</wsa:Action>
    <wsa:MessageID s:mustUnderstand="1">${messageId}</wsa:MessageID>
    <wsa:To s:mustUnderstand="1">${url}</wsa:To>
    ${wsse}
  </s:Header>
  <s:Body>
    ${bodyXml}
  </s:Body>
</s:Envelope>`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/soap+xml; charset="utf-8"',
        'SOAPAction': `"${action}"`,
        'User-Agent': 'ONVIFscanner/1.0'
      },
      body: envelope,
      signal: controller.signal
    });

    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } finally {
    clearTimeout(timer);
  }
}

function extractXmlTag(xml, tagName) {
  if (!xml) return null;
  const re = new RegExp(`<(?:[A-Za-z0-9_]+:)?${tagName}\\b[^>]*>([\\s\\S]*?)</(?:[A-Za-z0-9_]+:)?${tagName}>`, 'i');
  const match = re.exec(xml);
  return match ? match[1].trim() : null;
}

function decodeXml(value) {
  return String(value || '')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'");
}

function extractAttribute(attributes, name) {
  const match = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(attributes || '');
  return match ? decodeXml(match[1]) : null;
}

function parseBooleanState(value) {
  if (/^(?:true|1|on|active)$/i.test(String(value || '').trim())) return true;
  if (/^(?:false|0|off|inactive)$/i.test(String(value || '').trim())) return false;
  return null;
}

function extractSimpleItems(xml) {
  const items = [];
  const pattern = /<(?:[A-Za-z0-9_]+:)?SimpleItem\b([^>]*)\/?\s*>/gi;
  let match;
  while ((match = pattern.exec(xml || '')) !== null) {
    const name = extractAttribute(match[1], 'Name');
    const value = extractAttribute(match[1], 'Value');
    if (name && value !== null) items.push({ name, value });
  }
  return items;
}

function parseMotionNotification(notificationXml) {
  const topic = decodeXml(extractXmlTag(notificationXml, 'Topic') || '').replace(/\s+/g, ' ').trim();
  if (!/(?:^|[/.:])(?:Motion|MotionAlarm|CellMotionDetector)(?:$|[/.:])/i.test(topic)) return null;

  const dataXml = extractXmlTag(notificationXml, 'Data') || '';
  const stateNames = /^(?:IsMotion|Motion|MotionAlarm|State|LogicalState|Active)$/i;
  let state = null;
  for (const item of extractSimpleItems(dataXml)) {
    if (!stateNames.test(item.name)) continue;
    state = parseBooleanState(item.value);
    if (state !== null) break;
  }

  if (state === null) {
    for (const tagName of ['IsMotion', 'Motion', 'MotionAlarm', 'State', 'LogicalState', 'Active']) {
      const value = extractXmlTag(dataXml, tagName);
      if (value === null) continue;
      state = parseBooleanState(value);
      if (state !== null) break;
    }
  }
  if (state === null) return null;

  const messagePattern = /<(?:[A-Za-z0-9_]+:)?Message\b([^>]*)>/gi;
  let messageAttributes = '';
  let messageMatch;
  while ((messageMatch = messagePattern.exec(notificationXml)) !== null) {
    if (/\b(?:PropertyOperation|UtcTime)\s*=/i.test(messageMatch[1])) {
      messageAttributes = messageMatch[1];
      break;
    }
  }
  const operation = (extractAttribute(messageAttributes, 'PropertyOperation') || '').toLowerCase();
  const utcTime = extractAttribute(messageAttributes, 'UtcTime');
  const parsedTime = utcTime ? new Date(utcTime) : null;
  const sourceXml = extractXmlTag(notificationXml, 'Source') || '';
  const sourceKey = extractSimpleItems(sourceXml)
    .map((item) => `${item.name}=${item.value}`)
    .sort()
    .join('|');

  return {
    key: `${topic}|${sourceKey}`,
    operation,
    state,
    timestamp: parsedTime && !Number.isNaN(parsedTime.getTime()) ? parsedTime : new Date(),
  };
}

class OnvifEventManager {
  constructor(prisma) {
    this.prisma = prisma;
    this.running = false;
    this.activeWorkers = new Map(); // cameraId -> worker state
    this.lastAlarmTimes = new Map(); // cameraId -> timestamp
    this.eventStates = new Map();
    this.unsupportedUntil = new Map(); // cameraId -> timestamp
    this.lastHealthUpdates = new Map();
  }

  start() {
    this.running = true;
    console.log('📡 Starting ONVIF Event Pull Service for background motion tracking...');
  }

  stop() {
    this.running = false;
    for (const [id, worker] of this.activeWorkers.entries()) {
      worker.aborted = true;
    }
    this.activeWorkers.clear();
  }

  async syncCameras(cameras) {
    if (!this.running) return;

    for (const cam of cameras) {
      if (this.activeWorkers.has(cam.id)) continue;

      const unsupp = this.unsupportedUntil.get(cam.id);
      if (unsupp && Date.now() < unsupp) continue;

      void this.updateEventHealth(cam.id, 'probing', 'onvif', null);
      this.spawnCameraWorker(cam);
    }
  }

  async spawnCameraWorker(cam) {
    const workerState = { aborted: false };
    this.activeWorkers.set(cam.id, workerState);

    (async () => {
      try {
        await this.runWorkerLoop(cam, workerState);
      } catch (err) {
        // quiet error catch
      } finally {
        this.activeWorkers.delete(cam.id);
      }
    })();
  }

  async runWorkerLoop(cam, workerState) {
    const port = cam.onvifPort || cam.port || 80;
    const deviceUrl = `http://${cam.ip}:${port}/onvif/device_service`;
    const creds = cam.username ? { username: cam.username, password: cam.password } : undefined;

    // 1. Get Event service URL
    let eventServiceUrl = `http://${cam.ip}:${port}/onvif/event_service`;
    try {
      const capsRes = await sendSoapRequest(
        deviceUrl,
        'http://www.onvif.org/ver10/device/wsdl/GetCapabilities',
        `<tds:GetCapabilities xmlns:tds="http://www.onvif.org/ver10/device/wsdl"><tds:Category>Events</tds:Category></tds:GetCapabilities>`,
        creds,
        5000
      );

      if (capsRes.ok) {
        const eventsBlockMatch = /<(?:\w+:)?Events\b[^>]*>([\s\S]*?)<\/(?:\w+:)?Events>/i.exec(capsRes.text);
        if (eventsBlockMatch) {
          const xaddr = extractXmlTag(eventsBlockMatch[1], 'XAddr');
          if (xaddr) {
            try {
              const parsed = new URL(xaddr);
              parsed.hostname = cam.ip; // Keep verified IP
              eventServiceUrl = parsed.toString();
            } catch {
              eventServiceUrl = xaddr;
            }
          }
        }
      }
    } catch {
      // fallback to default eventServiceUrl
    }

    let retryDelay = 5000;

    while (this.running && !workerState.aborted) {
      // 2. Create PullPoint Subscription
      let pullPointUrl = null;
      try {
        const subRes = await sendSoapRequest(
          eventServiceUrl,
          'http://www.onvif.org/ver10/events/wsdl/EventPortType/CreatePullPointSubscriptionRequest',
          `<tev:CreatePullPointSubscription xmlns:tev="http://www.onvif.org/ver10/events/wsdl">
             <tev:InitialTerminationTime>PT10M</tev:InitialTerminationTime>
           </tev:CreatePullPointSubscription>`,
          creds,
          8000
        );

        if (!subRes.ok) {
          // If unsupported, back off for 15 minutes so we don't spam
          if (subRes.status === 404 || subRes.status === 501 || subRes.text.includes('ActionNotSupported')) {
            this.unsupportedUntil.set(cam.id, Date.now() + 15 * 60 * 1000);
            await this.updateEventHealth(cam.id, 'unsupported', 'onvif', `ONVIF Events nicht unterstützt (HTTP ${subRes.status}).`, true);
            return;
          }
          await this.updateEventHealth(cam.id, 'error', 'onvif', `PullPoint-Abo fehlgeschlagen (HTTP ${subRes.status}).`);
          await new Promise((r) => setTimeout(r, 15000));
          continue;
        }

        // Extract PullPoint Address
        const addr = extractXmlTag(subRes.text, 'Address');
        if (addr) {
          try {
            const p = new URL(addr);
            p.hostname = cam.ip;
            pullPointUrl = p.toString();
          } catch {
            pullPointUrl = addr;
          }
        }
      } catch (e) {
        await this.updateEventHealth(cam.id, 'error', 'onvif', String(e?.message || e));
        await new Promise((r) => setTimeout(r, 10000));
        continue;
      }

      if (!pullPointUrl) {
        await this.updateEventHealth(cam.id, 'error', 'onvif', 'PullPoint-Adresse fehlt.');
        await new Promise((r) => setTimeout(r, 15000));
        continue;
      }

      await this.updateEventHealth(cam.id, 'active', 'onvif', null, true);

      // 3. Long-polling PullMessages loop
      let consecutiveErrors = 0;
      while (this.running && !workerState.aborted && consecutiveErrors < 3) {
        try {
          const pullRes = await sendSoapRequest(
            pullPointUrl,
            'http://www.onvif.org/ver10/events/wsdl/PullPointSubscription/PullMessagesRequest',
            `<tev:PullMessages xmlns:tev="http://www.onvif.org/ver10/events/wsdl">
               <tev:Timeout>PT25S</tev:Timeout>
               <tev:MessageLimit>10</tev:MessageLimit>
             </tev:PullMessages>`,
            creds,
            35000
          );

          if (!pullRes.ok) {
            consecutiveErrors++;
            await this.updateEventHealth(cam.id, 'error', 'onvif', `PullMessages fehlgeschlagen (HTTP ${pullRes.status}).`);
            break; // renew / recreate subscription
          }

          consecutiveErrors = 0;
          await this.updateEventHealth(cam.id, 'active', 'onvif', null);
          await this.processPullMessagesXml(cam, pullRes.text);
        } catch (e) {
          consecutiveErrors++;
          await this.updateEventHealth(cam.id, 'error', 'onvif', String(e?.message || e));
          await new Promise((r) => setTimeout(r, 3000));
        }
      }

      // Short breath before recreating subscription
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  async processPullMessagesXml(cam, xml) {
    if (!xml) return;

    const notifications = [];
    const pattern = /<(?:[A-Za-z0-9_]+:)?NotificationMessage\b[^>]*>[\s\S]*?<\/(?:[A-Za-z0-9_]+:)?NotificationMessage>/gi;
    let match;
    while ((match = pattern.exec(xml)) !== null) notifications.push(match[0]);

    for (const notification of notifications) {
      const event = parseMotionNotification(notification);
      if (!event) continue;

      const stateKey = `${cam.id}|${event.key}`;
      const previousState = this.eventStates.get(stateKey);
      this.eventStates.set(stateKey, event.state);

      if (event.operation === 'initialized') continue;
      if (!event.state || previousState === true) continue;
      if (previousState === undefined && event.operation !== 'changed') continue;

      await this.recordMotionEvent(cam, event.timestamp);
    }
  }

  async recordMotionEvent(cam, timestamp) {
    const now = Date.now();
    const last = this.lastAlarmTimes.get(cam.id) || 0;
    if (now - last < 5000) return;
    this.lastAlarmTimes.set(cam.id, now);

    try {
      await this.prisma.alarmLog.create({
        data: {
          cameraId: cam.id,
          message: 'Bewegung erkannt (ONVIF)',
          timestamp,
        }
      });
      const currentCamera = await this.prisma.camera.findUnique({ where: { id: cam.id } });
      await sendCameraNotification(this.prisma, currentCamera || cam, 'Bewegung erkannt (ONVIF)');
      await this.updateEventHealth(cam.id, 'active', 'onvif', null, true, timestamp);
      const oldEvents = await this.prisma.alarmLog.findMany({
        where: { cameraId: cam.id },
        orderBy: { timestamp: 'desc' },
        skip: 500,
        select: { id: true }
      });
      if (oldEvents.length) {
        await this.prisma.alarmLog.deleteMany({
          where: { id: { in: oldEvents.map((event) => event.id) } }
        });
      }
    } catch {}
  }

  async updateEventHealth(cameraId, state, source, error, force = false, lastSeen = undefined) {
    const signature = `${state}:${source}:${error || ''}`;
    const previous = this.lastHealthUpdates.get(cameraId);
    if (!force && previous?.signature === signature && Date.now() - previous.at < 60_000) return;
    this.lastHealthUpdates.set(cameraId, { signature, at: Date.now() });
    try {
      if (state !== 'active' && source === 'onvif') {
        const current = await this.prisma.camera.findUnique({
          where: { id: cameraId },
          select: { motionEventState: true, motionEventSource: true },
        });
        if (current?.motionEventState === 'active' && current.motionEventSource && current.motionEventSource !== 'onvif') {
          return;
        }
      }
      await this.prisma.camera.update({
        where: { id: cameraId },
        data: {
          motionEventState: state,
          motionEventSource: source,
          motionEventCheckedAt: new Date(),
          motionEventLastError: error ? String(error).slice(0, 500) : null,
          ...(lastSeen ? { motionEventLastSeen: lastSeen } : {}),
        },
      });
    } catch {
      // Camera may have been removed while a worker was active.
    }
  }
}

module.exports = {
  OnvifEventManager,
  parseMotionNotification,
};
