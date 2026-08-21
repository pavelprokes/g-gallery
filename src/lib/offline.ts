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

/** Every URL needed to browse the gallery without a network. */
export function offlineUrls(objectKeys: readonly string[], pageUrl: string): string[] {
  const { grid, full } = widthsForThisDevice();
  const urls = new Set<string>([pageUrl, ...appAssetUrls()]);

  for (const key of objectKeys) {
    urls.add(imageLoader({ src: key, width: grid, quality: QUALITY }));
    urls.add(imageLoader({ src: key, width: full, quality: QUALITY }));
  }
  return [...urls];
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
export async function cacheKeyForToken(token: string): Promise<string> {
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

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} kB`;
}
