import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import type { Locale } from "@/i18n/locales";
import {
  GALLERY_TRANSLATED_FIELDS,
  localizeField,
  parseTranslations,
} from "@/lib/content-translations";
import { pickCover } from "@/lib/event-access";
import { previewMetadata } from "@/lib/og-image";
import { photoOrderBy, type PhotoOrder } from "@/lib/photo-order";

/**
 * The photo a shared link previews with: the gallery's chosen cover, or else
 * the first photo a visitor sees — in the grid's own order
 * (src/lib/photo-order.ts), not the newest upload, which on a guest gallery
 * is whatever someone posted last.
 */
async function galleryPreview(galleryId: string) {
  // The first photo is looked up in both orders alongside the gallery, rather
  // than after it: generateMetadata runs on every page view, and one round
  // trip of latency beats one query of work.
  const firstIn = (order: PhotoOrder) =>
    prisma.photo.findFirst({
      where: { galleryId, status: "CONFIRMED" },
      orderBy: photoOrderBy(order),
      select: { objectKey: true, status: true },
    });
  const [gallery, firstByTime, firstByName] = await Promise.all([
    prisma.gallery.findUnique({
      where: { id: galleryId },
      select: {
        title: true,
        translations: true,
        photoOrder: true,
        coverPhoto: { select: { objectKey: true, status: true } },
      },
    }),
    firstIn("TAKEN_AT"),
    firstIn("FILE_NAME"),
  ]);
  if (!gallery) return null;
  const first = gallery.photoOrder === "FILE_NAME" ? firstByName : firstByTime;
  return { ...gallery, preview: pickCover(gallery.coverPhoto, first) };
}

async function galleryPreviewKey(galleryId: string): Promise<string | null> {
  return (await galleryPreview(galleryId))?.preview?.objectKey ?? null;
}

const noIndex = { index: false, follow: false } as const;

export async function galleryShareMetadata(
  galleryId: string,
  t: (key: string) => string,
  locale: Locale,
  url: string,
): Promise<Metadata> {
  const gallery = await galleryPreview(galleryId);

  // The tab and the link preview carry the title in the reader's language too.
  const title = gallery
    ? localizeField(
        gallery.title,
        parseTranslations(gallery.translations, GALLERY_TRANSLATED_FIELDS),
        "title",
        locale,
      )
    : t("untitledPlaceholder");
  const description = t("galleryOgDescription");
  const cover = gallery?.preview;

  return {
    title: { absolute: title },
    description,
    robots: noIndex,
    ...previewMetadata({ title, description, locale, url, imageKey: cover?.objectKey ?? null }),
  };
}

/**
 * The wedding page. Previews with the gallery its visitors meet first — the
 * photographer's, when there is one — rather than whichever card happens to
 * have a photo.
 */
export async function eventShareMetadata(
  title: string,
  previewGalleryId: string | null,
  t: (key: string) => string,
  locale: Locale,
  url: string,
): Promise<Metadata> {
  const description = t("galleryOgDescription");
  const imageKey = previewGalleryId ? await galleryPreviewKey(previewGalleryId) : null;

  return {
    title: { absolute: title },
    description,
    robots: noIndex,
    ...previewMetadata({ title, description, locale, url, imageKey }),
  };
}

/**
 * A link that does not resolve — unknown, expired, revoked, or waiting for a
 * password. It still gets a preview, but a neutral one: no title and no photo
 * of a gallery the holder cannot open, so a password-protected album's cover
 * never leaks into a chat.
 */
export function unavailableShareMetadata(
  t: (key: string) => string,
  locale: Locale,
  url: string,
): Metadata {
  const title = t("untitledPlaceholder");
  const description = t("galleryOgDescription");
  return {
    title,
    description,
    robots: noIndex,
    ...previewMetadata({ title, description, locale, url, imageKey: null }),
  };
}
