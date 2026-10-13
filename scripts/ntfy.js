function normalizeNtfyServer(value) {
  const trimmed = String(value || '').trim().replace(/\/+$/, '');
  if (!trimmed) return 'https://ntfy.sh';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
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
  const urls = [...snapshotUris, ...streamUris].filter((url) => typeof url === 'string' && url);
  if (!urls.length) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(`http://127.0.0.1:${process.env.PORT || '3000'}/api/thumbnail`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        urls,
        size: 480,
        timeoutMs: 3_000,
        fastAuth: true,
        fresh: true,
        credentials: camera.username ? { username: camera.username, password: camera.password || '' } : undefined,
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

async function publishNtfy(url, notification, attachment) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const headers = {
      Title: encodeHeaderValue('ONVIFscanner Alarm'),
      Priority: 'high',
      Tags: 'rotating_light,video_camera',
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

async function sendCameraNotification(prisma, camera, message, options = {}) {
  if (!camera?.notificationsEnabled) return { sent: false, reason: 'disabled' };

  const settings = await prisma.settings.findUnique({ where: { id: 'default' } });
  const topic = String(settings?.ntfyTopic || '').trim();
  if (!topic) {
    console.warn(`🔕 Push for ${camera.name} skipped: no ntfy topic configured.`);
    return { sent: false, reason: 'missing-topic' };
  }

  const notification = `Kamera: ${camera.name}\nEreignis: ${message}`;
  const ntfyUrl = `${normalizeNtfyServer(settings?.ntfyServer)}/${encodeURIComponent(topic)}`;
  try {
    const fetchedImage = options.imageBuffer?.length
      ? { data: options.imageBuffer, contentType: options.contentType || 'image/jpeg' }
      : await fetchCameraImage(camera);
    let imageAttached = Boolean(fetchedImage);
    let response = await publishNtfy(ntfyUrl, notification, fetchedImage ? { ...fetchedImage, camera } : null);
    if (!response.ok && fetchedImage) {
      console.warn(`🔕 Image push for ${camera.name} returned HTTP ${response.status}; retrying without image.`);
      response = await publishNtfy(ntfyUrl, notification, null);
      imageAttached = false;
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).trim().slice(0, 240);
      throw new Error(`HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
    }
    console.log(`🔔 Push sent for ${camera.name}${imageAttached ? ' with image' : ''}.`);
    return { sent: true, imageAttached };
  } catch (error) {
    console.error(`🔕 Push for ${camera.name} failed:`, error?.message || error);
    return { sent: false, reason: error?.message || String(error) };
  }
}

module.exports = { sendCameraNotification };
