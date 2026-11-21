self.addEventListener("push", event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = { body: event.data?.text() || "لديك إشعار جديد" }; }
  const title = payload.title || "إشعار جديد";
  const options = {
    body: payload.body || "لديك تحديث جديد في المنصة.",
    icon: "/logo.jpg",
    badge: "/logo.jpg",
    tag: payload.tag || `school-${Date.now()}`,
    renotify: true,
    requireInteraction: payload.kind === "lesson-reminder",
    vibrate: [180, 90, 180],
    data: { url: payload.url || "/" }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if ("focus" in client) {
        await client.focus();
        if ("navigate" in client) await client.navigate(target);
        return;
      }
    }
    if (clients.openWindow) await clients.openWindow(target);
  })());
});
