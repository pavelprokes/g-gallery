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
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { EXIF_SCAN_BYTES, readTakenAtFromJpeg } from "../src/lib/exif-taken-at";

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
  console.log(`confirmed JPEG photos: ${photos.length}`);

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
