"use client";

import imageLoader from "@/lib/image-loader";
import { DEVICE_SIZES, IMAGE_SIZES, QUALITY } from "@/lib/image-sizes";

/**
 * Keeping a gallery on the device.
 *
 * Deliberately opt-in, with the real size shown first. The viewer may well be
 * on mobile data, and a 500-photo gallery is 170 MB on a modern phone — worth
 * having, not worth taking without asking.
 *
 * What gets kept is the size this device displays, not the original: 500
 * originals is about 8 GB. Nobody needs 45-megapixel drone frames on a phone.
 */

/**
 * Measured AVIF sizes for a typical 6720×4480 wedding JPEG at quality 82.
 *
 * A single average would be badly wrong in both directions: the variant a
 * phone at DPR 3 requests is 1920w, six times the bytes of the 640w a desktop
 * grid uses. The viewer is told a real number before anything downloads, so
 * the number has to depend on their screen.
 */
const BYTES_BY_WIDTH: Record<number, number> = {
  384: 20_000,
  640: 50_000,
  1080: 120_000,
  1920: 305_000,
  2560: 595_000,
};

/** Refuse to start if it would not leave this much headroom. */
const MIN_FREE_BYTES = 200 * 1024 * 1024;

export interface OfflineProgress {
  done: number;
  failed: number;
  total: number;
  bytes: number;
  aborted: "quota" | null;
}

export type OfflineSupport =
  | { supported: true }
  | { supported: false; reason: "no_service_worker" | "no_cache_api" | "insecure_context" };

export function offlineSupport(): OfflineSupport {
  if (typeof window === "undefined") return { supported: false, reason: "no_service_worker" };
  // Service workers need a secure context; localhost counts as one.
  if (!window.isSecureContext) return { supported: false, reason: "insecure_context" };
  if (!("serviceWorker" in navigator)) return { supported: false, reason: "no_service_worker" };
  if (!("caches" in window)) return { supported: false, reason: "no_cache_api" };
  return { supported: true };
}

/**
 * The widths this device will actually request.
 *
 * Caching every width would multiply both the download and the billed
 * transformations by five, and four of the five would never be displayed. The
 * browser picks from `srcset` by viewport times pixel ratio, so the same
 * arithmetic done here yields the one candidate it will ask for.
 */
export function widthsForThisDevice(): { grid: number; full: number } {
  // A Client Component still renders once on the server. Without this guard
  // the whole share page 500s — reading window during that pass throws.
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  const viewport = typeof window === "undefined" ? 1024 : window.innerWidth || 1024;

  const pick = (target: number, sizes: readonly number[]) =>
    sizes.find((size) => size >= target) ?? sizes[sizes.length - 1]!;

  return {
    // Grid tiles are at most a quarter of the viewport on a wide screen and
    // half on a phone; the smaller set covers both.
    grid: pick(Math.ceil((viewport / 2) * dpr), [...IMAGE_SIZES, ...DEVICE_SIZES]),
    full: pick(Math.ceil(viewport * dpr), DEVICE_SIZES),
  };
}

/**
 * The app's own scripts and stylesheets, read off the live document.
 *
 * Without these the cached page renders once and is then inert — no lightbox,
 * no favourites, no selection — because React never hydrates. Enumerating the
 * DOM rather than hardcoding paths keeps this correct across builds, where the
 * filenames are content-hashed.
 */
function appAssetUrls(): string[] {
  if (typeof document === "undefined") return [];

  const scripts = [...document.querySelectorAll<HTMLScriptElement>("script[src]")].map(
    (el) => el.src,
  );
  const styles = [
    ...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href]'),
  ].map((el) => el.href);

  // Same-origin only: a third-party script has no business in this cache.
  return [...scripts, ...styles].filter((url) => new URL(url).origin === location.origin);
}

/**
 * Every URL needed to browse the gallery without a network. `extraUrls` are
 * the gallery's own same-origin data (the photos API pages, see
 * `fetchGalleryIndex`), without which the grid stops at the page the HTML
 * seeded.
 */
export function offlineUrls(
  objectKeys: readonly string[],
  pageUrl: string,
  extraUrls: readonly string[] = [],
): string[] {
  const { grid, full } = widthsForThisDevice();
  const urls = new Set<string>([pageUrl, ...extraUrls, ...appAssetUrls()]);

  for (const key of objectKeys) {
    urls.add(imageLoader({ src: key, width: grid, quality: QUALITY }));
    urls.add(imageLoader({ src: key, width: full, quality: QUALITY }));
  }
  return [...urls];
}

/** The grid-sized image URL kept for one photo — what "saved" counts. */
export function offlineGridUrl(objectKey: string): string {
  return imageLoader({ src: objectKey, width: widthsForThisDevice().grid, quality: QUALITY });
}

/**
 * The address the gallery's page is kept under: the one it was saved from,
 * without an open photo (`?foto=`, docs/PHOTO-LINKS.md) or a chapter anchor —
 * opening the saved copy should open the gallery, not the photo that happened
 * to be on screen. Other parameters stay (they are part of the address).
 */
export function offlinePageUrl(href: string): string {
  const url = new URL(href);
  url.searchParams.delete("foto");
  url.hash = "";
  return url.href;
}

/** The photos API address the grid asks for a page at (gallery-view.tsx `fetchPhotos`). */
export function photosApiUrl(origin: string, token: string, cursor: string | null): string {
  const query = new URLSearchParams(cursor ? { cursor } : {});
  const search = query.size > 0 ? `?${query}` : "";
  return `${origin}/api/g/${encodeURIComponent(token)}/photos${search}`;
}

/** Most pages read for one offline save — 60 photos each, far past any real gallery. */
const MAX_INDEX_PAGES = 200;

export interface GalleryIndex {
  /** Every confirmed photo's (or video poster's) object key, in the gallery's order. */
  objectKeys: string[];
  /** The photos API pages read, at the very addresses the grid asks for them. */
  pageUrls: string[];
  /** False when a page failed: `objectKeys` then holds only what was read before it. */
  complete: boolean;
}

/**
 * The whole gallery's key list, paged through the public photos API — the same
 * route, cursors and share-link checks the grid itself uses, so nothing new is
 * exposed. The grid only holds the pages scrolled to so far, so saving from it
 * kept the first 60 photos of a 500-photo gallery.
 *
 * Same-origin JSON only; image bytes never pass through here (invariant 1).
 */
export async function fetchGalleryIndex(
  token: string,
  origin: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GalleryIndex> {
  const objectKeys: string[] = [];
  const pageUrls: string[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < MAX_INDEX_PAGES; page++) {
    const url = photosApiUrl(origin, token, cursor);
    let body: { items?: { objectKey: string }[]; nextCursor?: string | null } | null = null;
    try {
      const response = await fetchImpl(url, { credentials: "same-origin" });
      body = response.ok ? await response.json() : null;
    } catch {
      body = null;
    }
    if (!body || !Array.isArray(body.items)) return { objectKeys, pageUrls, complete: false };

    pageUrls.push(url);
    for (const item of body.items) objectKeys.push(item.objectKey);
    cursor = body.nextCursor ?? null;
    if (!cursor) return { objectKeys, pageUrls, complete: true };
  }
  return { objectKeys, pageUrls, complete: false };
}

/**
 * A small record of what an offline save holds, kept in the gallery's own
 * cache so it goes when the cache goes (eviction, removal, a dead link). No
 * page ever requests this address; it only names the entry.
 */
export const OFFLINE_META_PATH = "/__gg-offline-meta";

export interface OfflineMeta {
  /** Photos whose grid image made it into the cache. */
  saved: number;
  /** The gallery's photo count when it was saved. */
  total: number;
}

/** What this gallery will actually cost on this screen. */
export function estimateBytes(photoCount: number): number {
  const { grid, full } = widthsForThisDevice();
  const perPhoto = (BYTES_BY_WIDTH[grid] ?? 50_000) + (BYTES_BY_WIDTH[full] ?? 305_000);
  return photoCount * perPhoto;
}

export interface SpaceCheck {
  ok: boolean;
  quota: number | null;
  usage: number | null;
  free: number | null;
}

/** Asks before downloading, rather than failing halfway through. */
export async function checkSpace(needed: number): Promise<SpaceCheck> {
  if (!navigator.storage?.estimate) return { ok: true, quota: null, usage: null, free: null };

  const { quota = 0, usage = 0 } = await navigator.storage.estimate();
  const free = quota - usage;
  return { ok: free > needed + MIN_FREE_BYTES, quota, usage, free };
}

/**
 * Asks the browser to exempt this origin from routine eviction.
 *
 * Firefox prompts; Chrome and Safari decide silently from engagement history.
 * Worth asking either way — it costs nothing and a "no" changes nothing.
 *
 * It does NOT defeat Safari's separate rule that clears script-created storage
 * for an origin with no interaction for seven days. That one is unavoidable and
 * is why the UI says the gallery may need re-downloading later.
 */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/** Cache key for one gallery; a hash so the share token never becomes a name. */
export async function cacheKeyForToken(token: string): Promise<string | null> {
  // Same secure-context rule as the presence channel: without `crypto.subtle`
  // there is no cache key, so offline storage is unavailable rather than
  // broken. Production is https, so this only bites on a LAN test.
  if (typeof crypto === "undefined" || !crypto.subtle) return null;

  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest))
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function ensureServiceWorker(): Promise<ServiceWorker | null> {
  const registration =
    (await navigator.serviceWorker.getRegistration()) ??
    (await navigator.serviceWorker.register("/sw.js"));
  await navigator.serviceWorker.ready;
  return registration.active ?? navigator.serviceWorker.controller;
}

/**
 * A size for people to read. With a `locale` it is that locale's number and
 * unit ("7,3 GB" in Czech, "7,3 Go" in French), joined by a no-break space so
 * the unit never wraps away from its number. Without one, the fixed form the
 * admin's Czech-only uploader and the archive-size checks were written against.
 */
export function formatBytes(bytes: number, locale?: string): string {
  const [value, unit, digits]: [number, "gigabyte" | "megabyte" | "kilobyte", number] =
    bytes >= 1024 ** 3
      ? [bytes / 1024 ** 3, "gigabyte", 1]
      : bytes >= 1024 ** 2
        ? [Math.round(bytes / 1024 ** 2), "megabyte", 0]
        : [Math.max(1, Math.round(bytes / 1024)), "kilobyte", 0];

  if (!locale) {
    if (unit === "gigabyte") return `${value.toFixed(1)} GB`;
    return `${value} ${unit === "megabyte" ? "MB" : "kB"}`;
  }

  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit,
    unitDisplay: "short",
    maximumFractionDigits: digits,
  })
    .format(value)
    .replace(/\s/g, " ");
}
