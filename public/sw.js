/// <reference lib="webworker" />

// Service worker for owner push notifications and offline galleries.
//
// It caches nothing on its own. Photos land in a cache only when a viewer
// explicitly asks for the gallery offline, and they are served from there
// afterwards. A gallery you merely opened must never quietly consume 70 MB of
// someone's phone.

const CACHE_PREFIX = "gg-offline-";

// ---------------------------------------------------------------------------
// Push (owner notifications)
// ---------------------------------------------------------------------------

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

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes("/admin") && "focus" in client) return client.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

self.addEventListener("install", () => {
  // No precaching here: an install-time cache would download photos for a
  // gallery the viewer never asked to keep.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

/**
 * Cache-first, but only for things already cached.
 *
 * Nothing is written here. A request that misses goes to the network and is
 * NOT stored, so browsing a gallery online never grows the cache behind the
 * viewer's back — only an explicit "keep offline" does.
 *
 * `ignoreVary` matters: the transform host sends `Vary: Accept`, and the Accept
 * header an <img> sends differs from the one fetch() sends. Without it every
 * precached photo would be stored under one key and looked up under another,
 * and the cache would appear empty exactly when it is needed.
 */
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const isPhoto = request.destination === "image";
  const isPage = request.mode === "navigate";
  // The app's own JS and CSS matter as much as the photos: a cached page that
  // cannot hydrate renders once and is then completely inert — no lightbox, no
  // favourites, no selection. Found by actually loading it with the server off.
  const isAsset = ["script", "style", "font"].includes(request.destination);
  if (!isPhoto && !isPage && !isAsset) return;

  event.respondWith(
    (async () => {
      const cached = await caches.match(request, { ignoreVary: true, ignoreSearch: false });

      // A page is served network-first: online, the viewer should see current
      // favourites and reactions, not a snapshot from last week.
      if (isPage) {
        try {
          const response = await fetch(request);
          if (response.ok) {
            await refreshCachedPage(request, response.clone());
            return response;
          }
          // The link was revoked or expired: drop what we kept for it, even
          // though cached bytes on a device can never be truly recalled.
          if (response.status === 403 || response.status === 404 || response.status === 410) {
            await dropCacheFor(request.url);
            return response;
          }
          return cached ?? response;
        } catch {
          return cached ?? Response.error();
        }
      }

      // Photos are immutable per object key and Next.js asset filenames are
      // content-hashed, so a hit is always current for both.
      return cached ?? fetch(request);
    })(),
  );
});

/** Keeps an already-offline gallery's shell current without creating one. */
async function refreshCachedPage(request, response) {
  const names = await caches.keys();
  for (const name of names) {
    if (!name.startsWith(CACHE_PREFIX)) continue;
    const cache = await caches.open(name);
    if (await cache.match(request, { ignoreVary: true })) {
      await cache.put(request, response);
      return;
    }
  }
}

async function dropCacheFor(url) {
  const names = await caches.keys();
  for (const name of names) {
    if (!name.startsWith(CACHE_PREFIX)) continue;
    const cache = await caches.open(name);
    if (await cache.match(url, { ignoreVary: true })) {
      await caches.delete(name);
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Offline downloads, driven by the page
// ---------------------------------------------------------------------------

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;

  if (data.type === "PRECACHE") {
    event.waitUntil(precache(data, event.source));
  } else if (data.type === "REMOVE") {
    event.waitUntil(caches.delete(cacheName(data.key)));
  } else if (data.type === "STATUS") {
    event.waitUntil(reportStatus(data.key, event.source));
  }
});

function cacheName(key) {
  return `${CACHE_PREFIX}${key}`;
}

/**
 * Downloads a gallery for offline use, reporting progress as it goes.
 *
 * Requests are made with `mode: "cors"` deliberately. A no-cors request yields
 * an opaque response, which Chrome pads to roughly 7 MB per entry when counting
 * quota — 500 photos would claim about 3.5 GB instead of 70 MB, and would blow
 * the quota on most phones. It also hides failures: an opaque response reports
 * status 0 whether it succeeded or 404'd.
 */
async function precache(data, client) {
  const cache = await caches.open(cacheName(data.key));
  const urls = Array.isArray(data.urls) ? data.urls : [];

  let done = 0;
  let failed = 0;
  let bytes = 0;
  let cursor = 0;
  let aborted = null;

  const post = (type) => {
    client?.postMessage({ type, key: data.key, done, failed, bytes, total: urls.length, aborted });
  };

  // Modest concurrency: a phone on mobile data does not benefit from 20 open
  // connections, and the transform host is doing real work per request.
  const workers = Array.from({ length: Math.min(4, urls.length) }, async () => {
    for (;;) {
      if (aborted) return;
      const url = urls[cursor++];
      if (url === undefined) return;

      try {
        const response = await fetch(url, { mode: "cors", credentials: "omit" });
        if (!response.ok) {
          failed += 1;
          continue;
        }
        const size = Number(response.headers.get("content-length") ?? 0);
        await cache.put(url, response.clone());
        bytes += size;
        done += 1;
      } catch (error) {
        // Out of space is terminal: every further request would fail the same
        // way, so stop rather than grinding through 500 of them.
        if (error && error.name === "QuotaExceededError") {
          aborted = "quota";
          return;
        }
        failed += 1;
      }

      if ((done + failed) % 5 === 0) post("PRECACHE_PROGRESS");
    }
  });

  await Promise.all(workers);

  if (aborted) await caches.delete(cacheName(data.key));
  post("PRECACHE_DONE");
}

async function reportStatus(key, client) {
  const cache = await caches.open(cacheName(key));
  const keys = await cache.keys();
  client?.postMessage({ type: "STATUS", key, count: keys.length });
}
