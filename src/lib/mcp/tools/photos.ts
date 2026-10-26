import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { photoOrderBy } from "@/lib/photo-order";
import { presignDownload } from "@/lib/r2";
import { downloadKeyOf } from "@/lib/video";
import { isDetailShot } from "@/lib/social-video/aim";
import { currentFaces, storedFaces } from "@/lib/social-video/faces";
import { parseAspect, planCrop } from "@/lib/photo-crop";
import { croppedUrl, mediaUrls } from "../media-urls";
import { defineTool, jsonResult } from "../tool";
import { adminGalleryUrl, idInput, iso, notFound, offsetInput } from "./common";

const FILTERS = [
  "all",
  "photos",
  "videos",
  "guests",
  "favorites",
  "print",
  "corrections",
  "highlights",
  "details",
] as const;

function filterWhere(filter: (typeof FILTERS)[number]): Prisma.PhotoWhereInput {
  switch (filter) {
    case "photos":
      return { videoObjectKey: null };
    case "videos":
      return { videoObjectKey: { not: null } };
    case "guests":
      return { source: "GUEST" };
    case "favorites":
      return { favorites: { some: {} } };
    case "print":
      return { printSelections: { some: {} } };
    case "corrections":
      return { comments: { some: {} } };
    case "highlights":
      return { highlightPin: true };
    // Narrowed further in the handler: "details" is read off the stored faces.
    // Only stills with a sharp part can be one — the same stills the admin page
    // reads (width and height known) — so the faces JSON loaded is the few.
    case "details":
      return {
        videoObjectKey: null,
        width: { not: null },
        height: { not: null },
        faces: { path: ["focus", "strength"], gte: 0 },
      };
    default:
      return {};
  }
}

/**
 * What fits one answer to the model: a full row is ~790 characters of JSON and
 * a compact one ~560, mostly the CDN addresses. Measured against Claude in
 * production: ~36 k characters came through, ~56 k were cut off into a file.
 * These keep a page at ~33 k.
 */
const FULL_PAGE_MAX = 40;
const COMPACT_PAGE_MAX = 60;

export const photosList = defineTool({
  name: "photos_list",
  title: "Fotky galerie",
  description:
    "Fotky a videa jedné galerie v pořadí, v jakém je vidí hosté, s adresami na veřejném CDN: thumbUrl (náhled do mřížky), previewUrl (velký náhled, 1920 px) a originalUrl (plná kvalita). compact=true vrátí jen id, název souboru a adresy (až 60 na stránku) — na procházení náhledů velkých galerií.",
  input: z.strictObject({
    gallery_id: idInput("galerie"),
    filter: z
      .enum(FILTERS)
      .default("all")
      .describe(
        "photos/videos = jen fotky/videa, guests = od hostů, favorites = má srdíčko, print = vybráno do tisku, corrections = má připomínku, highlights = připnuto do výběru dne, details = detaily (boty, prstýnky, dort…): fotky bez ostrého obličeje s jedním ostrým místem, jak je vybírá filtr Detaily v administraci.",
      ),
    compact: z.boolean().default(false),
    limit: z
      .number()
      .int()
      .min(1)
      .max(COMPACT_PAGE_MAX)
      .default(FULL_PAGE_MAX)
      .describe(
        `Kolik položek vrátit (1–${COMPACT_PAGE_MAX}; bez compact nejvýš ${FULL_PAGE_MAX}). Další stránku dá offset.`,
      ),
    offset: offsetInput,
  }),
  access: "read",
  handler: async (args, caller) => {
    const gallery = await prisma.gallery.findFirst({
      where: { id: args.gallery_id, ownerId: caller.userId },
      select: { id: true, title: true, photoOrder: true, coverPhotoId: true },
    });
    if (!gallery) throw notFound("Galerie nenalezena");

    const limit = args.compact ? args.limit : Math.min(args.limit, FULL_PAGE_MAX);
    const where: Prisma.PhotoWhereInput = {
      galleryId: gallery.id,
      status: "CONFIRMED",
      ...filterWhere(args.filter),
    };
    // "details" is decided per photo from its stored faces (src/lib/social-video/aim.ts),
    // so the page is cut from the matching ids in the guests' order.
    const detailIds =
      args.filter === "details"
        ? (
            await prisma.photo.findMany({
              where,
              orderBy: photoOrderBy(gallery.photoOrder),
              select: {
                id: true,
                faces: true,
                faceTags: {
                  where: { person: { couple: true } },
                  select: { x: true, y: true, w: true, h: true },
                },
              },
            })
          )
            .filter((photo) => {
              const faces = currentFaces(photo.faces);
              return faces !== null && isDetailShot(faces, photo.faceTags);
            })
            .map((photo) => photo.id)
        : null;
    const pageWhere: Prisma.PhotoWhereInput = detailIds
      ? { ...where, id: { in: detailIds.slice(args.offset, args.offset + limit) } }
      : where;
    const [total, photos] = await Promise.all([
      detailIds ? Promise.resolve(detailIds.length) : prisma.photo.count({ where }),
      prisma.photo.findMany({
        where: pageWhere,
        orderBy: photoOrderBy(gallery.photoOrder),
        skip: detailIds ? 0 : args.offset,
        take: limit,
        select: {
          id: true,
          fileName: true,
          objectKey: true,
          thumbObjectKey: true,
          videoObjectKey: true,
          durationMs: true,
          width: true,
          height: true,
          sizeBytes: true,
          takenAt: true,
          source: true,
          highlightPin: true,
          xmpRating: true,
          uploadedBy: { select: { displayName: true } },
          printSelections: { select: { quantity: true } },
          _count: { select: { favorites: true, reactions: true, comments: true } },
        },
      }),
    ]);

    return jsonResult({
      gallery: { id: gallery.id, title: gallery.title, photoOrder: gallery.photoOrder },
      filter: args.filter,
      total,
      offset: args.offset,
      photos: photos.map((photo) => {
        const urls = mediaUrls(photo);
        if (args.compact) return { id: photo.id, fileName: photo.fileName, ...urls };
        return {
          id: photo.id,
          fileName: photo.fileName,
          kind: photo.videoObjectKey ? "video" : "photo",
          takenAt: iso(photo.takenAt),
          width: photo.width,
          height: photo.height,
          sizeBytes: photo.sizeBytes,
          ...(photo.durationMs !== null ? { durationMs: photo.durationMs } : {}),
          source: photo.source,
          ...(photo.uploadedBy?.displayName ? { uploadedBy: photo.uploadedBy.displayName } : {}),
          isCover: photo.id === gallery.coverPhotoId,
          highlightPin: photo.highlightPin,
          xmpRating: photo.xmpRating,
          favorites: photo._count.favorites,
          reactions: photo._count.reactions,
          corrections: photo._count.comments,
          printPieces: photo.printSelections.reduce((sum, row) => sum + row.quantity, 0),
          ...urls,
        };
      }),
    });
  },
});

export const photoGet = defineTool({
  name: "photo_get",
  title: "Detail fotky",
  description:
    "Jedna fotka nebo video: soubor, rozměry, velikost, kdy vznikla, kdo ji nahrál, hodnocení z Lightroomu, obličeje a pojmenovaní lidé, srdíčka, reakce, tisk, zobrazení, připomínky páru — a adresy v plné kvalitě: originalUrl (veřejné CDN) a downloadUrl (stáhne se pod původním názvem, platí 15 minut).",
  input: z.strictObject({ photo_id: idInput("fotky") }),
  access: "read",
  handler: async (args, caller) => {
    const photo = await prisma.photo.findFirst({
      where: { id: args.photo_id, gallery: { ownerId: caller.userId } },
      select: {
        id: true,
        fileName: true,
        mimeType: true,
        sizeBytes: true,
        width: true,
        height: true,
        status: true,
        objectKey: true,
        thumbObjectKey: true,
        videoObjectKey: true,
        loopObjectKey: true,
        durationMs: true,
        placeholder: true,
        source: true,
        takenAt: true,
        createdAt: true,
        xmpRating: true,
        xmpLabel: true,
        xmpHighlight: true,
        highlightPin: true,
        faces: true,
        checkKeptAt: true,
        gallery: { select: { id: true, title: true, coverPhotoId: true, featuredVideoId: true } },
        uploadedBy: { select: { displayName: true } },
        faceTags: {
          select: {
            x: true,
            y: true,
            w: true,
            h: true,
            person: { select: { name: true, couple: true } },
          },
        },
        reactions: { select: { kind: true } },
        printSelections: { select: { quantity: true } },
        comments: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            body: true,
            x: true,
            y: true,
            resolvedAt: true,
            createdAt: true,
            shareLink: { select: { label: true } },
          },
        },
        _count: { select: { favorites: true } },
      },
    });
    if (!photo) throw notFound("Fotka nenalezena");

    const [views, uniqueViewers] = await Promise.all([
      prisma.activityEvent.count({ where: { photoId: photo.id, type: "PHOTO_VIEW" } }),
      prisma.activityEvent
        .findMany({
          where: { photoId: photo.id, type: "PHOTO_VIEW" },
          distinct: ["viewerId"],
          select: { viewerId: true },
        })
        .then((rows) => rows.length),
    ]);
    const reactions: Record<string, number> = {};
    for (const reaction of photo.reactions)
      reactions[reaction.kind] = (reactions[reaction.kind] ?? 0) + 1;
    const faces = currentFaces(photo.faces);
    const downloadKey = downloadKeyOf(photo);
    // presignDownload wants a bare basename, as the print export makes them.
    const downloadName =
      photo.fileName
        .slice(photo.fileName.lastIndexOf("/") + 1)
        .replace(/[\u0000-\u001f\u007f]/g, "") || `foto_${photo.id}.jpg`;

    return jsonResult({
      id: photo.id,
      gallery: {
        id: photo.gallery.id,
        title: photo.gallery.title,
        adminUrl: adminGalleryUrl(caller.origin, photo.gallery.id),
      },
      fileName: photo.fileName,
      kind: photo.videoObjectKey ? "video" : "photo",
      status: photo.status,
      mimeType: photo.mimeType,
      sizeBytes: photo.sizeBytes,
      width: photo.width,
      height: photo.height,
      ...(photo.durationMs !== null ? { durationMs: photo.durationMs } : {}),
      averageColor: photo.placeholder,
      takenAt: iso(photo.takenAt),
      uploadedAt: iso(photo.createdAt),
      source: photo.source,
      uploadedBy: photo.uploadedBy?.displayName ?? null,
      isCover: photo.gallery.coverPhotoId === photo.id,
      isFeaturedVideo: photo.gallery.featuredVideoId === photo.id,
      lightroom: {
        rating: photo.xmpRating,
        label: photo.xmpLabel,
        highlightKeyword: photo.xmpHighlight,
      },
      highlightPin: photo.highlightPin,
      faces: faces ? faces.faces.length : null,
      // The sharp part the video camera aims at without a sharp face (docs/SOCIAL-VIDEO.md §5),
      // 0–1 of the photo; null when nothing stands out or it was not looked for yet.
      focus: faces?.focus
        ? {
            x: faces.focus.x,
            y: faces.focus.y,
            w: faces.focus.w,
            h: faces.focus.h,
            strength: faces.focus.strength,
          }
        : null,
      detail:
        faces && !photo.videoObjectKey
          ? isDetailShot(
              faces,
              photo.faceTags.filter((tag) => tag.person.couple),
            )
          : null,
      people: photo.faceTags.map((tag) => ({ name: tag.person.name, couple: tag.person.couple })),
      checkKeptAt: iso(photo.checkKeptAt),
      favorites: photo._count.favorites,
      reactions,
      printPieces: photo.printSelections.reduce((sum, row) => sum + row.quantity, 0),
      views,
      uniqueViewers,
      corrections: photo.comments.map((comment) => ({
        id: comment.id,
        body: comment.body,
        spot: comment.x !== null && comment.y !== null ? { x: comment.x, y: comment.y } : null,
        resolved: comment.resolvedAt !== null,
        createdAt: iso(comment.createdAt),
        shareLinkLabel: comment.shareLink.label,
      })),
      ...mediaUrls(photo),
      downloadUrl:
        photo.status === "CONFIRMED" ? await presignDownload(downloadKey, downloadName) : null,
    });
  },
});

const CROP_BATCH_MAX = 20;
const SIZE_LIMIT = z.number().int().min(16).max(8192);

export const photoCrop = defineTool({
  name: "photo_crop",
  title: "Ořez a zmenšení fotek",
  description:
    "Adresy na veřejném CDN s fotkou ořezanou na zadaný poměr stran a zmenšenou do zadané největší velikosti — např. pro Instagram (4:5, 1080 px, JPEG) nebo Facebook (1:1). Ořez míří chytře: na pojmenovaný pár, jinak na obličeje (nikdy neusekne hlavu kvůli linii očí), u detailů na ostré místo, jinak do horní třetiny. Vrátí výřez, výslednou velikost a varování (koho by ořez usekl, že je výřez menší než požadovaná velikost, fotka od hosta). Bajty nestahuje; každý nový ořez je na Cloudflare zpoplatněná transformace, tak žádej jen ty, které použiješ.",
  input: z.strictObject({
    photo_ids: z
      .array(idInput("fotky"))
      .min(1)
      .max(CROP_BATCH_MAX)
      .describe(`Fotky, které ořezat stejně (1–${CROP_BATCH_MAX}, např. celý carousel).`),
    aspect: z
      .string()
      .trim()
      .default("4:5")
      .refine((value) => {
        try {
          parseAspect(value);
          return true;
        } catch {
          return false;
        }
      }, "Poměr stran zadej jako „4:5“, „1:1“, „1.91:1“, „9:16“, jiný „Š:V“ (0,25–4), nebo „original“.")
      .describe(
        "Poměr šířky k výšce: 4:5 (Instagram feed), 1:1, 1.91:1, 9:16 (Reel, Story), 16:9, 3:2, 2:3, 4:3, 3:4, jakýkoli „Š:V“, nebo „original“ (bez ořezu, jen zmenšení).",
      ),
    framing: z
      .enum(["photo", "subject"])
      .default("photo")
      .describe(
        "photo = co největší kus fotky v tom poměru; subject = těsně kolem páru, obličejů nebo ostrého detailu (ne menší než výstup, pokud nepovolíš zvětšení).",
      ),
    max_width: SIZE_LIMIT.optional().describe(
      "Největší šířka výsledku v px. Bez max_width i max_height je to 1080.",
    ),
    max_height: SIZE_LIMIT.optional().describe("Největší výška výsledku v px."),
    allow_upscale: z
      .boolean()
      .default(false)
      .describe("Zvětšit výřez, když je menší než požadovaná velikost (jinak zůstane, jak je)."),
    format: z.enum(["jpeg", "webp"]).default("jpeg").describe("jpeg pro Instagram a Facebook."),
    quality: z.number().int().min(30).max(100).default(85),
  }),
  access: "read",
  handler: async (args, caller) => {
    const aspect = parseAspect(args.aspect);
    const rows = await prisma.photo.findMany({
      where: { id: { in: args.photo_ids }, gallery: { ownerId: caller.userId } },
      select: {
        id: true,
        fileName: true,
        galleryId: true,
        objectKey: true,
        videoObjectKey: true,
        width: true,
        height: true,
        status: true,
        source: true,
        faces: true,
        faceTags: {
          where: { person: { couple: true } },
          select: { x: true, y: true, w: true, h: true },
        },
      },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));

    const crops = args.photo_ids.map((id) => {
      const photo = byId.get(id);
      if (!photo || photo.status !== "CONFIRMED")
        return { photoId: id, error: "Fotka nenalezena." };
      if (!photo.width || !photo.height) {
        return {
          photoId: id,
          fileName: photo.fileName,
          error: "Rozměry fotky nejsou známé — ořez nejde spočítat.",
        };
      }
      const stored = storedFaces(photo.faces);
      const plan = planCrop(
        {
          width: photo.width,
          height: photo.height,
          faces: stored?.faces ?? [],
          focus: stored?.focus ?? null,
          coupleTags: photo.faceTags,
        },
        {
          aspect,
          framing: args.framing,
          maxWidth: args.max_width ?? null,
          maxHeight: args.max_height ?? null,
          allowUpscale: args.allow_upscale,
        },
      );
      const url = croppedUrl(photo.objectKey, {
        width: photo.width,
        height: photo.height,
        rect: plan.rect,
        output: plan.output,
        format: args.format,
        quality: args.quality,
      });
      const warnings = [
        ...(photo.source === "GUEST" ? ["Fotka od hosta, ne fotografova práce."] : []),
        ...(photo.videoObjectKey ? ["Video: ořez je z jeho plakátu."] : []),
        ...(!stored ? ["Obličeje ještě nejsou rozpoznané — ořez míří jen podle kompozice."] : []),
        ...(url ? [] : ["Ořez tu nejde: CDN nemá zapnuté transformace obrázků."]),
        ...plan.warnings,
      ];
      return {
        photoId: photo.id,
        fileName: photo.fileName,
        galleryId: photo.galleryId,
        url,
        width: plan.output.width,
        height: plan.output.height,
        format: args.format,
        crop: { ...plan.rect, of: { width: photo.width, height: photo.height } },
        aim: plan.aim,
        faces: plan.faces,
        upscaled: plan.upscaled,
        warnings,
      };
    });
    return jsonResult({ aspect: args.aspect, framing: args.framing, crops });
  },
});

export const PHOTO_READ_TOOLS = [photosList, photoGet, photoCrop];
