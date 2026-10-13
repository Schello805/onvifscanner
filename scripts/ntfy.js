function normalizeNtfyServer(value) {
  const trimmed = String(value || '').trim().replace(/\/+$/, '');
  if (!trimmed) return 'https://ntfy.sh';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

async function sendCameraNotification(prisma, camera, message) {
  if (!camera?.notificationsEnabled) return { sent: false, reason: 'disabled' };

  const settings = await prisma.settings.findUnique({ where: { id: 'default' } });
  const topic = String(settings?.ntfyTopic || '').trim();
  if (!topic) {
    console.warn(`🔕 Push for ${camera.name} skipped: no ntfy topic configured.`);
    return { sent: false, reason: 'missing-topic' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${normalizeNtfyServer(settings?.ntfyServer)}/${encodeURIComponent(topic)}`, {
      method: 'POST',
      body: `Kamera: ${camera.name}\nEreignis: ${message}`,
      headers: {
        Title: 'ONVIFscanner Alarm',
        Priority: 'high',
        Tags: 'rotating_light,video_camera',
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).trim().slice(0, 240);
      throw new Error(`HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
    }
    console.log(`🔔 Push sent for ${camera.name}.`);
    return { sent: true };
  } catch (error) {
    console.error(`🔕 Push for ${camera.name} failed:`, error?.message || error);
    return { sent: false, reason: error?.message || String(error) };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { sendCameraNotification };
