const fs = require('fs');
const path = require('path');
const webpush = require('web-push');

const DATA_DIR = path.join(process.cwd(), 'data');
const KEYS_FILE = path.join(DATA_DIR, 'webpush-keys.json');
const SUBS_FILE = path.join(DATA_DIR, 'webpush-subscriptions.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadOrGenerateVapidKeys() {
  ensureDataDir();
  try {
    if (fs.existsSync(KEYS_FILE)) {
      const content = fs.readFileSync(KEYS_FILE, 'utf8');
      const parsed = JSON.parse(content);
      if (parsed?.publicKey && parsed?.privateKey) {
        return parsed;
      }
    }
  } catch (err) {
    console.warn('[WebPush] Error reading VAPID keys, generating new ones:', err.message);
  }

  const keys = webpush.generateVAPIDKeys();
  try {
    fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2), 'utf8');
    console.log('[WebPush] Generated new VAPID keys successfully.');
  } catch (err) {
    console.error('[WebPush] Failed to write VAPID keys file:', err.message);
  }
  return keys;
}

const vapidKeys = loadOrGenerateVapidKeys();
try {
  webpush.setVapidDetails(
    'mailto:admin@onvifscanner.local',
    vapidKeys.publicKey,
    vapidKeys.privateKey
  );
} catch (err) {
  console.error('[WebPush] Failed to configure VAPID details:', err.message);
}

function getVapidPublicKey() {
  return vapidKeys.publicKey;
}

function loadSubscriptions() {
  ensureDataDir();
  try {
    if (fs.existsSync(SUBS_FILE)) {
      const content = fs.readFileSync(SUBS_FILE, 'utf8');
      const list = JSON.parse(content);
      return Array.isArray(list) ? list : [];
    }
  } catch (err) {
    console.warn('[WebPush] Could not read subscriptions:', err.message);
  }
  return [];
}

function saveSubscriptions(list) {
  ensureDataDir();
  try {
    fs.writeFileSync(SUBS_FILE, JSON.stringify(list, null, 2), 'utf8');
  } catch (err) {
    console.error('[WebPush] Could not save subscriptions:', err.message);
  }
}

function addSubscription(subscription, userAgent = '') {
  if (!subscription || !subscription.endpoint || !subscription.keys) {
    throw new Error('Ungültiges Push-Subscription-Format.');
  }
  const current = loadSubscriptions();
  const existingIdx = current.findIndex((s) => s.endpoint === subscription.endpoint);
  const record = {
    endpoint: subscription.endpoint,
    keys: {
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
    },
    userAgent: userAgent || 'Browser',
    subscribedAt: new Date().toISOString(),
  };

  if (existingIdx >= 0) {
    current[existingIdx] = record;
  } else {
    current.push(record);
  }
  saveSubscriptions(current);
  return { ok: true, total: current.length };
}

function removeSubscription(endpoint) {
  if (!endpoint) return false;
  const current = loadSubscriptions();
  const filtered = current.filter((s) => s.endpoint !== endpoint);
  if (filtered.length !== current.length) {
    saveSubscriptions(filtered);
    return true;
  }
  return false;
}

function hasSubscriptions() {
  const current = loadSubscriptions();
  return current.length > 0;
}

async function sendWebPushNotification({
  title = 'ONVIFscanner Alarm',
  body = 'Bewegung erkannt!',
  icon = '/icon-192.png',
  image = null,
  url = '/',
  tag = 'camera-motion',
}) {
  const subscriptions = loadSubscriptions();
  if (subscriptions.length === 0) {
    return { sentCount: 0, failedCount: 0, total: 0 };
  }

  const payload = JSON.stringify({
    title,
    body,
    icon,
    image,
    url,
    tag,
    timestamp: Date.now(),
  });

  const deadEndpoints = new Set();
  let sentCount = 0;
  let failedCount = 0;

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: sub.keys,
          },
          payload,
          {
            TTL: 60 * 60, // 1 hour
            urgency: 'high',
          }
        );
        sentCount++;
      } catch (err) {
        failedCount++;
        // 404 or 410 Gone means the subscription is expired / revoked by the user
        if (err.statusCode === 404 || err.statusCode === 410) {
          deadEndpoints.add(sub.endpoint);
        } else {
          console.warn('[WebPush] Error sending push to endpoint:', err.statusCode || err.message);
        }
      }
    })
  );

  // Prune dead subscriptions
  if (deadEndpoints.size > 0) {
    const alive = subscriptions.filter((s) => !deadEndpoints.has(s.endpoint));
    saveSubscriptions(alive);
    console.log(`[WebPush] Pruned ${deadEndpoints.size} expired push subscription(s).`);
  }

  return { sentCount, failedCount, total: subscriptions.length };
}

module.exports = {
  getVapidPublicKey,
  loadSubscriptions,
  addSubscription,
  removeSubscription,
  hasSubscriptions,
  sendWebPushNotification,
};
