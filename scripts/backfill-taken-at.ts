/**
 * Refines `Photo.takenAt` from the originals' EXIF for the back catalogue.
 *
 *   pnpm backfill:taken-at
 *
 * The migration that added the column baselined every existing photo to its
 * upload time (`takenAt = createdAt`); new uploads read EXIF in the browser.
 * This closes the gap for photos uploaded before the column existed: it pulls
 * just the head of each original from the public CDN — EXIF lives in the
 * first bytes — and writes the capture time it finds there.
 *
 * Safe to re-run: reads are immutable objects, writes are idempotent, and a
 * photo whose EXIF cannot be read simply keeps its upload-time baseline.
 *
 * Re-run 2026-09-28 when the parser stopped honouring OffsetTimeOriginal
 * (src/lib/exif-taken-at.ts): only photos from bodies that write a zone
 * change. Run it in the zone the uploads happen in — the parser reads
 * wall-clock time in the local zone, exactly as the uploading browser does:
 *
 *   TZ=Europe/Prague pnpm backfill:taken-at
 *
 * Chapters (docs/CHAPTERS.md) start at a photo's timeline position, so any
 * chapter whose starting photo moved is moved with it afterwards — and any
 * chapter from before link anchors existed gets its anchor.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { EXIF_SCAN_BYTES, readTakenAtFromJpeg } from "../src/lib/exif-taken-at";
import { chapterSlug } from "../src/lib/gallery-chapters";

const CONCURRENCY = 6;

async function main() {
  const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DIRECT_URL must be set");
  const base = process.env.NEXT_PUBLIC_PHOTOS_BASE_URL?.replace(/\/$/, "");
  if (!base)
    throw new Error("NEXT_PUBLIC_PHOTOS_BASE_URL must be set — originals are read from the CDN");

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  // JPEG only: EXIF parsing covers nothing else, and nothing else needs it —
  // camera output is what carries capture times worth trusting.
  const photos = await prisma.photo.findMany({
    where: { status: "CONFIRMED", mimeType: "image/jpeg" },
    select: { id: true, objectKey: true, fileName: true, takenAt: true, createdAt: true },
  });
  console.log(
    `confirmed JPEG photos: ${photos.length} (reading wall-clock time in ${Intl.DateTimeFormat().resolvedOptions().timeZone})`,
  );

  let refined = 0;
  let unchanged = 0;
  let noExif = 0;
  let failed = 0;
  let cursor = 0;

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, photos.length) }, async () => {
      for (;;) {
        const photo = photos[cursor++];
        if (!photo) return;

        const head = await fetchHead(`${base}/${encodeKey(photo.objectKey)}`);
        if (!head) {
          failed += 1;
          console.warn(`  fetch failed: ${photo.fileName}`);
          continue;
        }

        const takenAt = readTakenAtFromJpeg(head);
        if (!takenAt) {
          noExif += 1;
          continue;
        }

        if (photo.takenAt && Math.abs(photo.takenAt.getTime() - takenAt.getTime()) < 1000) {
          unchanged += 1;
          continue;
        }

        await prisma.photo.update({ where: { id: photo.id }, data: { takenAt } });
        refined += 1;
      }
    }),
  );

  console.log(
    `refined ${refined}, already correct ${unchanged}, no EXIF ${noExif}, fetch failures ${failed}`,
  );

  // A chapter's start is its first photo's (takenAt, id). Follow the photo;
  // a chapter whose photo is gone keeps its position, as it always does.
  const chapters = await prisma.galleryChapter.findMany({
    select: { id: true, startTakenAt: true, startPhotoId: true },
  });
  const starts = new Map(
    (
      await prisma.photo.findMany({
        where: { id: { in: chapters.map((chapter) => chapter.startPhotoId) } },
        select: { id: true, takenAt: true, createdAt: true },
      })
    ).map((photo) => [photo.id, photo.takenAt ?? photo.createdAt]),
  );
  let chaptersMoved = 0;
  for (const chapter of chapters) {
    const takenAt = starts.get(chapter.startPhotoId);
    if (!takenAt || takenAt.getTime() === chapter.startTakenAt.getTime()) continue;
    await prisma.galleryChapter.update({
      where: { id: chapter.id },
      data: { startTakenAt: takenAt },
    });
    chaptersMoved += 1;
  }
  console.log(`chapters moved with their first photo: ${chaptersMoved} of ${chapters.length}`);

  // Chapters created before link anchors existed link by their id
  // (`#cm1x9k…`). Give each its readable anchor, the same one a new chapter
  // with that title gets. Only null slugs are touched — a slug, once set, is
  // frozen, because links to it may already be out.
  const unslugged = await prisma.galleryChapter.findMany({
    where: { slug: null },
    orderBy: [{ startTakenAt: "asc" }, { startPhotoId: "asc" }],
    select: { id: true, galleryId: true, title: true },
  });
  for (const chapter of unslugged) {
    const taken = await prisma.galleryChapter.findMany({
      where: { galleryId: chapter.galleryId, slug: { not: null } },
      select: { slug: true },
    });
    const slug = chapterSlug(
      chapter.title,
      taken.flatMap((row) => (row.slug ? [row.slug] : [])),
    );
    await prisma.galleryChapter.update({ where: { id: chapter.id }, data: { slug } });
  }
  console.log(`chapters given a link anchor: ${unslugged.length}`);
  await prisma.$disconnect();
  if (failed > 0) process.exitCode = 1;
}

function encodeKey(objectKey: string): string {
  return objectKey.split("/").map(encodeURIComponent).join("/");
}

/** First EXIF_SCAN_BYTES of the object; tolerates a host ignoring Range. */
async function fetchHead(url: string): Promise<Uint8Array | null> {
  try {
    const response = await fetch(url, {
      headers: { Range: `bytes=0-${EXIF_SCAN_BYTES - 1}` },
    });
    if (!response.ok) return null;
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return null;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
