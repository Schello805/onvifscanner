// ONVIFscanner Service Worker for Web-Push & PWA

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { body: event.data.text() };
    }
  }

  const title = data.title || "🚨 ONVIFscanner Alarm";
  const options = {
    body: data.body || "Bewegung erkannt!",
    icon: data.icon || "/icon-192.png",
    badge: "/icon-192.png",
    image: data.image || undefined,
    data: {
      url: data.url || "/",
      timestamp: data.timestamp || Date.now(),
    },
    vibrate: [200, 100, 200, 100, 200],
    tag: data.tag || "camera-motion",
    renotify: true,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      // If a tab is already open at the target URL or app, focus it
      for (const client of windowClients) {
        if ("focus" in client) {
          if (client.url.includes(targetUrl) || targetUrl === "/") {
            return client.focus();
          }
        }
      }
      // Otherwise open a new window
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
