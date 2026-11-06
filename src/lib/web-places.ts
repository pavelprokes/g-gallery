import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { createGalleryFor } from "@/lib/gallery-admin";
import { photoOrderBy } from "@/lib/photo-order";
import { PUBLIC_PHOTO, WEB_PLACE_PATTERN } from "@/lib/web-gallery";
import type { PlaceGallery, WebPlace } from "@/lib/web-place-view";

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

/** Null when the website does not answer: the page says so instead of showing no places. */
export async function fetchWebPlaces(): Promise<WebPlace[] | null> {
  const base = (serverEnv().WEBSITE_URL ?? DEFAULT_WEBSITE).replace(/\/$/, "");
  try {
    const response = await fetch(`${base}/api/photo-places`, {
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
