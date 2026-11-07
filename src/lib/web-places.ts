import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { createGalleryFor } from "@/lib/gallery-admin";
import {
  HIGHLIGHT_CANDIDATE_SELECT,
  pickHighlights,
  toHighlightCandidate,
} from "@/lib/gallery-highlights";
import { photoOrderBy } from "@/lib/photo-order";
import { generateStoragePrefix } from "@/lib/share-token";
import {
  copyPhotosToWebGalleryFor,
  fileIdentity,
  PUBLIC_PHOTO,
  WEB_PLACE_PATTERN,
} from "@/lib/web-gallery";
import {
  couplesToSuggest,
  MIN_PHOTOS_TO_SUGGEST,
  type PlaceGallery,
  type WebPlace,
} from "@/lib/web-place-view";

// The places on the wedding website a web gallery can fill (docs/WEB-GALLERIES.md). The website
// owns the list, so a new place appears here without a change in this repo. A place is filled by
// a gallery whose webSlug is the place's key: the same mechanism as a portfolio gallery.

const DEFAULT_WEBSITE = "https://svatebni-fotograf-cechy.cz";

const placesSchema = z.object({
  places: z.array(
    z.object({
      key: z.string().regex(WEB_PLACE_PATTERN),
      label: z.string().min(1).max(200),
      where: z.string().max(200),
      positions: z.array(z.string().max(100)).min(1).max(60),
      landscape: z.boolean(),
      coverFirst: z.boolean().optional(),
    }),
  ),
});

/** Where the website lives, with no trailing slash. */
export const websiteBase = () => (serverEnv().WEBSITE_URL ?? DEFAULT_WEBSITE).replace(/\/$/, "");

/** Null when the website does not answer: the page says so instead of showing no places. */
export async function fetchWebPlaces(): Promise<WebPlace[] | null> {
  try {
    const response = await fetch(`${websiteBase()}/api/photo-places`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    return placesSchema.parse(await response.json()).places;
  } catch (error) {
    console.error("[web-places] Cannot read the list of places:", error);
    return null;
  }
}

const statsSchema = z.object({
  indexViews: z.number(),
  galleries: z.array(
    z.object({
      uid: z.string(),
      albumVisits: z.number(),
      photoOpens: z.number(),
      photoViews: z.number(),
    }),
  ),
});

export type WebStats = z.infer<typeof statsSchema>;

/**
 * How often each portfolio page's album and photos were opened in the last 90 days. The website
 * owns these numbers (its own analytics). Null, and no numbers on the page, without a token or when
 * it does not answer: they must not cost the page.
 */
export async function fetchWebStats(): Promise<WebStats | null> {
  const token = serverEnv().WEBSITE_STATS_TOKEN;
  if (!token) return null;
  try {
    const response = await fetch(`${websiteBase()}/api/photo-stats?range=90`, {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    return statsSchema.parse(await response.json());
  } catch (error) {
    console.error("[web-places] Cannot read the website's stats:", error);
    return null;
  }
}

/** The galleries filling these places, with the photos a place could use. */
export async function placeGalleriesFor(
  ownerId: string,
  places: WebPlace[],
): Promise<Map<string, PlaceGallery>> {
  const galleries = await prisma.gallery.findMany({
    where: { ownerId, trashedAt: null, webSlug: { in: places.map((place) => place.key) } },
    select: {
      id: true,
      title: true,
      status: true,
      webSlug: true,
      coverPhotoId: true,
      photoOrder: true,
      _count: { select: { photos: { where: PUBLIC_PHOTO } } },
    },
  });

  const filled = await Promise.all(
    galleries.map(async ({ photoOrder, _count, webSlug, ...gallery }) => {
      const place = places.find((candidate) => candidate.key === webSlug)!;
      const photos = await prisma.photo.findMany({
        where: { galleryId: gallery.id, ...PUBLIC_PHOTO },
        orderBy: photoOrderBy(photoOrder),
        // A client gallery with 500 photos can land here by mistake: enough to show it.
        take: place.positions.length + 1,
        select: {
          id: true,
          objectKey: true,
          thumbObjectKey: true,
          placeholder: true,
          fileName: true,
          width: true,
          height: true,
        },
      });
      return [webSlug!, { ...gallery, photoCount: _count.photos, photos }] as const;
    }),
  );
  return new Map(filled);
}

/** Galleries that can fill a place: not in the trash and not already on the website. */
export function selectableGalleriesFor(ownerId: string) {
  return prisma.gallery.findMany({
    where: { ownerId, trashedAt: null, webSlug: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true },
  });
}

/**
 * Puts a gallery into a place, or empties it with null. The gallery there before keeps its photos
 * and stops being on the website; a gallery that already has an address stays where it is.
 */
export async function assignWebPlaceFor(
  ownerId: string,
  placeKey: string,
  galleryId: string | null,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.gallery.updateMany({
      where: { ownerId, webSlug: placeKey },
      data: { webSlug: null },
    });
    if (!galleryId) return;
    const { count } = await tx.gallery.updateMany({
      where: { id: galleryId, ownerId, trashedAt: null, webSlug: null },
      data: { webSlug: placeKey },
    });
    if (count !== 1) throw new Error("NOT_FOUND");
  });
}

/** A new draft already in the place: nothing shows on the website until it is published. */
export async function createWebPlaceGalleryFor(
  ownerId: string,
  placeKey: string,
  label: string,
): Promise<string> {
  const id = await createGalleryFor(ownerId, { title: `Web: ${label}`, eventDate: null });
  await assignWebPlaceFor(ownerId, placeKey, id);
  return id;
}

/** The web galleries that are portfolio pages, not places, newest first. */
export function portfolioGalleriesFor(ownerId: string) {
  return prisma.gallery.findMany({
    where: {
      ownerId,
      trashedAt: null,
      webSlug: { not: null },
      NOT: { webSlug: { startsWith: "misto-" } },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      status: true,
      webSlug: true,
      coverPhoto: { select: { objectKey: true, thumbObjectKey: true, placeholder: true } },
      photos: {
        where: PUBLIC_PHOTO,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { objectKey: true, thumbObjectKey: true, placeholder: true },
      },
      _count: { select: { photos: { where: PUBLIC_PHOTO } } },
    },
  });
}

/** How many photos a suggestion offers, and how many couples a page shows. */
const SUGGESTED_PHOTOS = 8;
export const SUGGESTIONS_PER_PAGE = 3;

/**
 * Couples with no web gallery yet, and the photos to start one with: the same pick as the guests'
 * highlights, so pins and ratings from Lightroom count. `from` pages through them, because some
 * galleries are not for the website and there is nothing to mark them with.
 */
export async function webSuggestionsFor(ownerId: string, askedFrom: number) {
  // Portfolio galleries only: a place holds single photos from many weddings.
  const webPhotos = await prisma.photo.findMany({
    where: {
      status: "CONFIRMED",
      gallery: { ownerId, webSlug: { not: null }, NOT: { webSlug: { startsWith: "misto-" } } },
    },
    select: { fileName: true, crc32: true, etag: true },
  });
  const onWebsite = new Set(webPhotos.map(fileIdentity));
  const sameName = await prisma.photo.findMany({
    where: {
      status: "CONFIRMED",
      fileName: { in: [...new Set(webPhotos.map((photo) => photo.fileName))] },
      gallery: { ownerId, webSlug: null },
    },
    select: { galleryId: true, fileName: true, crc32: true, etag: true },
  });
  const covered = new Set(
    sameName.filter((photo) => onWebsite.has(fileIdentity(photo))).map((photo) => photo.galleryId),
  );

  const galleries = await prisma.gallery.findMany({
    where: { ownerId, webSlug: null },
    select: {
      id: true,
      title: true,
      status: true,
      trashedAt: true,
      eventId: true,
      eventDate: true,
      createdAt: true,
      photoOrder: true,
      event: { select: { title: true, eventDate: true } },
      _count: { select: { photos: { where: PUBLIC_PHOTO } } },
    },
  });
  const couples = couplesToSuggest(
    galleries.map((gallery) => ({
      ...gallery,
      day: gallery.eventDate ?? gallery.event?.eventDate ?? gallery.createdAt,
      ownPhotos: gallery._count.photos,
      onWebsite: covered.has(gallery.id),
      // "Web:" is what this page names its galleries: one taken out of a place loses its slug.
      offerable:
        gallery.status === "PUBLISHED" && !gallery.trashedAt && !/^web[: ]/i.test(gallery.title),
    })),
  );
  // Past the end, as after adding the only couple on the last page: from the start again.
  const from = askedFrom < couples.length ? askedFrom : 0;

  const suggestions = await Promise.all(
    couples.slice(from, from + SUGGESTIONS_PER_PAGE).map(async (couple) => {
      const photos = await prisma.photo.findMany({
        where: { galleryId: couple.id, ...PUBLIC_PHOTO },
        select: {
          ...HIGHLIGHT_CANDIDATE_SELECT,
          objectKey: true,
          thumbObjectKey: true,
          placeholder: true,
          fileName: true,
        },
      });
      const picks = pickHighlights(
        photos.map((photo) => toHighlightCandidate(couple.photoOrder, photo)),
        [],
        SUGGESTED_PHOTOS,
        { minPhotosForAuto: MIN_PHOTOS_TO_SUGGEST },
      );
      const byId = new Map(photos.map((photo) => [photo.id, photo]));
      return {
        id: couple.id,
        name: couple.event?.title ?? couple.title,
        day: couple.day,
        ownPhotos: couple.ownPhotos,
        photos: picks.flatMap((pick) => byId.get(pick.id) ?? []),
      };
    }),
  );
  return { suggestions, total: couples.length, from };
}

/**
 * A draft web gallery for a couple, with the chosen photos copied in. A taken address throws
 * (P2002) before anything is created, and a draft none of whose photos copied is removed again, or
 * it would hold the address. The website shows it once it is published and the portfolio has a page
 * at the same address.
 */
export async function createPortfolioGalleryFor(
  ownerId: string,
  sourceId: string,
  webSlug: string,
  photoIds: string[],
): Promise<{ id: string; copied: number; failed: number }> {
  const source = await prisma.gallery.findFirst({
    where: { id: sourceId, ownerId, trashedAt: null },
    select: { title: true, eventDate: true, event: { select: { title: true, eventDate: true } } },
  });
  if (!source) throw new Error("NOT_FOUND");
  const { id } = await prisma.gallery.create({
    data: {
      ownerId,
      // A gallery's title may be 200 characters; its settings would refuse a longer one.
      title: `Web: ${source.event?.title ?? source.title}`.slice(0, 200),
      eventDate: source.eventDate ?? source.event?.eventDate ?? null,
      storagePrefix: generateStoragePrefix(),
      webSlug,
    },
    select: { id: true },
  });
  const { copied, failed } = await copyPhotosToWebGalleryFor(ownerId, id, photoIds);
  if (copied === 0) await prisma.gallery.delete({ where: { id } });
  return { id, copied, failed };
}
