import "server-only";
import { prisma } from "@/lib/db";
import type { ResolvedShareLink } from "@/lib/share-access";
import { PHOTOS_PAGE_SIZE, encodeCursor } from "@/lib/photo-cursor";
import {
  IMAGE_GRANT_TTL_SECONDS,
  signImageAccess,
  type SignedImageGrant,
} from "@/lib/image-signing";

/**
 * Everything the shared `GalleryView` needs, loaded from one resolved share
 * link. Shared by the two surfaces that can render a gallery to a viewer:
 * `/g/{token}` and a wedding page that lists exactly one gallery
 * (docs/GUEST-GALLERIES.md §2), so the two cannot drift on ordering, page
 * size, or which photos count as visible.
 *
 * `token` is passed straight through to the client, which only ever
 * interpolates it into API URLs — so it works identically for a plain share
 * token and for the `{eventToken}~{eventKey}` composite.
 */
export interface GalleryViewData {
  title: string;
  eventDate: string | null;
  initialPhotos: {
    id: string;
    objectKey: string;
    fileName: string;
    width: number | null;
    height: number | null;
    placeholder: string | null;
    favoriteCount: number;
  }[];
  initialCursor: string | null;
  imageGrant: SignedImageGrant | null;
  viewers: { id: string; displayName: string }[];
  archiveZipUrl: string | null;
}

export async function loadGalleryViewData(
  access: ResolvedShareLink,
): Promise<GalleryViewData | null> {
  const gallery = await prisma.gallery.findUnique({
    where: { id: access.galleryId },
    select: {
      id: true,
      title: true,
      eventDate: true,
      storagePrefix: true,
      // docs/TODO.md §7 — pre-built "download all" archive, ready or not.
      zipStatus: true,
      zipObjectKey: true,
      // One extra row over the page size tells us whether a next page exists
      // without a separate COUNT query — the same trick the cursor-paginated
      // API route uses for every subsequent page.
      photos: {
        where: { status: "CONFIRMED" },
        // Newest upload first (2026-08-23, Pavel's call) — must match the
        // cursor-paginated API route's own orderBy exactly, or scrolling
        // past the first page would reshuffle what the viewer already saw.
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: PHOTOS_PAGE_SIZE + 1,
        select: {
          id: true,
          objectKey: true,
          fileName: true,
          width: true,
          height: true,
          placeholder: true,
          createdAt: true,
          _count: { select: { favorites: true } },
        },
      },
      viewers: {
        where: { displayName: { not: null }, optedOut: false },
        orderBy: { lastSeenAt: "desc" },
        take: 12,
        select: { id: true, displayName: true },
      },
    },
  });
  if (!gallery) return null;

  const hasMore = gallery.photos.length > PHOTOS_PAGE_SIZE;
  const page = hasMore ? gallery.photos.slice(0, PHOTOS_PAGE_SIZE) : gallery.photos;
  const last = page.at(-1);

  return {
    title: gallery.title,
    eventDate: gallery.eventDate?.toLocaleDateString("cs-CZ") ?? null,
    initialPhotos: page.map((photo) => ({
      id: photo.id,
      objectKey: photo.objectKey,
      fileName: photo.fileName,
      width: photo.width,
      height: photo.height,
      placeholder: photo.placeholder,
      favoriteCount: photo._count.favorites,
    })),
    initialCursor:
      hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
    imageGrant: await mintImageGrant(gallery.storagePrefix),
    viewers: gallery.viewers.map((v) => ({ id: v.id, displayName: v.displayName ?? "" })),
    archiveZipUrl: archiveUrl(gallery.zipStatus, gallery.zipObjectKey),
  };
}

/**
 * The finished archive is a plain CDN link — no Worker involved at download
 * time (docs/TODO.md §7). Built server-side since NEXT_PUBLIC_PHOTOS_BASE_URL
 * is the same public, build-time value the custom image loader already uses.
 */
function archiveUrl(zipStatus: string, zipObjectKey: string | null): string | null {
  const base = process.env.NEXT_PUBLIC_PHOTOS_BASE_URL;
  if (zipStatus !== "READY" || !zipObjectKey || !base) return null;
  return `${base.replace(/\/$/, "")}/${zipObjectKey.split("/").map(encodeURIComponent).join("/")}`;
}

/**
 * Signs image access for this gallery's whole `storagePrefix`, or returns
 * `null` when signing isn't configured — the loader (`src/lib/image-loader.ts`)
 * falls back to today's unsigned direct-CDN URLs either way, so this is safe
 * to deploy before the signing Worker exists (docs/PLAN.md §4.1).
 */
export async function mintImageGrant(storagePrefix: string): Promise<SignedImageGrant | null> {
  const secret = process.env.IMAGE_SIGNING_SECRET;
  if (!secret) return null;

  const exp = Math.floor(Date.now() / 1000) + IMAGE_GRANT_TTL_SECONDS;
  return { exp, sig: await signImageAccess({ prefix: storagePrefix, exp }, secret) };
}
