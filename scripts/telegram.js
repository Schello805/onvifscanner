async function sendTelegramNotification({
  botToken,
  chatId,
  text,
  imageBuffer,
  contentType = 'image/jpeg',
  filename = 'kamera.jpg',
}) {
  const token = String(botToken || '').trim();
  const chat = String(chatId || '').trim();

  if (!token || !chat) {
    return { sent: false, reason: 'missing-credentials' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    if (imageBuffer && imageBuffer.length > 0) {
      try {
        const formData = new FormData();
        formData.append('chat_id', chat);
        formData.append('caption', text);

        const blob = new Blob([imageBuffer], { type: contentType });
        formData.append('photo', blob, filename);

        const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
          method: 'POST',
          body: formData,
          signal: controller.signal,
        });

        if (res.ok) {
          return { sent: true, withImage: true };
        }

        const errJson = await res.json().catch(() => null);
        console.warn(`[Telegram] sendPhoto failed (${res.status}: ${errJson?.description || 'unknown'}), falling back to text`);
      } catch (photoErr) {
        if (photoErr.name === 'AbortError') {
          throw new Error('Telegram timeout after 8s');
        }
        console.warn('[Telegram] sendPhoto exception:', photoErr.message);
      }
    }

    const textRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chat,
        text,
      }),
      signal: controller.signal,
    });

    if (!textRes.ok) {
      const errJson = await textRes.json().catch(() => null);
      throw new Error(`Telegram HTTP ${textRes.status}: ${errJson?.description || 'Unknown error'}`);
    }

    return { sent: true, withImage: false };
  } catch (error) {
    return { sent: false, error: error.message || String(error) };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { sendTelegramNotification };
