"use client";

import type { ImageLoaderProps } from "next/image";

// Global custom loader (next.config.ts images.loaderFile). It never routes
// through Vercel's /_next/image — zero image-optimization billing and zero
// Vercel data transfer for image bytes (docs/PLAN.md §3, §6).
//
// Photo `src` is the OBJECT KEY (e.g. "galleries/<rand>/<id>.jpg").
// Absolute URLs and root-relative paths (local/public assets) pass through.
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
  const base = process.env.NEXT_PUBLIC_PHOTOS_BASE_URL?.replace(/\/$/, "");
  if (!base) {
    // No delivery host configured: serve the raw object path.
    return `/${src}?w=${width}`;
  }

  switch (transformMode()) {
    case "imgproxy":
      // `rs:fit:W:0` bounds the width and leaves height free; imgproxy does not
      // enlarge by default, which matches Cloudflare's fit=scale-down. Format
      // negotiation comes from the Accept header (WEBP/AVIF detection is on).
      return `${base}/insecure/rs:fit:${width}:0/q:${q}/plain/${src}`;
    case "none":
      return `${base}/${src}`;
    default:
      // Fixed, short parameter set — every extra combination is a billable
      // "unique transformation" (5,000/month allowance). Keep in sync with
      // images.deviceSizes/imageSizes/qualities in next.config.ts.
      return `${base}/cdn-cgi/image/width=${width},quality=${q},format=auto,fit=scale-down/${src}`;
  }
}
