// PG Ride Service Worker — Push Notification Handler

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let data = {};
  try {
    data = event.data.json();
  } catch {
    data = { title: "PG Ride", body: event.data.text() };
  }

  const title = data.title || "PG Ride";
  const options = {
    body: data.body || "",
    icon: data.icon || "/icons/icon-192.png",
    badge: "/icons/icon-72.png",
    tag: data.tag || "pg-ride-notification",
    data: { url: data.url || "/" },
    requireInteraction: data.requireInteraction || false,
    vibrate: [200, 100, 200],
    actions: data.actions || [],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(url);
      }
    })
  );
});

// E5 — Lock-screen-adjacent ride widget data (badge + shortcut context)
let rideWidget = { rideId: null, status: null, etaMinutes: null, driverName: null };

self.addEventListener("message", (event) => {
  if (event.data?.type !== "RIDE_WIDGET_UPDATE") return;
  rideWidget = { ...rideWidget, ...event.data.payload };
  if (rideWidget.rideId && rideWidget.status && self.registration.setAppBadge) {
    const label = rideWidget.etaMinutes ? `${rideWidget.etaMinutes}` : "•";
    self.registration.setAppBadge(label).catch(() => {});
  } else if (self.registration.clearAppBadge) {
    self.registration.clearAppBadge().catch(() => {});
  }
});
