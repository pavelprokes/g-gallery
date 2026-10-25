import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { galleryCounts, photoCounts, promoClickCounts } from "@/lib/activity";
import { pickCover } from "@/lib/event-access";
import { printTotals, printTotalsByViewer } from "@/lib/print-selections";
import { buildViewSeries, emptySeries, lastDays, windowStart } from "@/lib/view-series";
import { newestLiveShareUrl } from "@/lib/live-share-url";
import { decryptToken } from "@/lib/token-cipher";
import { CHAPTER_START_SELECT, compareChapterStarts } from "@/lib/photo-order";
import { bucketUrl, mediaUrls, thumbUrl } from "../media-urls";
import { defineTool, jsonResult } from "../tool";
import {
  adminGalleryUrl,
  adminWeddingUrl,
  day,
  idInput,
  isLive,
  iso,
  limitInput,
  notFound,
  offsetInput,
  shareLinkUrl,
} from "./common";

const GALLERY_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;

const coverFields = { id: true, objectKey: true, thumbObjectKey: true, status: true } as const;
const newestPhoto = {
  where: { status: "CONFIRMED" as const },
  orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
  take: 1,
  select: coverFields,
};

const linkFields = {
  id: true,
  label: true,
  slug: true,
  tokenCipher: true,
  revokedAt: true,
  expiresAt: true,
  createdAt: true,
} as const;

/** What "Otevřít galerii" opens in the admin, by the admin's own rule. */
function liveUrl(
  origin: string,
  published: boolean,
  links: {
    tokenCipher: string | null;
    slug: string | null;
    revokedAt: Date | null;
    expiresAt: Date | null;
  }[],
  now: Date,
): string | null {
  const withUrls = links.map((link) => ({ ...link, url: shareLinkUrl(origin, link) }));
  return newestLiveShareUrl(withUrls, published, now);
}

export const overview = defineTool({
  name: "overview",
  title: "Přehled",
  description:
    "Celkový přehled účtu: počty galerií podle stavu, svatby, fotky a videa, obsazené místo, návštěvy za posledních 14 dní, nevyřízené připomínky a objednávky do tisku. Dobrý první krok.",
  input: z.strictObject({}),
  access: "read",
  handler: async (_args, caller) => {
    const ownerId = caller.userId;
    const now = new Date();
    const live = { ownerId, trashedAt: null };
    const [byStatus, trashed, weddings, media, sessions, openCorrections, prints, uploads] =
      await Promise.all([
        prisma.gallery.groupBy({ by: ["status"], where: live, _count: { _all: true } }),
        prisma.gallery.count({ where: { ownerId, trashedAt: { not: null } } }),
        prisma.event.count({ where: live }),
        prisma.photo.groupBy({
          by: ["source"],
          where: { status: "CONFIRMED", gallery: live },
          _count: { _all: true, videoObjectKey: true },
          _sum: { sizeBytes: true },
        }),
        prisma.viewSession.findMany({
          where: { gallery: { ownerId }, startedAt: { gte: windowStart(now) } },
          select: { galleryId: true, viewerId: true, startedAt: true },
        }),
        prisma.photoComment.groupBy({
          by: ["shareLinkId"],
          where: { resolvedAt: null, photo: { gallery: live } },
          _count: { _all: true },
        }),
        prisma.printSelection.groupBy({
          by: ["photoId"],
          where: { photo: { status: "CONFIRMED", gallery: live } },
          _sum: { quantity: true },
        }),
        prisma.photo.count({ where: { status: "PENDING", gallery: live } }),
      ]);

    const series = buildViewSeries(sessions, lastDays(now), () => "all").get("all");
    const galleries = Object.fromEntries(GALLERY_STATUSES.map((status) => [status, 0]));
    for (const row of byStatus) galleries[row.status] = row._count._all;
    const sum = (pick: (row: (typeof media)[number]) => number) =>
      media.reduce((total, row) => total + pick(row), 0);

    return jsonResult({
      galleries: { ...galleries, inTrash: trashed },
      weddings,
      media: {
        photos: sum((row) => row._count._all - row._count.videoObjectKey),
        videos: sum((row) => row._count.videoObjectKey),
        fromGuests: media.find((row) => row.source === "GUEST")?._count._all ?? 0,
        storageBytes: sum((row) => row._sum.sizeBytes ?? 0),
        unfinishedUploads: uploads,
      },
      last14Days: {
        visits: series?.total ?? 0,
        uniqueViewers: series?.unique ?? 0,
        perDay: series?.points ?? emptySeries(lastDays(now)).points,
      },
      openCorrections: openCorrections.reduce((total, row) => total + row._count._all, 0),
      printOrder: {
        photos: prints.length,
        pieces: prints.reduce((total, row) => total + (row._sum.quantity ?? 0), 0),
      },
      adminUrl: `${caller.origin}/admin`,
    });
  },
});

export const galleriesList = defineTool({
  name: "galleries_list",
  title: "Seznam galerií",
  description:
    "Galerie od nejnovějšího dne svatby: stav, datum, svatba, počet fotek a diváků, náhled obálky, odkaz pro hosty a do administrace. Filtruje podle stavu, svatby a názvu.",
  input: z.strictObject({
    status: z.enum(GALLERY_STATUSES).optional().describe("Jen galerie v tomto stavu."),
    wedding_id: z.string().min(1).max(64).optional().describe("Jen galerie této svatby."),
    query: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe("Část názvu, bez ohledu na velikost písmen."),
    in_trash: z.boolean().default(false).describe("Místo živých galerií vrátí ty v koši."),
    limit: limitInput(50, 50),
    offset: offsetInput,
  }),
  access: "read",
  handler: async (args, caller) => {
    const now = new Date();
    const rows = await prisma.gallery.findMany({
      where: {
        ownerId: caller.userId,
        trashedAt: args.in_trash ? { not: null } : null,
        ...(args.status ? { status: args.status } : {}),
        ...(args.wedding_id ? { eventId: args.wedding_id } : {}),
        ...(args.query ? { title: { contains: args.query, mode: "insensitive" as const } } : {}),
      },
      select: {
        id: true,
        title: true,
        status: true,
        eventDate: true,
        createdAt: true,
        trashedAt: true,
        purgeAt: true,
        event: { select: { id: true, title: true, eventDate: true } },
        coverPhoto: { select: coverFields },
        photos: newestPhoto,
        shareLinks: { orderBy: { createdAt: "desc" }, select: linkFields },
        _count: { select: { photos: { where: { status: "CONFIRMED" } }, viewers: true } },
      },
    });

    // As the admin list sorts: an undated gallery goes by its wedding's day.
    const dayOf = (row: (typeof rows)[number]) =>
      (row.eventDate ?? row.event?.eventDate ?? row.createdAt).getTime();
    rows.sort((a, b) => dayOf(b) - dayOf(a));

    const page = rows.slice(args.offset, args.offset + args.limit);
    return jsonResult({
      total: rows.length,
      offset: args.offset,
      galleries: page.map((row) => {
        const cover = pickCover(row.coverPhoto, row.photos[0]);
        return {
          id: row.id,
          title: row.title,
          status: row.status,
          eventDate: day(row.eventDate ?? row.event?.eventDate),
          wedding: row.event ? { id: row.event.id, title: row.event.title } : null,
          photos: row._count.photos,
          viewers: row._count.viewers,
          coverThumbUrl: cover ? thumbUrl(cover.objectKey, cover.thumbObjectKey) : null,
          guestUrl: liveUrl(caller.origin, row.status === "PUBLISHED", row.shareLinks, now),
          adminUrl: adminGalleryUrl(caller.origin, row.id),
          ...(row.trashedAt ? { trashedAt: iso(row.trashedAt), purgeAt: iso(row.purgeAt) } : {}),
        };
      }),
    });
  },
});

export const galleryGet = defineTool({
  name: "gallery_get",
  title: "Detail galerie",
  description:
    "Vše o jedné galerii: popis, stav, řazení fotek, obálka, svatba, sdílené odkazy (adresa, heslo, platnost, oprávnění, PIN připomínek), kapitoly, počty fotek a videí, archiv ke stažení a odkaz do administrace.",
  input: z.strictObject({ gallery_id: idInput("galerie") }),
  access: "read",
  handler: async (args, caller) => {
    const gallery = await prisma.gallery.findFirst({
      where: { id: args.gallery_id, ownerId: caller.userId },
      select: {
        id: true,
        title: true,
        description: true,
        eventDate: true,
        status: true,
        translations: true,
        photoOrder: true,
        highlightsEnabled: true,
        createdAt: true,
        publishedAt: true,
        trashedAt: true,
        purgeAt: true,
        zipStatus: true,
        zipObjectKey: true,
        zipSizeBytes: true,
        zipBuiltAt: true,
        coverPhoto: { select: { ...coverFields, fileName: true } },
        featuredVideoId: true,
        eventId: true,
        eventKey: true,
        listedOnEvent: true,
        eventLinkId: true,
        event: { select: { id: true, title: true } },
        shareLinks: {
          orderBy: { createdAt: "desc" },
          select: {
            ...linkFields,
            passwordHash: true,
            allowDownload: true,
            allowReactions: true,
            allowPrintSelection: true,
            allowUpload: true,
            allowCorrections: true,
            correctionPinCipher: true,
            _count: { select: { viewers: true } },
          },
        },
        chapters: { select: { id: true, title: true, slug: true, ...CHAPTER_START_SELECT } },
        promos: {
          orderBy: { slot: "asc" },
          select: { slot: true, enabled: true, promoCard: { select: { id: true, name: true } } },
        },
      },
    });
    if (!gallery) throw notFound("Galerie nenalezena");

    const [byKind, storage] = await Promise.all([
      prisma.photo.groupBy({
        by: ["status", "source"],
        where: { galleryId: gallery.id },
        _count: { _all: true, videoObjectKey: true },
      }),
      prisma.photo.aggregate({
        where: { galleryId: gallery.id, status: "CONFIRMED" },
        _sum: { sizeBytes: true },
      }),
    ]);
    const confirmed = byKind.filter((row) => row.status === "CONFIRMED");
    const count = (rows: typeof byKind, pick: (row: (typeof byKind)[number]) => number) =>
      rows.reduce((total, row) => total + pick(row), 0);
    const now = new Date();

    return jsonResult({
      id: gallery.id,
      title: gallery.title,
      description: gallery.description,
      eventDate: day(gallery.eventDate),
      status: gallery.status,
      translatedTo: Object.keys(gallery.translations ?? {}),
      photoOrder: gallery.photoOrder,
      highlightsEnabled: gallery.highlightsEnabled,
      createdAt: iso(gallery.createdAt),
      publishedAt: iso(gallery.publishedAt),
      ...(gallery.trashedAt
        ? { trashedAt: iso(gallery.trashedAt), purgeAt: iso(gallery.purgeAt) }
        : {}),
      cover: gallery.coverPhoto
        ? {
            photoId: gallery.coverPhoto.id,
            fileName: gallery.coverPhoto.fileName,
            ...mediaUrls({ ...gallery.coverPhoto, videoObjectKey: null }),
          }
        : null,
      featuredVideoId: gallery.featuredVideoId,
      wedding: gallery.event
        ? {
            id: gallery.event.id,
            title: gallery.event.title,
            eventKey: gallery.eventKey,
            listedOnWeddingPage: gallery.listedOnEvent,
            cardShareLinkId: gallery.eventLinkId,
            adminUrl: adminWeddingUrl(caller.origin, gallery.event.id),
          }
        : null,
      counts: {
        photos: count(confirmed, (row) => row._count._all - row._count.videoObjectKey),
        videos: count(confirmed, (row) => row._count.videoObjectKey),
        fromGuests: count(
          confirmed.filter((row) => row.source === "GUEST"),
          (row) => row._count._all,
        ),
        unfinishedUploads: count(
          byKind.filter((row) => row.status === "PENDING"),
          (row) => row._count._all,
        ),
        failedUploads: count(
          byKind.filter((row) => row.status === "FAILED"),
          (row) => row._count._all,
        ),
        storageBytes: storage._sum.sizeBytes ?? 0,
      },
      shareLinks: gallery.shareLinks.map((link) => ({
        id: link.id,
        label: link.label,
        url: shareLinkUrl(caller.origin, link),
        live: isLive(link, now),
        createdAt: iso(link.createdAt),
        expiresAt: iso(link.expiresAt),
        revokedAt: iso(link.revokedAt),
        password: link.passwordHash !== null,
        viewers: link._count.viewers,
        allowDownload: link.allowDownload,
        allowReactions: link.allowReactions,
        allowPrintSelection: link.allowPrintSelection,
        allowUpload: link.allowUpload,
        allowCorrections: link.allowCorrections,
        correctionPin: link.allowCorrections ? decryptToken(link.correctionPinCipher) : null,
      })),
      chapters: gallery.chapters
        .toSorted(compareChapterStarts(gallery.photoOrder))
        .map((chapter) => ({
          id: chapter.id,
          title: chapter.title,
          anchor: chapter.slug ?? chapter.id,
          startPhotoId: chapter.startPhotoId,
        })),
      archive: {
        status: gallery.zipStatus,
        url: gallery.zipBuiltAt && gallery.zipObjectKey ? bucketUrl(gallery.zipObjectKey) : null,
        sizeBytes: gallery.zipSizeBytes === null ? null : Number(gallery.zipSizeBytes),
        builtAt: iso(gallery.zipBuiltAt),
      },
      promoCards: gallery.promos.map((promo) => ({
        id: promo.promoCard.id,
        name: promo.promoCard.name,
        slot: promo.slot,
        enabled: promo.enabled,
      })),
      adminUrl: adminGalleryUrl(caller.origin, gallery.id),
    });
  },
});

const TOP = 10;

export const galleryStats = defineTool({
  name: "gallery_stats",
  title: "Statistiky galerie",
  description:
    "Jak galerii hosté používají: návštěvy a diváci (celkem i po dnech), stažení, srdíčka a reakce, výběr do tisku (i kdo kolik), nahrávání hostů, připomínky, kliky na vizitku a nejoblíbenější a nejprohlíženější fotky.",
  input: z.strictObject({
    gallery_id: idInput("galerie"),
    days: z
      .number()
      .int()
      .min(1)
      .max(90)
      .default(14)
      .describe("Kolik posledních dní rozepsat po dnech."),
  }),
  access: "read",
  handler: async (args, caller) => {
    const gallery = await prisma.gallery.findFirst({
      where: { id: args.gallery_id, ownerId: caller.userId },
      select: { id: true, title: true },
    });
    if (!gallery) throw notFound("Galerie nenalezena");

    const now = new Date();
    const galleryId = gallery.id;
    const [
      totals,
      perPhoto,
      sessions,
      activity,
      reactions,
      favorites,
      prints,
      printViewers,
      guestUploads,
      corrections,
      promoClicks,
      namedViewers,
    ] = await Promise.all([
      galleryCounts(galleryId),
      photoCounts(galleryId),
      prisma.viewSession.findMany({
        where: { galleryId, startedAt: { gte: windowStart(now, args.days) } },
        select: { galleryId: true, viewerId: true, startedAt: true },
      }),
      prisma.activityEvent.groupBy({ by: ["type"], where: { galleryId }, _count: { _all: true } }),
      prisma.reaction.groupBy({
        by: ["kind"],
        where: { photo: { galleryId } },
        _count: { _all: true },
      }),
      prisma.favorite.groupBy({
        by: ["photoId"],
        where: { photo: { galleryId, status: "CONFIRMED" } },
        _count: { _all: true },
        orderBy: { _count: { photoId: "desc" } },
      }),
      printTotals(galleryId),
      printTotalsByViewer(galleryId),
      prisma.photo.groupBy({
        by: ["uploadedByViewerId"],
        where: { galleryId, source: "GUEST", status: "CONFIRMED" },
        _count: { _all: true },
      }),
      prisma.photoComment.groupBy({
        by: ["resolvedAt"],
        where: { photo: { galleryId } },
        _count: { _all: true },
      }),
      promoClickCounts([galleryId]),
      prisma.viewer.findMany({
        where: { galleryId, displayName: { not: null }, optedOut: false },
        orderBy: { lastSeenAt: "desc" },
        take: 50,
        select: { displayName: true, firstSeenAt: true, lastSeenAt: true },
      }),
    ]);

    const series =
      buildViewSeries(sessions, lastDays(now, args.days), (id) => id).get(galleryId) ??
      emptySeries(lastDays(now, args.days));
    const activityOf = (type: string) =>
      activity.find((row) => row.type === type)?._count._all ?? 0;

    const topViewedIds = [...perPhoto.entries()]
      .sort((a, b) => b[1].uniqueViewers - a[1].uniqueViewers || b[1].views - a[1].views)
      .slice(0, TOP)
      .map(([id]) => id);
    const topFavoriteIds = favorites.slice(0, TOP).map((row) => row.photoId);
    const photos = await prisma.photo.findMany({
      where: { id: { in: [...new Set([...topViewedIds, ...topFavoriteIds])] }, galleryId },
      select: { id: true, fileName: true, objectKey: true, thumbObjectKey: true },
    });
    const byId = new Map(photos.map((photo) => [photo.id, photo]));
    const favoriteCount = new Map(favorites.map((row) => [row.photoId, row._count._all]));
    const describe = (id: string) => {
      const photo = byId.get(id);
      if (!photo) return [];
      return [
        {
          photoId: id,
          fileName: photo.fileName,
          favorites: favoriteCount.get(id) ?? 0,
          views: perPhoto.get(id)?.views ?? 0,
          uniqueViewers: perPhoto.get(id)?.uniqueViewers ?? 0,
          printPieces: prints.get(id) ?? 0,
          thumbUrl: thumbUrl(photo.objectKey, photo.thumbObjectKey),
        },
      ];
    };
    const uploaderNames = await prisma.viewer.findMany({
      where: {
        id: {
          in: guestUploads.flatMap((row) =>
            row.uploadedByViewerId ? [row.uploadedByViewerId] : [],
          ),
        },
      },
      select: { id: true, displayName: true },
    });
    const nameOf = new Map(uploaderNames.map((viewer) => [viewer.id, viewer.displayName]));

    return jsonResult({
      gallery: { id: gallery.id, title: gallery.title },
      allTime: {
        visits: totals.views,
        uniqueViewers: totals.uniqueViewers,
        photoViews: activityOf("PHOTO_VIEW"),
        downloads: activityOf("DOWNLOAD"),
        favorites: favorites.reduce((total, row) => total + row._count._all, 0),
        reactions: Object.fromEntries(reactions.map((row) => [row.kind, row._count._all])),
        promoClicks: promoClicks.get(galleryId) ?? 0,
      },
      period: {
        days: args.days,
        visits: series.total,
        uniqueViewers: series.unique,
        repeatVisits: series.repeat,
        perDay: series.points,
      },
      printOrder: {
        photos: [...prints.values()].filter((quantity) => quantity > 0).length,
        pieces: [...prints.values()].reduce((total, quantity) => total + quantity, 0),
        byViewer: printViewers.map((row) => ({
          name: row.displayName,
          photos: row.photos,
          pieces: row.pieces,
        })),
      },
      guestUploads: {
        photos: guestUploads.reduce((total, row) => total + row._count._all, 0),
        byGuest: guestUploads
          .map((row) => ({
            name: row.uploadedByViewerId ? (nameOf.get(row.uploadedByViewerId) ?? null) : null,
            photos: row._count._all,
          }))
          .sort((a, b) => b.photos - a.photos),
      },
      corrections: {
        open: corrections.find((row) => row.resolvedAt === null)?._count._all ?? 0,
        resolved: corrections
          .filter((row) => row.resolvedAt !== null)
          .reduce((total, row) => total + row._count._all, 0),
      },
      namedViewers: namedViewers.map((viewer) => ({
        name: viewer.displayName,
        firstSeenAt: iso(viewer.firstSeenAt),
        lastSeenAt: iso(viewer.lastSeenAt),
      })),
      topFavorites: topFavoriteIds.flatMap(describe),
      topViewed: topViewedIds.flatMap(describe),
    });
  },
});

export const GALLERY_READ_TOOLS = [overview, galleriesList, galleryGet, galleryStats];
