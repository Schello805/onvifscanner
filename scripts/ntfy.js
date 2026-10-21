const { decryptSecret, getInternalWorkerToken } = require('./security');

function normalizeNtfyServer(value) {
  const trimmed = String(value || '').trim().replace(/\/+$/, '');
  if (!trimmed) return 'https://ntfy.sh';
  const raw = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Ungültiges ntfy-Protokoll.');
    }
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host === '[::1]' ||
      host.startsWith('127.') ||
      host.startsWith('169.254.')
    ) {
      throw new Error('Loopback-Adressen sind als ntfy-Server nicht erlaubt.');
    }
    return parsed.origin + parsed.pathname.replace(/\/+$/, '');
  } catch (err) {
    throw new Error(err?.message || 'Ungültige ntfy-Server-URL.');
  }
}

function encodeHeaderValue(value) {
  const text = String(value || '');
  return /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${Buffer.from(text).toString('base64')}?=`;
}

function notificationFilename(camera) {
  const name = String(camera?.name || camera?.ip || 'kamera')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'kamera';
  return `${name}-${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`;
}

async function fetchCameraImage(camera) {
  let snapshotUris = [];
  let streamUris = [];
  try { snapshotUris = JSON.parse(camera.snapshotUris || '[]'); } catch {}
  try { streamUris = JSON.parse(camera.streamUris || '[]'); } catch {}
  const subStream = streamUris.find((u) => /sub(stream|_|\/)?|102|subtype=1|stream2|profile2|channel=?2|second/i.test(u))
    || (streamUris.length > 1 ? streamUris[1] : null);
  const mainStream = streamUris.find((u) => /main(stream|_|\/)?|101|subtype=0|stream1|profile1|channel=?1|first/i.test(u))
    || streamUris[0];
  const urls = [...snapshotUris, subStream, mainStream, ...streamUris].filter((url, idx, arr) => typeof url === 'string' && url && arr.indexOf(url) === idx);
  if (!urls.length) return null;

  const imageWidth = Math.max(480, Math.min(1280, Number(process.env.NTFY_IMAGE_WIDTH) || 960));
  const imageQuality = Math.max(60, Math.min(90, Number(process.env.NTFY_IMAGE_QUALITY) || 82));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7_000);
  try {
    const response = await fetch(`http://127.0.0.1:${process.env.PORT || '3000'}/api/thumbnail`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-worker': 'true',
        'x-internal-worker-token': getInternalWorkerToken(),
      },
      body: JSON.stringify({
        cameraId: camera.id,
        urls,
        size: imageWidth,
        quality: imageQuality,
        timeoutMs: 4_500,
        fastAuth: true,
        fresh: true,
        credentials: camera.username ? { username: camera.username, password: decryptSecret(camera.password) } : undefined,
      }),
      signal: controller.signal,
    });
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || !contentType.toLowerCase().startsWith('image/')) return null;
    return {
      data: Buffer.from(await response.arrayBuffer()),
      contentType,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function publishNtfy(url, notification, attachment, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const headers = {
      Title: encodeHeaderValue(options.title || 'ONVIFscanner Alarm'),
      Priority: options.priority || 'high',
      Tags: options.tags || 'rotating_light,video_camera',
    };
    if (attachment?.data?.length) {
      headers.Message = encodeHeaderValue(notification);
      headers.Filename = notificationFilename(attachment.camera);
      headers['Content-Type'] = attachment.contentType || 'image/jpeg';
    }
    return await fetch(url, {
      method: 'POST',
      body: attachment?.data?.length ? attachment.data : notification,
      headers,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

const { sendTelegramNotification } = require('./telegram');
const { hasSubscriptions, sendWebPushNotification } = require('./webpush');

async function sendCameraNotification(prisma, camera, message, options = {}) {
  if (!camera?.notificationsEnabled && !options.force) return { sent: false, reason: 'disabled' };

  const settings = await prisma.settings.findUnique({ where: { id: 'default' } });

  // Evaluate ntfy eligibility
  const ntfyTopic = String(settings?.ntfyTopic || '').trim();
  const ntfyEligible = Boolean(ntfyTopic) && (!options.statusNotification || Boolean(settings?.ntfyCameraStatusEnabled));

  // Evaluate Telegram eligibility
  const telegramBotToken = String(settings?.telegramBotToken || '').trim();
  const telegramChatId = String(settings?.telegramChatId || '').trim();
  const telegramEnabled = settings?.telegramEnabled !== false;
  const telegramEligible = Boolean(telegramBotToken && telegramChatId && telegramEnabled) &&
    (!options.statusNotification || Boolean(settings?.telegramCameraStatusEnabled));

  // Evaluate Web-Push eligibility
  const webpushEligible = hasSubscriptions() && (!options.statusNotification);

  if (!ntfyEligible && !telegramEligible && !webpushEligible) {
    if (options.statusNotification) {
      return { sent: false, reason: 'status-notifications-disabled' };
    }
    console.warn(`🔕 Push for ${camera.name} skipped: no notification provider (webpush / ntfy / telegram) configured.`);
    return { sent: false, reason: 'missing-provider' };
  }

  // Pre-fetch camera image if needed
  let fetchedImage = null;
  if (options.includeImage !== false) {
    if (options.imageBuffer?.length) {
      fetchedImage = { data: options.imageBuffer, contentType: options.contentType || 'image/jpeg' };
    } else {
      fetchedImage = await fetchCameraImage(camera);
    }
  }

  const notification = `Kamera: ${camera.name}\nEreignis: ${message}`;
  const results = { ntfy: null, telegram: null };

  // Dispatch ntfy
  if (ntfyEligible) {
    const ntfyUrl = `${normalizeNtfyServer(settings?.ntfyServer)}/${encodeURIComponent(ntfyTopic)}`;
    try {
      let imageAttached = Boolean(fetchedImage);
      let response = await publishNtfy(ntfyUrl, notification, fetchedImage ? { ...fetchedImage, camera } : null, options);
      if (!response.ok && fetchedImage) {
        console.warn(`🔕 Image push for ${camera.name} returned HTTP ${response.status}; retrying without image.`);
        response = await publishNtfy(ntfyUrl, notification, null, options);
        imageAttached = false;
      }
      if (!response.ok) {
        const detail = (await response.text().catch(() => '')).trim().slice(0, 240);
        throw new Error(`HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
      }
      console.log(`🔔 ntfy push sent for ${camera.name}${imageAttached ? ' with image' : ''}.`);
      results.ntfy = { sent: true, imageAttached };
    } catch (error) {
      console.error(`🔕 ntfy push for ${camera.name} failed:`, error?.message || error);
      results.ntfy = { sent: false, error: error?.message || String(error) };
    }
  }

  // Dispatch Telegram
  if (telegramEligible) {
    try {
      const tgRes = await sendTelegramNotification({
        botToken: telegramBotToken,
        chatId: telegramChatId,
        text: notification,
        imageBuffer: fetchedImage?.data,
        contentType: fetchedImage?.contentType || 'image/jpeg',
        filename: notificationFilename(camera),
      });
      if (tgRes.sent) {
        console.log(`🔔 Telegram push sent for ${camera.name}${tgRes.withImage ? ' with image' : ''}.`);
        results.telegram = { sent: true, imageAttached: tgRes.withImage };
      } else {
        console.error(`🔕 Telegram push for ${camera.name} failed:`, tgRes.error || tgRes.reason);
        results.telegram = { sent: false, error: tgRes.error || tgRes.reason };
      }
    } catch (error) {
      console.error(`🔕 Telegram push for ${camera.name} failed:`, error?.message || error);
      results.telegram = { sent: false, error: error?.message || String(error) };
    }
  }

  // Dispatch Web-Push
  if (webpushEligible) {
    try {
      const wpRes = await sendWebPushNotification({
        title: `🚨 ${camera.name}`,
        body: message,
        url: '/',
        tag: `cam-${camera.id}`,
      });
      if (wpRes.sentCount > 0) {
        console.log(`🔔 Web-Push sent for ${camera.name} to ${wpRes.sentCount} device(s).`);
        results.webpush = { sent: true, count: wpRes.sentCount };
      } else {
        results.webpush = { sent: false, count: 0 };
      }
    } catch (error) {
      console.error(`🔕 Web-Push for ${camera.name} failed:`, error?.message || error);
      results.webpush = { sent: false, error: error?.message || String(error) };
    }
  }

  const anySent = Boolean(results.ntfy?.sent || results.telegram?.sent || results.webpush?.sent);
  return { sent: anySent, ...results };
}

module.exports = { sendCameraNotification, fetchCameraImage };

