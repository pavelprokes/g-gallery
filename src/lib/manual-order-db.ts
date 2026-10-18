import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { compareTimeline } from "@/lib/gallery-chapters";
import { keyBetween, placeBetween, spreadKeys } from "@/lib/manual-order";
import {
  CHAPTER_START_SELECT,
  chapterStartOf,
  ORDER_KEY_SELECT,
  photoOrderBy,
  positionOf,
  type PhotoOrder,
} from "@/lib/photo-order";

/**
 * Writes for a gallery arranged by hand (docs/PHOTO-ORDER.md §Manual order).
 * Every write here holds a transaction-scoped advisory lock per gallery: two
 * tabs dragging at once, or a drag racing the first arrangement, must not
 * interleave their reads and writes.
 */

/** Past every photo: where a chapter whose photos are all gone waits. */
const PAST_LAST = "z".repeat(64);

type Tx = Prisma.TransactionClient;

async function lock(tx: Tx, galleryId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`manual:${galleryId}`}))`;
}

/** Writes `keys` (id → key) in one statement. */
async function writeKeys(tx: Tx, keys: Map<string, string>) {
  if (keys.size === 0) return;
  const rows = [...keys].map(([id, key]) => Prisma.sql`(${id}, ${key})`);
  await tx.$executeRaw`
    UPDATE "g_gallery"."Photo" AS p
    SET "manualOrderKey" = v.key
    FROM (VALUES ${Prisma.join(rows)}) AS v(id, key)
    WHERE p.id = v.id`;
}

/**
 * Gives every photo of a gallery never arranged by hand a key in the order it
 * shows now, spread evenly so every later move has room, and every chapter a
 * key just before its first photo. Nothing for a gallery arranged before:
 * its order is the photographer's work and is kept.
 */
export async function arrangeByHandFirstTime(galleryId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lock(tx, galleryId);
    const gallery = await tx.gallery.findUnique({
      where: { id: galleryId },
      select: { photoOrder: true, manualOrderAt: true },
    });
    if (!gallery || gallery.manualOrderAt) return;
    const order: PhotoOrder = gallery.photoOrder;

    const photos = await tx.photo.findMany({
      where: { galleryId, status: "CONFIRMED" },
      orderBy: photoOrderBy(order),
      select: { id: true, ...ORDER_KEY_SELECT },
    });
    const spread = spreadKeys(photos.length);
    const keys = new Map(photos.map((photo, i) => [photo.id, spread[i]!]));
    await writeKeys(tx, keys);

    // A chapter goes just before the first photo at or after its start in the
    // old order — the photo it begins with, or, if that one was deleted, the
    // one that has stood in for it.
    const positions = photos.map((photo) => positionOf(order, photo));
    const chapters = await tx.galleryChapter.findMany({
      where: { galleryId },
      select: { id: true, ...CHAPTER_START_SELECT },
    });
    for (const chapter of chapters) {
      const start = chapterStartOf(order, chapter);
      const first = positions.findIndex((p) => compareTimeline(p, start) >= 0);
      // On its photo: that photo's key, as for file names. Its photo gone: a
      // key of its own just before the one that stands in.
      const key =
        first === -1
          ? PAST_LAST
          : positions[first]!.id === chapter.startPhotoId
            ? spread[first]!
            : (keyBetween(spread[first - 1] ?? null, spread[first]!) ?? spread[first]!);
      await tx.galleryChapter.update({
        where: { id: chapter.id },
        data: { startManualKey: key },
      });
    }

    await tx.gallery.update({ where: { id: galleryId }, data: { manualOrderAt: new Date() } });
  });
}

/**
 * Moves one photo to just after `afterId` (null: to the front) and returns
 * its new key. Its chapter start moves with it: a chapter begins at a photo,
 * wherever that photo goes. When the neighbours leave no room — two photos
 * that were never placed sharing a provisional key — the whole gallery is
 * renumbered in the new order instead.
 */
export async function movePhoto(
  galleryId: string,
  photoId: string,
  afterId: string | null,
): Promise<"moved" | "renumbered"> {
  return prisma.$transaction(async (tx) => {
    await lock(tx, galleryId);
    const photos = await tx.photo.findMany({
      where: { galleryId, status: "CONFIRMED" },
      orderBy: photoOrderBy("MANUAL"),
      select: { id: true, manualOrderKey: true },
    });
    const moving = photos.find((p) => p.id === photoId);
    if (!moving) throw new Error("NOT_FOUND");
    const rest = photos.filter((p) => p.id !== photoId);
    const at = afterId === null ? 0 : rest.findIndex((p) => p.id === afterId) + 1;
    if (afterId !== null && at === 0) throw new Error("NOT_FOUND");

    const before = rest[at - 1]?.manualOrderKey ?? null;
    const after = rest[at]?.manualOrderKey ?? null;
    let key = placeBetween(before, after);
    let outcome: "moved" | "renumbered" = "moved";
    if (key === null) {
      const arranged = [...rest.slice(0, at), moving, ...rest.slice(at)];
      const spread = spreadKeys(arranged.length);
      await writeKeys(tx, new Map(arranged.map((p, i) => [p.id, spread[i]!])));
      // Every chapter keeps its start photo; one whose photo is gone keeps its
      // place relative to the photos around it as well as a renumber allows.
      await tx.$executeRaw`
        UPDATE "g_gallery"."GalleryChapter" AS c
        SET "startManualKey" = p."manualOrderKey"
        FROM "g_gallery"."Photo" AS p
        WHERE p.id = c."startPhotoId" AND c."galleryId" = ${galleryId}`;
      key = spread[at]!;
      outcome = "renumbered";
    } else {
      await tx.photo.update({ where: { id: photoId }, data: { manualOrderKey: key } });
    }
    await tx.galleryChapter.updateMany({
      where: { galleryId, startPhotoId: photoId },
      data: { startManualKey: key },
    });
    return outcome;
  });
}
