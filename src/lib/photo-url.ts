/**
 * Absolute URL of an untransformed original on the R2 custom domain.
 *
 * Used for "download original" links. Note: the `download` attribute is
 * ignored cross-origin, so the browser opens the file rather than saving it
 * under `fileName` — serving `Content-Disposition: attachment` from a
 * Cloudflare Worker is the Phase 2 fix (docs/PLAN.md §7).
 */
export function originalUrl(objectKey: string): string {
  const base = process.env.NEXT_PUBLIC_PHOTOS_BASE_URL;
  return base ? `${base.replace(/\/$/, "")}/${objectKey}` : `/${objectKey}`;
}
