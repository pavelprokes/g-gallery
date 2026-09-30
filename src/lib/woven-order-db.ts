import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { weaveTimes } from "@/lib/woven-order";

/**
 * Writes `Photo.wovenAt` for a gallery shown in FILE_NAME_GUESTS_BY_TIME order,
 * and moves each chapter's `startWovenAt` with its start photo
 * (docs/PHOTO-ORDER.md §Guests woven in).
 *
 * A photographer's photo's woven time depends on its neighbours, so any added,
 * removed or re-timed photo can move others: the whole gallery is recomputed
 * and only the rows that changed are written, in one statement. Galleries in
 * the other orders are left alone — `force` is for switching one into this
 * order, before the switch is saved.
 *
 * Serialised per gallery with a transaction-scoped advisory lock: a batch
 * upload confirms photos in parallel, and two recomputes interleaving their
 * writes would leave a mix of both.
 */
export async function refreshWovenOrder(
  galleryId: string,
  { force = false }: { force?: boolean } = {},
): Promise<void> {
  if (!force) {
    const gallery = await prisma.gallery.findUnique({
      where: { id: galleryId },
      select: { photoOrder: true },
    });
    if (gallery?.photoOrder !== "FILE_NAME_GUESTS_BY_TIME") return;
  }

  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`woven:${galleryId}`}))`;

      const photos = await tx.photo.findMany({
        where: { galleryId, status: "CONFIRMED" },
        select: {
          id: true,
          source: true,
          fileOrderKey: true,
          takenAt: true,
          createdAt: true,
          wovenAt: true,
        },
      });
      const woven = weaveTimes(
        photos.map((photo) => ({
          id: photo.id,
          source: photo.source,
          fileOrderKey: photo.fileOrderKey,
          capturedAt: photo.takenAt ?? photo.createdAt,
        })),
      );

      const changed = photos.flatMap((photo) => {
        const at = woven.get(photo.id)!;
        // As text: a `timestamp(3)` column holds UTC wall-clock time, and a
        // text literal cast to it ignores the "Z" — exactly how Prisma writes
        // DateTime. A Date parameter could arrive as timestamptz and be shifted
        // by the session's time zone on the cast.
        return photo.wovenAt?.getTime() === at.getTime()
          ? []
          : [Prisma.sql`(${photo.id}, ${at.toISOString()})`];
      });
      if (changed.length > 0) {
        await tx.$executeRaw`
        UPDATE "g_gallery"."Photo" AS p
        SET "wovenAt" = v.at::timestamp(3)
        FROM (VALUES ${Prisma.join(changed)}) AS v(id, at)
        WHERE p.id = v.id`;
      }

      // A chapter whose start photo is gone keeps the woven time it had — or,
      // never having had one, falls back to its capture time on read.
      await tx.$executeRaw`
      UPDATE "g_gallery"."GalleryChapter" AS c
      SET "startWovenAt" = p."wovenAt"
      FROM "g_gallery"."Photo" AS p
      WHERE c."galleryId" = ${galleryId}
        AND p.id = c."startPhotoId"
        AND p."wovenAt" IS NOT NULL
        AND c."startWovenAt" IS DISTINCT FROM p."wovenAt"`;
    },
    {
      // Parallel confirms queue up on the lock, each holding a connection; the
      // defaults (2 s to start, 5 s to finish) would fail the tail of a batch.
      maxWait: 15_000,
      timeout: 20_000,
    },
  );
}
