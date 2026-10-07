import "server-only";
import { prisma } from "@/lib/db";
import type { Locale } from "@/i18n/locales";
import {
  CHAPTER_TRANSLATED_FIELDS,
  EVENT_TRANSLATED_FIELDS,
  GALLERY_TRANSLATED_FIELDS,
  localizeField,
  localizeOptionalField,
  parseTranslations,
  PROMO_TRANSLATED_FIELDS,
} from "@/lib/content-translations";
import type { ResolvedShareLink } from "@/lib/share-access";
import { PHOTOS_PAGE_SIZE, encodeCursor } from "@/lib/photo-cursor";
import {
  CHAPTER_START_SELECT,
  ORDER_KEY_SELECT,
  beforePosition,
  chapterStartOf,
  compareChapterStarts,
  orderKeyOf,
  photoOrderBy,
  type PhotoOrder,
} from "@/lib/photo-order";
import { UPLOADER_SELECT, uploaderNameOf } from "@/lib/photo-attribution";
import {
  IMAGE_GRANT_TTL_SECONDS,
  signImageAccess,
  type SignedImageGrant,
} from "@/lib/image-signing";
import { isSafePromoUrl, type GalleryPromo } from "@/lib/promo-card";
import {
  chapterAnchor,
  withPresetFallback,
  type GalleryChapter,
  type TimelinePosition,
} from "@/lib/gallery-chapters";
import {
  HIGHLIGHT_CANDIDATE_SELECT,
  pickHighlights,
  toHighlightCandidate,
  type GalleryHighlight,
} from "@/lib/gallery-highlights";
import { formatDate } from "@/lib/format-date";
import { inheritsEventVenue } from "@/lib/gallery-venue";

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
  /** The wedding's venue, when the gallery borrows it (src/lib/gallery-venue.ts). */
  venue: string | null;
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
    /** A guest photo's volunteered credit (src/lib/photo-attribution.ts). */
    uploaderName: string | null;
    /** Key in the gallery's order — places chapter headers (docs/CHAPTERS.md). */
    orderKey: string;
  }[];
  initialCursor: string | null;
  /** The order `initialPhotos` and every `orderKey` are in (src/lib/photo-order.ts). */
  photoOrder: PhotoOrder;
  imageGrant: SignedImageGrant | null;
  viewers: { id: string; displayName: string }[];
  /** The owner's credit cards placed in this gallery (docs/PROMO-CARDS.md).
   * Loaded whole rather than per page — there are at most a handful, and their
   * slots are resolved against the entire gallery. */
  promos: GalleryPromo[];
  /** Named stretches of the timeline (docs/CHAPTERS.md), in timeline order,
   * empty ones already dropped. Loaded whole, like promos: the chapter bar
   * lists every chapter before any of them has been scrolled to. */
  chapters: GalleryChapter[];
  /** The "best of the day" shown above the grid (docs/HIGHLIGHTS.md), in
   * timeline order; empty when switched off or the gallery is too small. */
  highlights: GalleryHighlight[];
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
  const order = access.photoOrder;
  const gallery = await prisma.gallery.findUnique({
    where: { id: access.galleryId },
    select: {
      id: true,
      title: true,
      // docs/I18N.md §Content — the title in the guest's language.
      translations: true,
      eventDate: true,
      event: { select: { eventDate: true, venue: true, translations: true, trashedAt: true } },
      storagePrefix: true,
      // docs/TODO.md §7 — pre-built "download all" archive, ready or not.
      zipStatus: true,
      zipObjectKey: true,
      zipSizeBytes: true,
      zipBuiltAt: true,
      highlightsEnabled: true,
      // One filtered aggregate rides along with the row we are already
      // fetching, so the header's "56 fotek" costs no extra round trip.
      _count: { select: { photos: { where: { status: "CONFIRMED" } } } },
      // One extra row over the page size tells us whether a next page exists
      // without a separate COUNT query — the same trick the cursor-paginated
      // API route uses for every subsequent page.
      photos: {
        where: { status: "CONFIRMED" },
        // The gallery's order (src/lib/photo-order.ts): capture order,
        // oldest shot first (2026-08-25), or the photographer's file
        // numbering. Must match the cursor-paginated API route's own orderBy
        // exactly, or scrolling past the first page would reshuffle what the
        // viewer already saw.
        orderBy: photoOrderBy(order),
        take: PHOTOS_PAGE_SIZE + 1,
        select: {
          id: true,
          objectKey: true,
          thumbObjectKey: true,
          fileName: true,
          width: true,
          height: true,
          placeholder: true,
          ...ORDER_KEY_SELECT,
          _count: { select: { favorites: true } },
          ...UPLOADER_SELECT,
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
              translations: true,
            },
          },
        },
      },
      chapters: {
        select: {
          id: true,
          title: true,
          translations: true,
          ...CHAPTER_START_SELECT,
          slug: true,
        },
      },
    },
  });
  if (!gallery) return null;

  const hasMore = gallery.photos.length > PHOTOS_PAGE_SIZE;
  const page = hasMore ? gallery.photos.slice(0, PHOTOS_PAGE_SIZE) : gallery.photos;
  const last = page.at(-1);

  const titleTranslations = parseTranslations(gallery.translations, GALLERY_TRANSLATED_FIELDS);
  // In the gallery's order — `chaptersWithCounts` counts each one up to the next.
  const chapterRows = gallery.chapters.toSorted(compareChapterStarts(order));

  // Independent of each other, so none of them waits on another's round trip.
  const [imageGrant, chapters, highlights] = await Promise.all([
    mintImageGrant(gallery.storagePrefix),
    chaptersWithCounts(
      gallery.id,
      order,
      gallery._count.photos,
      chapterRows.map((chapter) => ({
        id: chapter.id,
        title: localizeField(
          chapter.title,
          withPresetFallback(
            chapter.title,
            parseTranslations(chapter.translations, CHAPTER_TRANSLATED_FIELDS),
          ),
          "title",
          locale,
        ),
        start: chapterStartOf(order, chapter),
        anchor: chapterAnchor(chapter),
      })),
    ),
    gallery.highlightsEnabled
      ? loadHighlights(
          gallery.id,
          order,
          chapterRows.map((chapter) => chapterStartOf(order, chapter)),
        )
      : Promise.resolve([]),
  ]);

  return {
    title: localizeField(gallery.title, titleTranslations, "title", locale),
    eventDate: gallery.eventDate ? formatDate(gallery.eventDate, locale) : null,
    venue:
      gallery.event && inheritsEventVenue(gallery.eventDate, gallery.event)
        ? localizeOptionalField(
            gallery.event.venue,
            parseTranslations(gallery.event.translations, EVENT_TRANSLATED_FIELDS),
            "venue",
            locale,
          )
        : null,
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
      uploaderName: uploaderNameOf(photo),
      orderKey: orderKeyOf(order, photo),
    })),
    initialCursor:
      hasMore && last ? encodeCursor({ order, key: orderKeyOf(order, last), id: last.id }) : null,
    photoOrder: order,
    imageGrant,
    viewers: gallery.viewers.map((v) => ({ id: v.id, displayName: v.displayName ?? "" })),
    // Filtered here as well as on write: a row can predate a validation rule,
    // and this value is rendered as an `href` into pages held by people who
    // are not the owner. Dropping the tile is the safe failure.
    promos: gallery.promos
      .filter((placement) => isSafePromoUrl(placement.promoCard.ctaUrl))
      .map((placement) => {
        const card = placement.promoCard;
        const tr = parseTranslations(card.translations, PROMO_TRANSLATED_FIELDS);
        return {
          id: placement.id,
          slot: placement.slot,
          eyebrow: localizeOptionalField(card.eyebrow, tr, "eyebrow", locale),
          headline: localizeField(card.headline, tr, "headline", locale),
          body: localizeOptionalField(card.body, tr, "body", locale),
          ctaLabel: localizeOptionalField(card.ctaLabel, tr, "ctaLabel", locale),
          ctaUrl: card.ctaUrl,
          theme: card.theme,
        };
      }),
    chapters,
    highlights,
    archive: archiveFor(
      gallery.zipStatus,
      gallery.zipObjectKey,
      gallery.zipSizeBytes,
      gallery.zipBuiltAt,
    ),
  };
}

/**
 * Each chapter's photo count, from how many confirmed photos sit before its
 * start: one indexed COUNT per chapter, and a gallery has a handful. Chapters
 * left with no photos (every one deleted, or started past the last photo) are
 * dropped here, so neither the chapter bar nor the grid ever shows an empty
 * one.
 *
 * ponytail: counts are fixed at page load, so a photo added or removed while
 * the page is open shows in the grid but not in "84 fotek" until a reload.
 * Placement does not use them (src/lib/gallery-grid.ts), only the label does.
 */
async function chaptersWithCounts(
  galleryId: string,
  order: PhotoOrder,
  total: number,
  chapters: Omit<GalleryChapter, "count">[],
): Promise<GalleryChapter[]> {
  if (chapters.length === 0) return [];
  const before = await Promise.all(
    chapters.map((chapter) =>
      prisma.photo.count({
        where: { galleryId, status: "CONFIRMED", ...beforePosition(order, chapter.start) },
      }),
    ),
  );
  return chapters
    .map((chapter, i) => ({ ...chapter, count: (before[i + 1] ?? total) - before[i]! }))
    .filter((chapter) => chapter.count > 0);
}

/**
 * The highlights (docs/HIGHLIGHTS.md): picked over every confirmed photo, so
 * one query reads the few columns the picker needs across the whole gallery,
 * and a second fetches what the chosen handful need to be drawn.
 *
 * ponytail: recomputed on every page load — a 2 000-photo gallery is 2 000
 * small rows. Store the pick on the gallery if that ever shows up in timings.
 */
async function loadHighlights(
  galleryId: string,
  order: PhotoOrder,
  chapterStarts: TimelinePosition[],
): Promise<GalleryHighlight[]> {
  const candidates = await prisma.photo.findMany({
    where: { galleryId, status: "CONFIRMED" },
    select: HIGHLIGHT_CANDIDATE_SELECT,
  });
  const picks = pickHighlights(
    candidates.map((candidate) => toHighlightCandidate(order, candidate)),
    chapterStarts,
  );
  if (picks.length === 0) return [];

  const photos = await prisma.photo.findMany({
    where: { id: { in: picks.map((pick) => pick.id) } },
    select: {
      id: true,
      objectKey: true,
      thumbObjectKey: true,
      fileName: true,
      width: true,
      height: true,
      placeholder: true,
    },
  });
  const byId = new Map(photos.map((photo) => [photo.id, photo]));
  return picks.flatMap((pick) => byId.get(pick.id) ?? []);
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
