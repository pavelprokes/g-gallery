import type { SignedImageGrant } from "@/lib/image-signing";

/**
 * The `src` a photo tile hands to `next/image`: the R2 object key, not a URL
 * (CLAUDE.md invariant 1) — the custom loader turns it into one. When the page
 * minted a signed access grant it rides along as a query, which the loader
 * moves onto the signing Worker's URL.
 *
 * Shared by the gallery grid and the wedding page's cover thumbnails so the
 * two cannot drift into building the query differently.
 */
export function srcFor(objectKey: string, grant: SignedImageGrant | null): string {
  if (!grant) return objectKey;
  return `${objectKey}?sig=${encodeURIComponent(grant.sig)}&exp=${grant.exp}`;
}
