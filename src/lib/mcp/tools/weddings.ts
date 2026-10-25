import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { pickCover } from "@/lib/event-access";
import { isCardVisible } from "@/lib/event-cards";
import { decryptToken } from "@/lib/token-cipher";
import { thumbUrl } from "../media-urls";
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
  weddingUrl,
} from "./common";

const coverFields = { objectKey: true, thumbObjectKey: true, status: true } as const;

export const weddingsList = defineTool({
  name: "weddings_list",
  title: "Seznam svateb",
  description:
    "Svatby (rozcestníky pro hosty) od nejnovější: datum, místo, počet galerií, náhled obálky, adresa pro hosty a do administrace.",
  input: z.strictObject({
    query: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe("Část názvu, bez ohledu na velikost písmen."),
    in_trash: z.boolean().default(false).describe("Místo živých svateb vrátí ty v koši."),
    limit: limitInput(100, 50),
    offset: offsetInput,
  }),
  access: "read",
  handler: async (args, caller) => {
    const where = {
      ownerId: caller.userId,
      trashedAt: args.in_trash ? { not: null } : null,
      ...(args.query ? { title: { contains: args.query, mode: "insensitive" as const } } : {}),
    };
    const [total, events] = await Promise.all([
      prisma.event.count({ where }),
      prisma.event.findMany({
        where,
        orderBy: [{ eventDate: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
        skip: args.offset,
        take: args.limit,
        select: {
          id: true,
          title: true,
          eventDate: true,
          venue: true,
          slug: true,
          tokenCipher: true,
          trashedAt: true,
          purgeAt: true,
          galleries: {
            where: { trashedAt: null },
            orderBy: [{ position: "asc" }, { title: "asc" }],
            select: {
              coverPhoto: { select: coverFields },
              photos: {
                where: { status: "CONFIRMED" },
                orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                take: 1,
                select: coverFields,
              },
            },
          },
        },
      }),
    ]);
    return jsonResult({
      total,
      offset: args.offset,
      weddings: events.map((event) => {
        const cover = pickCover(
          event.galleries.find((gallery) => gallery.coverPhoto)?.coverPhoto ?? null,
          event.galleries.flatMap((gallery) => gallery.photos)[0],
        );
        return {
          id: event.id,
          title: event.title,
          eventDate: day(event.eventDate),
          venue: event.venue,
          galleries: event.galleries.length,
          coverThumbUrl: cover ? thumbUrl(cover.objectKey, cover.thumbObjectKey) : null,
          guestUrl: weddingUrl(caller.origin, event),
          adminUrl: adminWeddingUrl(caller.origin, event.id),
          ...(event.trashedAt
            ? { trashedAt: iso(event.trashedAt), purgeAt: iso(event.purgeAt) }
            : {}),
        };
      }),
    });
  },
});

export const weddingGet = defineTool({
  name: "wedding_get",
  title: "Detail svatby",
  description:
    "Jedna svatba a její galerie v pořadí karet na rozcestníku: zda je karta vidět, přes který sdílený odkaz vede, adresa karty, stav a počet fotek každé galerie.",
  input: z.strictObject({ wedding_id: idInput("svatby") }),
  access: "read",
  handler: async (args, caller) => {
    const event = await prisma.event.findFirst({
      where: { id: args.wedding_id, ownerId: caller.userId },
      select: {
        id: true,
        title: true,
        eventDate: true,
        venue: true,
        slug: true,
        tokenCipher: true,
        translations: true,
        createdAt: true,
        trashedAt: true,
        purgeAt: true,
        galleries: {
          orderBy: [{ position: "asc" }, { title: "asc" }],
          select: {
            id: true,
            title: true,
            status: true,
            eventKey: true,
            position: true,
            listedOnEvent: true,
            trashedAt: true,
            eventLink: {
              select: { id: true, label: true, revokedAt: true, expiresAt: true },
            },
            _count: { select: { photos: { where: { status: "CONFIRMED" } } } },
          },
        },
      },
    });
    if (!event) throw notFound("Svatba nenalezena");

    const base = weddingUrl(caller.origin, event);
    const token = decryptToken(event.tokenCipher);
    const now = new Date();
    return jsonResult({
      id: event.id,
      title: event.title,
      eventDate: day(event.eventDate),
      venue: event.venue,
      translatedTo: Object.keys(event.translations ?? {}),
      createdAt: iso(event.createdAt),
      ...(event.trashedAt ? { trashedAt: iso(event.trashedAt), purgeAt: iso(event.purgeAt) } : {}),
      guestUrl: base,
      galleries: event.galleries.map((gallery) => {
        const link = gallery.eventLink;
        const linkLive = link ? isLive(link, now) : false;
        return {
          id: gallery.id,
          title: gallery.title,
          status: gallery.status,
          photos: gallery._count.photos,
          listedOnWeddingPage: gallery.listedOnEvent,
          // The wedding page's own rule, so "visible" means what a guest sees.
          visibleToGuests: !event.trashedAt && isCardVisible(gallery, now),
          cardShareLink: link ? { id: link.id, label: link.label, live: linkLive } : null,
          cardUrl:
            token && gallery.eventKey
              ? `${caller.origin}/s/${token}/${event.slug}/${gallery.eventKey}`
              : null,
          adminUrl: adminGalleryUrl(caller.origin, gallery.id),
        };
      }),
      adminUrl: adminWeddingUrl(caller.origin, event.id),
    });
  },
});

export const WEDDING_READ_TOOLS = [weddingsList, weddingGet];
