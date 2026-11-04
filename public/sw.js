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
  // The grid's pages of photos. Without them a saved gallery lays out the 60
  // photos its HTML seeds and stops; they are kept only for a saved gallery.
  const isPhotosPage = isPhotosApi(request.url);
  if (!isPhoto && !isPage && !isAsset && !isPhotosPage) return;

  event.respondWith(
    (async () => {
      let cached = await caches.match(request, { ignoreVary: true, ignoreSearch: false });
      // A photo's link (`?foto=`, docs/PHOTO-LINKS.md) or any other added
      // parameter is still the same gallery page: the saved copy opens it, and
      // the page's own script opens the photo from the address.
      if (!cached && isPage) {
        cached = await caches.match(request, { ignoreVary: true, ignoreSearch: true });
      }

      // A page (and its photo data) is served network-first: online, the viewer
      // should see current favourites and reactions, not last week's snapshot.
      if (isPage || isPhotosPage) {
        if (!cached) return fetch(request);
        return networkFirst(event, request, cached, isPage);
      }

      // Photos are immutable per object key and Next.js asset filenames are
      // content-hashed, so a hit is always current for both.
      return cached ?? fetch(request);
    })(),
  );
});

/**
 * How long a saved gallery waits for the network before showing its copy. On
 * one bar at a crowded venue a request can hang for a minute without failing,
 * and network-first then meant a blank page for exactly the people who saved
 * the gallery for this situation. The network keeps going after the copy is
 * shown, and what it brings updates the copy for next time.
 */
const NETWORK_TIMEOUT_MS = 3000;

/** Statuses that mean the share link is gone (or never existed). */
const GONE_STATUSES = new Set([403, 404, 410]);

/** Network first for something that has a saved copy, bounded by `NETWORK_TIMEOUT_MS`. */
function networkFirst(event, request, cached, isPage) {
  const network = fetch(request);
  // Registered first, so the clone is taken before the response is handed to
  // the page; `waitUntil` keeps the worker alive for it after a timeout.
  event.waitUntil(
    network.then((response) => settle(request, response.clone(), isPage)).catch(() => {}),
  );

  const fromNetwork = network.then(
    // A link that is gone shows the visitor why; a server error shows the copy.
    (response) => (response.ok || GONE_STATUSES.has(response.status) ? response : cached),
    () => cached,
  );
  const timeout = new Promise((resolve) => setTimeout(() => resolve(cached), NETWORK_TIMEOUT_MS));
  return Promise.race([fromNetwork, timeout]);
}

/**
 * What a network answer means for the saved copy: refresh it, or drop the
 * whole gallery.
 *
 * The link was revoked or expired: drop what we kept for it, even though
 * cached bytes on a device can never be truly recalled. An unknown link is a
 * 404, but an expired or revoked one — and a gallery taken off a wedding page —
 * renders its dead end with a 200 (an App Router page cannot set a status), so
 * the page carries a marker instead (`DeadLinkMarker`, share-link-dead.tsx).
 */
async function settle(request, response, isPage) {
  if (GONE_STATUSES.has(response.status)) {
    await dropCacheFor(request.url);
    return;
  }
  if (!response.ok) return;
  if (isPage) {
    const html = await response.clone().text();
    if (html.includes(DEAD_LINK_MARKER)) {
      await dropCacheFor(request.url);
      return;
    }
  }
  await refreshCached(request, response);
}

/** Must match the meta tag `DeadLinkMarker` renders (src/components/share-link-dead.tsx). */
const DEAD_LINK_MARKER = "gg-share-link-dead";

/** `/api/g/{token}/photos` on this origin, with or without a cursor. */
function isPhotosApi(url) {
  const parsed = new URL(url);
  return (
    parsed.origin === self.location.origin && /^\/api\/g\/[^/]+\/photos$/.test(parsed.pathname)
  );
}

/**
 * Keeps an already-offline gallery's page or photo data current without
 * creating either: only an entry that exists under this exact address is
 * replaced.
 */
async function refreshCached(request, response) {
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

/** Deletes the whole saved gallery that holds `url` (also a `?foto=` link to its page). */
async function dropCacheFor(url) {
  const names = await caches.keys();
  for (const name of names) {
    if (!name.startsWith(CACHE_PREFIX)) continue;
    const cache = await caches.open(name);
    if (
      (await cache.match(url, { ignoreVary: true })) ||
      (await cache.match(url, { ignoreVary: true, ignoreSearch: true }))
    ) {
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
        // The app's own URLs (the page, its photo data, its JS and CSS) go with
        // the viewer's cookies: without them a password-protected gallery was
        // saved as its password form, and the page in the browser's language
        // rather than the one the viewer picked. Photos stay credential-less.
        const sameOrigin = new URL(url, self.location.href).origin === self.location.origin;
        const response = await fetch(url, {
          mode: "cors",
          credentials: sameOrigin ? "same-origin" : "omit",
        });
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
