import "server-only";
import { prisma } from "@/lib/db";
import type { Locale } from "@/i18n/locales";
import type { ResolvedShareLink } from "@/lib/share-access";
import { PHOTOS_PAGE_SIZE, encodeCursor } from "@/lib/photo-cursor";
import {
  IMAGE_GRANT_TTL_SECONDS,
  signImageAccess,
  type SignedImageGrant,
} from "@/lib/image-signing";
import { isSafePromoUrl, type GalleryPromo } from "@/lib/promo-card";
import { formatDate } from "@/lib/format-date";

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
  /** Every confirmed photo, not just the first page — the header states how
   * big the gallery is before any of it has scrolled into view. */
  photoCount: number;
  initialPhotos: {
    id: string;
    objectKey: string;
    thumbObjectKey: string | null;
    fileName: string;
    width: number | null;
    height: number | null;
    placeholder: string | null;
    favoriteCount: number;
  }[];
  initialCursor: string | null;
  imageGrant: SignedImageGrant | null;
  viewers: { id: string; displayName: string }[];
  /** The owner's credit cards placed in this gallery (docs/PROMO-CARDS.md).
   * Loaded whole rather than per page — there are at most a handful, and their
   * slots are resolved against the entire gallery. */
  promos: GalleryPromo[];
  archive: GalleryArchive;
}

/**
 * The state of the pre-built "download all" archive, as the viewer needs to
 * understand it (docs/TODO.md §7).
 *
 * Replaces a bare `archiveZipUrl: string | null`, which the UI turned into
 * "render the button, or render nothing at all". That meant the single thing
 * a client opened the link for was *absent* for the whole window between the
 * photographer sending the gallery and the 15-minute cron getting to it — and
 * absent again, for everyone, every time a guest added a photo.
 */
export interface GalleryArchive {
  /** Direct CDN link to a complete archive, or null while none exists. */
  url: string | null;
  /** The archive on offer predates the newest photos; a rebuild is queued. */
  stale: boolean;
  /** Size of the archive at `url`, for a label the viewer can act on — a
   * 8 GB download is a different decision on a phone than a 300 MB one. */
  sizeBytes: number | null;
}

export async function loadGalleryViewData(
  access: ResolvedShareLink,
  locale: Locale,
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
      zipSizeBytes: true,
      zipBuiltAt: true,
      // One filtered aggregate rides along with the row we are already
      // fetching, so the header's "56 fotek" costs no extra round trip.
      _count: { select: { photos: { where: { status: "CONFIRMED" } } } },
      // One extra row over the page size tells us whether a next page exists
      // without a separate COUNT query — the same trick the cursor-paginated
      // API route uses for every subsequent page.
      photos: {
        where: { status: "CONFIRMED" },
        // Capture order, oldest shot first (2026-08-25, Pavel's call —
        // replaces newest-upload-first): the gallery reads as the day
        // happened. Must match the cursor-paginated API route's own orderBy
        // exactly, or scrolling past the first page would reshuffle what the
        // viewer already saw.
        orderBy: [{ takenAt: "asc" }, { id: "asc" }],
        take: PHOTOS_PAGE_SIZE + 1,
        select: {
          id: true,
          objectKey: true,
          thumbObjectKey: true,
          fileName: true,
          width: true,
          height: true,
          placeholder: true,
          takenAt: true,
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
      // The photographer's own credit tiles (docs/PROMO-CARDS.md). Ordered by
      // slot so `buildGridEntries` receives them in the order they appear —
      // it sorts defensively anyway, but a stable order out of the database
      // keeps the two from ever disagreeing.
      promos: {
        where: { enabled: true },
        orderBy: [{ slot: "asc" }, { id: "asc" }],
        select: {
          id: true,
          slot: true,
          promoCard: {
            select: {
              eyebrow: true,
              headline: true,
              body: true,
              ctaLabel: true,
              ctaUrl: true,
              theme: true,
            },
          },
        },
      },
    },
  });
  if (!gallery) return null;

  const hasMore = gallery.photos.length > PHOTOS_PAGE_SIZE;
  const page = hasMore ? gallery.photos.slice(0, PHOTOS_PAGE_SIZE) : gallery.photos;
  const last = page.at(-1);

  return {
    title: gallery.title,
    eventDate: gallery.eventDate ? formatDate(gallery.eventDate, locale) : null,
    photoCount: gallery._count.photos,
    initialPhotos: page.map((photo) => ({
      id: photo.id,
      objectKey: photo.objectKey,
      thumbObjectKey: photo.thumbObjectKey,
      fileName: photo.fileName,
      width: photo.width,
      height: photo.height,
      placeholder: photo.placeholder,
      favoriteCount: photo._count.favorites,
    })),
    initialCursor:
      hasMore && last
        ? encodeCursor({ takenAt: last.takenAt ?? last.createdAt, id: last.id })
        : null,
    imageGrant: await mintImageGrant(gallery.storagePrefix),
    viewers: gallery.viewers.map((v) => ({ id: v.id, displayName: v.displayName ?? "" })),
    // Filtered here as well as on write: a row can predate a validation rule,
    // and this value is rendered as an `href` into pages held by people who
    // are not the owner. Dropping the tile is the safe failure.
    promos: gallery.promos
      .filter((placement) => isSafePromoUrl(placement.promoCard.ctaUrl))
      .map((placement) => ({
        id: placement.id,
        slot: placement.slot,
        eyebrow: placement.promoCard.eyebrow,
        headline: placement.promoCard.headline,
        body: placement.promoCard.body,
        ctaLabel: placement.promoCard.ctaLabel,
        ctaUrl: placement.promoCard.ctaUrl,
        theme: placement.promoCard.theme,
      })),
    archive: archiveFor(
      gallery.zipStatus,
      gallery.zipObjectKey,
      gallery.zipSizeBytes,
      gallery.zipBuiltAt,
    ),
  };
}

/**
 * The finished archive is a plain CDN link — no Worker involved at download
 * time (docs/TODO.md §7). Built server-side since NEXT_PUBLIC_PHOTOS_BASE_URL
 * is the same public, build-time value the custom image loader already uses.
 *
 * ## Once an archive exists, the download button never disappears again
 *
 * The rule is `zipBuiltAt`, not `zipStatus`: a build that has completed at
 * least once left a whole, downloadable object at `zipObjectKey`, and no later
 * state change takes it away. Any photo added or removed flips the gallery
 * back to PENDING, a rebuild moves it through BUILDING, a bad build lands it
 * in FAILED — and through all of it that object is untouched. Serving it,
 * flagged `stale`, is strictly better than hiding the one feature the link was
 * sent for: the viewer gets everything except the last few photos.
 *
 * BUILDING used to be excluded on the theory that `zipObjectKey` names "a
 * multipart upload still being assembled". It does name that upload — but an
 * in-flight R2 multipart upload does not disturb the object already at the
 * key; the previous archive is served, unchanged, until `complete()` swaps it
 * (verified against the production bucket on a scratch key, 2026-09-02). The
 * old rule cost every gallery its download button for the entire length of
 * every rebuild, and cost a gallery whose build failed its button *forever*.
 *
 * A gallery that has never completed a build has nothing to serve, and the UI
 * says so ("Připravujeme archiv") rather than linking at a key that 404s.
 */
function archiveFor(
  zipStatus: string,
  zipObjectKey: string | null,
  zipSizeBytes: bigint | null,
  zipBuiltAt: Date | null,
): GalleryArchive {
  const base = process.env.NEXT_PUBLIC_PHOTOS_BASE_URL;
  if (!zipBuiltAt || !zipObjectKey || !base) return { url: null, stale: false, sizeBytes: null };

  const path = zipObjectKey.split("/").map(encodeURIComponent).join("/");
  return {
    url: `${base.replace(/\/$/, "")}/${path}`,
    stale: zipStatus !== "READY",
    // Describes the object at `url` — while a rebuild is queued or running,
    // that is still the previous archive, and so is this number. Both are
    // written by the same callback, so they never disagree.
    // Narrowed to a number on the way out: a bigint cannot cross into a client
    // component, and an 8 GB archive is nowhere near Number.MAX_SAFE_INTEGER.
    sizeBytes: zipSizeBytes === null ? null : Number(zipSizeBytes),
  };
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
