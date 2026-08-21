// Push service worker for the admin PWA.
//
// Kept deliberately minimal: it exists to receive owner notifications, not to
// cache anything. Photo bytes must never be served from a cache we control —
// they come from R2 through the CDN (CLAUDE.md invariant #1).

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    return;
  }

  event.waitUntil(
    self.registration.showNotification(payload.title ?? "g-gallery", {
      body: payload.body ?? "",
      // Same tag = a second notification replaces the first instead of stacking.
      tag: payload.url ?? "g-gallery",
      data: { url: payload.url ?? "/admin" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url ?? "/admin";

  // Focus an already-open admin tab rather than opening a duplicate.
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes("/admin") && "focus" in client) return client.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});
