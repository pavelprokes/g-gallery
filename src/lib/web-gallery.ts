import "server-only";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { photoOrderBy } from "@/lib/photo-order";
import { copyObject } from "@/lib/r2";
import { thumbKeyFor } from "@/lib/thumbnail";
import { markGalleryPhotosChanged } from "@/lib/zip-build";

// The galleries the wedding website shows (docs/WEB-GALLERIES.md). A web gallery
// is an ordinary gallery with a `webSlug`, so upload, order, cover and replacing
// a retouched photo need nothing new.

/** The form of the website's portfolio uids; the slug is the key between the two. */
export const WEB_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const WEB_SLUG_MAX = 120;

/** A place on the website rather than a couple's page (src/lib/web-places.ts). */
export const WEB_PLACE_PATTERN = /^misto-[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** What one call may take. R2 copies server side, four at a time, so this fits a Server Action. */
export const WEB_COPY_MAX = 60;
const COPY_CONCURRENCY = 4;

/** Only the photographer's own finished photos: no guest uploads, no videos. */
export const PUBLIC_PHOTO = { status: "CONFIRMED", source: "OWNER", videoObjectKey: null } as const;

/** Nothing about viewers, favourites or faces leaves through this API. */
const PUBLIC_PHOTO_SELECT = {
  id: true,
  objectKey: true,
  thumbObjectKey: true,
  fileName: true,
  width: true,
  height: true,
  takenAt: true,
  thumbhash: true,
  placeholder: true,
} as const;

const LIVE = { status: "PUBLISHED", trashedAt: null } as const;

export interface WebPhoto {
  id: string;
  objectKey: string;
  thumbObjectKey: string | null;
  fileName: string;
  width: number | null;
  height: number | null;
  /** ISO, in UTC. Local capture time is the reader's to work out. */
  takenAt: string | null;
  thumbhash: string | null;
  placeholder: string | null;
}

export interface WebGallery {
  slug: string;
  title: string;
  eventDate: string | null;
  /** Only ever a photo of `photos`; null leaves the choice to the website. */
  coverPhotoId: string | null;
  photos: WebPhoto[];
}

export interface WebGallerySummary {
  slug: string;
  title: string;
  eventDate: string | null;
  cover: WebPhoto | null;
}

type PhotoRow = Omit<WebPhoto, "takenAt"> & { takenAt: Date | null };

const toWebPhoto = ({ takenAt, ...photo }: PhotoRow): WebPhoto => ({
  ...photo,
  takenAt: takenAt?.toISOString() ?? null,
});

/**
 * Why a request may not read the API, or null. No secret configured means the
 * API does not exist, which keeps a deployment without it exactly as it was.
 */
export function refusalOf(
  authorization: string | null,
  secret: string | undefined,
): "disabled" | "unauthorized" | null {
  if (!secret) return "disabled";
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(authorization ?? ""), digest(`Bearer ${secret}`))
    ? null
    : "unauthorized";
}

/** A published web gallery, in its own photo order. Null sends the website to its fallback. */
export async function webGalleryBySlug(slug: string): Promise<WebGallery | null> {
  const gallery = await prisma.gallery.findFirst({
    where: { webSlug: slug, ...LIVE },
    select: { id: true, title: true, eventDate: true, coverPhotoId: true, photoOrder: true },
  });
  if (!gallery) return null;

  const photos = await prisma.photo.findMany({
    where: { galleryId: gallery.id, ...PUBLIC_PHOTO },
    orderBy: photoOrderBy(gallery.photoOrder),
    select: PUBLIC_PHOTO_SELECT,
  });

  return {
    slug,
    title: gallery.title,
    eventDate: gallery.eventDate?.toISOString().slice(0, 10) ?? null,
    coverPhotoId: photos.some((photo) => photo.id === gallery.coverPhotoId)
      ? gallery.coverPhotoId
      : null,
    photos: photos.map(toWebPhoto),
  };
}

/** Every published web gallery with its cover, for the portfolio tiles. */
export async function webGallerySummaries(): Promise<WebGallerySummary[]> {
  const galleries = await prisma.gallery.findMany({
    where: { webSlug: { not: null }, ...LIVE },
    orderBy: { eventDate: "desc" },
    select: {
      id: true,
      webSlug: true,
      title: true,
      eventDate: true,
      coverPhotoId: true,
      photoOrder: true,
    },
  });

  return Promise.all(
    galleries.map(async (gallery) => {
      const where = { galleryId: gallery.id, ...PUBLIC_PHOTO };
      const chosen = gallery.coverPhotoId
        ? await prisma.photo.findFirst({
            where: { ...where, id: gallery.coverPhotoId },
            select: PUBLIC_PHOTO_SELECT,
          })
        : null;
      const cover =
        chosen ??
        (await prisma.photo.findFirst({
          where,
          orderBy: photoOrderBy(gallery.photoOrder),
          select: PUBLIC_PHOTO_SELECT,
        }));
      return {
        slug: gallery.webSlug!,
        title: gallery.title,
        eventDate: gallery.eventDate?.toISOString().slice(0, 10) ?? null,
        cover: cover ? toWebPhoto(cover) : null,
      };
    }),
  );
}

const extensionOf = (key: string) => key.slice(key.lastIndexOf("."));

/** The same bytes under the same name. A name alone is not a photo: two cameras can share one. */
export const fileIdentity = (photo: {
  fileName: string;
  crc32: string | null;
  etag: string | null;
}) => `${photo.fileName}|${photo.crc32 ?? photo.etag ?? ""}`;

/**
 * Copies photos into a web gallery, so deleting or trashing the couple's gallery
 * can never take the website down, and the website never shows the storage prefix
 * of a client gallery.
 *
 * A file already in the target is skipped: running it again after a failure
 * finishes the job. One failed photo does not stop the others. An object copied
 * just before a failure has no row, and the orphan sweep removes it
 * (src/lib/reconcile.ts). A guest photo or a video in the selection counts as skipped.
 */
export async function copyPhotosToWebGalleryFor(
  ownerId: string,
  targetGalleryId: string,
  photoIds: string[],
): Promise<{ copied: number; skipped: number; failed: number }> {
  const target = await prisma.gallery.findFirst({
    where: { id: targetGalleryId, ownerId, trashedAt: null, webSlug: { not: null } },
    select: { id: true, storagePrefix: true },
  });
  if (!target) throw new Error("NOT_FOUND");

  const [photos, present] = await Promise.all([
    prisma.photo.findMany({
      where: {
        id: { in: photoIds },
        galleryId: { not: target.id },
        gallery: { ownerId },
        ...PUBLIC_PHOTO,
      },
      select: {
        objectKey: true,
        thumbObjectKey: true,
        fileName: true,
        mimeType: true,
        sizeBytes: true,
        crc32: true,
        etag: true,
        width: true,
        height: true,
        placeholder: true,
        thumbhash: true,
        takenAt: true,
        xmpRating: true,
        xmpLabel: true,
        xmpHighlight: true,
      },
    }),
    prisma.photo.findMany({
      where: { galleryId: target.id, status: "CONFIRMED" },
      select: { fileName: true, crc32: true, etag: true },
    }),
  ]);

  const seen = new Set(present.map(fileIdentity));
  const fresh = photos.filter((photo) => {
    const identity = fileIdentity(photo);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });

  let copied = 0;
  let failed = 0;
  for (let start = 0; start < fresh.length; start += COPY_CONCURRENCY) {
    const results = await Promise.allSettled(
      fresh.slice(start, start + COPY_CONCURRENCY).map(async ({ objectKey, ...photo }) => {
        const newKey = `${target.storagePrefix}/${randomUUID()}${extensionOf(objectKey)}`;
        await copyObject(objectKey, newKey);
        // A thumbnail that never landed is a known state (docs/GUEST-GALLERIES.md), and the
        // original is all a tile needs without it, so it must not cost the photo.
        const newThumb = photo.thumbObjectKey
          ? thumbKeyFor(newKey, photo.thumbObjectKey.endsWith(".webp") ? "webp" : "jpeg")
          : null;
        const thumbCopied =
          photo.thumbObjectKey && newThumb
            ? await copyObject(photo.thumbObjectKey, newThumb).then(
                () => true,
                () => false,
              )
            : false;
        await prisma.photo.create({
          data: {
            ...photo,
            galleryId: target.id,
            objectKey: newKey,
            thumbObjectKey: thumbCopied ? newThumb : null,
            status: "CONFIRMED",
            source: "OWNER",
            wovenAt: photo.takenAt,
          },
        });
      }),
    );
    for (const result of results) {
      if (result.status === "fulfilled") copied++;
      else {
        failed++;
        console.error("[web-gallery] copy failed:", result.reason);
      }
    }
  }

  if (copied > 0) await markGalleryPhotosChanged(target.id);
  return { copied, failed, skipped: photoIds.length - copied - failed };
}
