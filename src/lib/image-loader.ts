"use client";

import type { ImageLoaderProps } from "next/image";

// Global custom loader (next.config.ts images.loaderFile): builds Cloudflare
// Image Transformation URLs on the R2 custom domain. This bypasses Vercel's
// /_next/image entirely — zero Vercel image-optimization billing and zero
// Vercel data transfer for image bytes (docs/PLAN.md §3, §6).
//
// Photo `src` is the R2 OBJECT KEY (e.g. "galleries/<rand>/<id>.jpg").
// Absolute URLs and root-relative paths (local/public assets) pass through.
export default function cloudflareImageLoader({ src, width, quality }: ImageLoaderProps): string {
  if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("/")) {
    return src;
  }

  const base = process.env.NEXT_PUBLIC_PHOTOS_BASE_URL;
  if (!base) {
    // Local dev without Cloudflare: serve the raw object path.
    return `/${src}?w=${width}`;
  }

  // Fixed, short parameter set — every extra combination is a billable
  // "unique transformation" (5,000/month allowance). Keep in sync with
  // images.deviceSizes/imageSizes/qualities in next.config.ts.
  const params = `width=${width},quality=${quality ?? 82},format=auto,fit=scale-down`;
  return `${base}/cdn-cgi/image/${params}/${src}`;
}
