"use client";

import type { ImageLoaderProps } from "next/image";

// Global custom loader (next.config.ts images.loaderFile). It never routes
// through Vercel's /_next/image — zero image-optimization billing and zero
// Vercel data transfer for image bytes (docs/PLAN.md §3, §6).
//
// Photo `src` is the OBJECT KEY (e.g. "galleries/<rand>/<id>.jpg"), optionally
// followed by `?sig=&exp=` — see the signed-images block below. Absolute URLs
// and root-relative paths (local/public assets) pass through.
//
// The transform backend is swappable so local dev can use the imgproxy
// container from compose.yaml instead of a Cloudflare zone:
//   cloudflare — production: {base}/cdn-cgi/image/...   (default)
//   imgproxy   — local:      {base}/insecure/rs:fit:.../plain/{key}
//   none       — serve the object straight from the bucket, no resizing
type TransformMode = "cloudflare" | "imgproxy" | "none";

const DEFAULT_QUALITY = 82;

function transformMode(): TransformMode {
  const mode = process.env.NEXT_PUBLIC_IMAGE_TRANSFORM;
  return mode === "imgproxy" || mode === "none" ? mode : "cloudflare";
}

export default function imageLoader({ src, width, quality }: ImageLoaderProps): string {
  if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("/")) {
    return src;
  }

  const q = quality ?? DEFAULT_QUALITY;
  const [key, query] = src.split("?");

  // docs/PLAN.md §4.1 "v2 hardening": when a gallery view minted a signed
  // access grant (src/lib/image-signing.ts, src/app/g/[token]/.../page.tsx),
  // every image request goes through the signing Worker instead of straight
  // to the CDN transform, so a captured image URL stops working once the
  // grant expires. Opt-in and backward compatible: without both the grant on
  // `src` and this env var, nothing here changes.
  const signedBase = process.env.NEXT_PUBLIC_SIGNED_IMAGES_URL?.replace(/\/$/, "");
  if (signedBase && query) {
    const params = new URLSearchParams(query);
    const sig = params.get("sig");
    const exp = params.get("exp");
    if (sig && exp) {
      return `${signedBase}/img/${key}?w=${width}&q=${q}&sig=${encodeURIComponent(sig)}&exp=${exp}`;
    }
  }

  const base = process.env.NEXT_PUBLIC_PHOTOS_BASE_URL?.replace(/\/$/, "");
  if (!base) {
    // No delivery host configured: serve the raw object path.
    return `/${key}?w=${width}`;
  }

  switch (transformMode()) {
    case "imgproxy":
      // `rs:fit:W:0` bounds the width and leaves height free; imgproxy does not
      // enlarge by default, which matches Cloudflare's fit=scale-down. Format
      // negotiation comes from the Accept header (WEBP/AVIF detection is on).
      return `${base}/insecure/rs:fit:${width}:0/q:${q}/plain/${key}`;
    case "none":
      return `${base}/${key}`;
    default:
      // Fixed, short parameter set — every extra combination is a billable
      // "unique transformation" (5,000/month allowance). Keep in sync with
      // images.deviceSizes/imageSizes/qualities in next.config.ts.
      return `${base}/cdn-cgi/image/width=${width},quality=${q},format=auto,fit=scale-down/${key}`;
  }
}

/**
 * A 1×1 PNG of the whole photo — the resize *is* the averaging.
 *
 * Lives next to the loader so the two cannot drift apart, but is deliberately
 * not part of it: forcing a format would add another billable variant to the
 * render path, and this is only ever called by the backfill script.
 *
 * Returns null when there is no transform host to do the work.
 */
export function averagingUrl(src: string): string | null {
  const base = process.env.NEXT_PUBLIC_PHOTOS_BASE_URL?.replace(/\/$/, "");
  if (!base) return null;

  switch (transformMode()) {
    case "imgproxy":
      // fit:1:1 bounds both axes, so any aspect ratio collapses to one pixel.
      return `${base}/insecure/rs:fit:1:1/plain/${src}@png`;
    case "none":
      return null;
    default:
      return `${base}/cdn-cgi/image/width=1,height=1,fit=scale-down,format=png/${src}`;
  }
}
