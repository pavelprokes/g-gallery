import type { Metadata } from "next";
import { OG_LOCALES, type Locale } from "@/i18n/locales";

/**
 * Link previews — WhatsApp, Messenger, iMessage, Facebook, Slack — for every
 * page in the app.
 *
 * `og:image` used to point at the original object on the CDN: a 12 MB,
 * 6000 px camera file. WhatsApp shows nothing for an image that size (it wants
 * a few hundred kB at most), and the others either time out or crop it
 * arbitrarily. It now points at a Cloudflare transformation of the same key —
 * a 1200×630 JPEG, the size every one of those clients lays out without
 * cropping further. The bytes come from the CDN, never through Vercel
 * (CLAUDE.md invariant 1), and each cover is one cached transformation, well
 * inside the monthly allowance.
 *
 * JPEG, not `format=auto`: a crawler's Accept header decides what `auto`
 * returns, and WhatsApp does not reliably render WebP or AVIF previews.
 *
 * Deliberately the direct, unsigned CDN path even when image signing is on
 * (`IMAGE_SIGNING_SECRET`, docs/PLAN.md §4.1): a grant expires in two hours,
 * and a chat keeps showing its preview for weeks. If the direct path is ever
 * closed, link previews need their own public derivative first.
 */
export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;

/** A branded card for pages with no photo to show, or none they may show. */
export const DEFAULT_OG_IMAGE = "/og-default.jpg";

/** What a shared link says it is — never the repository's name. */
export const OG_SITE_NAME = "Pavel Prokeš — svatební fotograf";

/** A preview-sized JPEG of a stored photo, or null when no image host is configured. */
export function ogImageUrl(objectKey: string): string | null {
  const base = process.env.NEXT_PUBLIC_PHOTOS_BASE_URL?.replace(/\/$/, "");
  if (!base) return null;

  switch (process.env.NEXT_PUBLIC_IMAGE_TRANSFORM) {
    case "imgproxy":
      // Local stack only (compose.yaml): fill crops to the box, like fit=cover.
      return `${base}/insecure/rs:fill:${OG_IMAGE_WIDTH}:${OG_IMAGE_HEIGHT}/q:80/plain/${objectKey}@jpg`;
    case "none":
      // No resizing available at all: the original is still better than no
      // preview for the clients that accept it.
      return `${base}/${objectKey}`;
    default:
      return `${base}/cdn-cgi/image/width=${OG_IMAGE_WIDTH},height=${OG_IMAGE_HEIGHT},fit=cover,quality=80,format=jpeg/${objectKey}`;
  }
}

/**
 * The full set of preview tags for a page. Next merges `openGraph` and
 * `twitter` shallowly — a page that sets them replaces the layout's whole
 * object — so every page builds them here in one piece rather than relying on
 * inheritance for the image.
 */
export function previewMetadata({
  title,
  description,
  locale,
  url,
  imageKey,
  imageAlt,
}: {
  title: string;
  description: string;
  locale: Locale;
  /**
   * The page's own address, root-relative (`metadataBase` makes it absolute).
   * Facebook treats `og:url` as the canonical identity of what is shared and
   * warns when it is missing.
   */
  url?: string;
  /** The photo to show; null falls back to the branded card. */
  imageKey: string | null;
  imageAlt?: string;
}): Pick<Metadata, "openGraph" | "twitter"> {
  const photoUrl = imageKey ? ogImageUrl(imageKey) : null;
  const image = {
    url: photoUrl ?? DEFAULT_OG_IMAGE,
    width: OG_IMAGE_WIDTH,
    height: OG_IMAGE_HEIGHT,
    type: "image/jpeg",
    alt: imageAlt ?? title,
  };

  return {
    openGraph: {
      type: "website",
      siteName: OG_SITE_NAME,
      ...(url ? { url } : {}),
      locale: OG_LOCALES[locale],
      title,
      description,
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image.url],
    },
  };
}
