import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import type { ActivityType } from "@/generated/prisma/enums";
import { printDownloadsFor } from "@/lib/gallery-admin";
import { printList } from "@/lib/print-export";
import { printTotalsByViewer } from "@/lib/print-selections";
import { mediaUrls, thumbUrl } from "../media-urls";
import { defineTool, jsonResult } from "../tool";
import { idInput, iso, limitInput, offsetInput, owned } from "./common";

/**
 * What the Updates feed shows (src/lib/feed.ts) plus the rest of what guests
 * do on purpose. GALLERY_VIEW and PHOTO_VIEW stay out for the feed's reason: a
 * heartbeat every five minutes would bury everything else — the counts live in
 * gallery_stats.
 */
const ACTIVITY_TYPES = [
  "REACTION",
  "FAVORITE",
  "DOWNLOAD",
  "VISITOR_IDENTIFIED",
  "PRINT_SELECT",
  "CORRECTION",
  "PROMO_CLICK",
] as const satisfies readonly ActivityType[];

export const activityRecent = defineTool({
  name: "activity_recent",
  title: "Nedávná aktivita",
  description:
    "Co hosté v galeriích naposledy dělali, od nejnovějšího: srdíčka, reakce, stažení, výběr do tisku, připomínky, představení se jménem, kliky na vizitku. Bez opakovaných návštěv — jejich počty jsou v gallery_stats.",
  input: z.strictObject({
    gallery_id: z.string().min(1).max(64).optional().describe("Jen aktivita této galerie."),
    types: z
      .array(z.enum(ACTIVITY_TYPES))
      .min(1)
      .max(ACTIVITY_TYPES.length)
      .optional()
      .describe("Jen tyto druhy."),
    days: z.number().int().min(1).max(395).default(7).describe("Jak daleko do minulosti (dny)."),
    limit: limitInput(100, 50),
  }),
  access: "read",
  handler: async (args, caller) => {
    const since = new Date(Date.now() - args.days * 24 * 60 * 60 * 1000);
    const events = await prisma.activityEvent.findMany({
      where: {
        gallery: { ownerId: caller.userId },
        ...(args.gallery_id ? { galleryId: args.gallery_id } : {}),
        type: { in: args.types ?? [...ACTIVITY_TYPES] },
        createdAt: { gte: since },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: args.limit,
      select: {
        type: true,
        createdAt: true,
        gallery: { select: { id: true, title: true } },
        photo: { select: { id: true, fileName: true, objectKey: true, thumbObjectKey: true } },
        viewer: { select: { displayName: true } },
      },
    });
    return jsonResult({
      since: iso(since),
      events: events.map((event) => ({
        type: event.type,
        at: iso(event.createdAt),
        gallery: event.gallery,
        // Only ever a name the viewer typed in themselves; anonymous otherwise.
        viewer: event.viewer?.displayName ?? null,
        photo: event.photo
          ? {
              id: event.photo.id,
              fileName: event.photo.fileName,
              thumbUrl: thumbUrl(event.photo.objectKey, event.photo.thumbObjectKey),
            }
          : null,
      })),
    });
  },
});

export const correctionsList = defineTool({
  name: "corrections_list",
  title: "Připomínky páru",
  description:
    "Připomínky k fotkám z režimu připomínek (za PINem sdíleného odkazu): text, místo na fotce, kdo (štítek odkazu), kdy, a fotka s náhledem. Výchozí jsou jen nevyřízené.",
  input: z.strictObject({
    gallery_id: z.string().min(1).max(64).optional().describe("Jen připomínky této galerie."),
    status: z.enum(["open", "resolved", "all"]).default("open"),
    limit: limitInput(40, 40),
    offset: offsetInput,
  }),
  access: "read",
  handler: async (args, caller) => {
    const comments = await prisma.photoComment.findMany({
      where: {
        photo: {
          gallery: { ownerId: caller.userId },
          ...(args.gallery_id ? { galleryId: args.gallery_id } : {}),
        },
        ...(args.status === "open" ? { resolvedAt: null } : {}),
        ...(args.status === "resolved" ? { resolvedAt: { not: null } } : {}),
      },
      orderBy: { createdAt: "asc" },
      skip: args.offset,
      take: args.limit,
      select: {
        id: true,
        body: true,
        x: true,
        y: true,
        resolvedAt: true,
        createdAt: true,
        shareLink: { select: { label: true } },
        photo: {
          select: {
            id: true,
            fileName: true,
            objectKey: true,
            thumbObjectKey: true,
            videoObjectKey: true,
            gallery: { select: { id: true, title: true } },
          },
        },
      },
    });
    return jsonResult({
      status: args.status,
      corrections: comments.map((comment) => ({
        id: comment.id,
        body: comment.body,
        spot: comment.x !== null && comment.y !== null ? { x: comment.x, y: comment.y } : null,
        resolvedAt: iso(comment.resolvedAt),
        createdAt: iso(comment.createdAt),
        shareLinkLabel: comment.shareLink.label,
        gallery: comment.photo.gallery,
        photo: {
          id: comment.photo.id,
          fileName: comment.photo.fileName,
          ...mediaUrls(comment.photo),
        },
      })),
    });
  },
});

const PRINT_PAGE_MAX = 40;

export const printOrderGet = defineTool({
  name: "print_order_get",
  title: "Objednávka do tisku",
  description:
    "Co hosté v galerii označili do tisku: celý seznam pro tiskárnu („5x_…“), kdo kolik vybral, a po stránkách položky s odkazem ke stažení originálu pod tiskovým názvem (platí 15 minut).",
  input: z.strictObject({
    gallery_id: idInput("galerie"),
    // A signed download link is ~700 characters; the plain list stays whole.
    limit: limitInput(PRINT_PAGE_MAX, PRINT_PAGE_MAX),
    offset: offsetInput,
  }),
  access: "read",
  handler: async (args, caller) => {
    const items = await owned(
      printDownloadsFor(caller.userId, args.gallery_id),
      "Galerie nenalezena",
    );
    const byViewer = await printTotalsByViewer(args.gallery_id);
    return jsonResult({
      photos: items.length,
      pieces: items.reduce((sum, item) => sum + item.quantity, 0),
      offset: args.offset,
      items: items.slice(args.offset, args.offset + args.limit).map((item) => ({
        photoId: item.id,
        printName: item.name,
        quantity: item.quantity,
        downloadUrl: item.url,
      })),
      byViewer: byViewer.map((row) => ({
        name: row.displayName,
        photos: row.photos,
        pieces: row.pieces,
      })),
      list: printList(items),
    });
  },
});

export const ACTIVITY_READ_TOOLS = [activityRecent, correctionsList, printOrderGet];
