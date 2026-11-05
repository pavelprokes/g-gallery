/**
 * Fills `Photo.thumbhash` for photos uploaded before the column existed, and
 * replaces their `placeholder` with the ThumbHash's true average colour.
 *
 *   pnpm backfill:thumbhash            # every confirmed photo without one
 *   pnpm backfill:thumbhash --dry-run  # count only: downloads and writes nothing
 *
 * New uploads compute both in the browser (src/lib/thumbhash.ts). The old
 * colour was not an average: the 1×1 resize sampled near the middle of the
 * photo, so it goes too — every photo the script touches gets both from the
 * same pixels.
 *
 * Pixels come from the thumbnail the uploading browser stored beside the
 * original (512 px on a guest's photo, 1024 px on the photographer's), straight
 * from the bucket: no transformation billed. A photo without one, or whose
 * thumbnail object is gone, uses the grid's smallest variant of the original —
 * a Cloudflare transformation unless that variant was already requested this
 * month. The dry run says how many photos have no thumbnail. `sharp` shrinks the
 * pixels to ≤100 px with an area-averaging resize and the hash is computed here.
 *
 * Writes to the database `DIRECT_URL` points at: run against production only
 * on purpose. Safe to re-run: it only touches rows where `thumbhash` is still
 * null. A photo that fails is logged with its reason and skipped rather than
 * aborting the batch, and the run then exits 1, so a failure cannot pass for a
 * finished job.
 */
import "dotenv/config";
import sharp from "sharp";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import imageLoader from "../src/lib/image-loader";
import { IMAGE_SIZES } from "../src/lib/image-sizes";
import {
  THUMBHASH_MAX_SIDE,
  isThumbhash,
  thumbhashAverage,
  thumbhashOfPixels,
} from "../src/lib/thumbhash";

/** Small downloads, but keep it polite to the CDN. */
const CONCURRENCY = 6;
const BATCH = 500;

export interface BackfillRow {
  id: string;
  objectKey: string;
  thumbObjectKey: string | null;
  fileName: string;
}

/** The one write this script makes; a parameter so a test can watch it. */
export interface PhotoWriter {
  updateMany(args: {
    where: { id: string; objectKey: string; thumbhash: null };
    data: { thumbhash: string; placeholder?: string };
  }): Promise<{ count: number }>;
}

export async function fillBatch(
  photos: BackfillRow[],
  db: PhotoWriter,
): Promise<{ filled: number; changed: number; failed: number }> {
  const result = { filled: 0, changed: 0, failed: 0 };
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, photos.length) }, async () => {
      for (;;) {
        const photo = photos[cursor++];
        if (!photo) return;
        try {
          const blur = await blurOf(photo.thumbObjectKey ?? photo.objectKey, photo);
          // Guarded on the key: the batch was read minutes ago. A photo replaced
          // or given a new poster since has its own hash, and the old object is
          // still served (`immutable`), so this blur is of the old picture —
          // for good, as a re-run skips a row that has a hash.
          const { count } = await db.updateMany({
            where: { id: photo.id, objectKey: photo.objectKey, thumbhash: null },
            data: {
              thumbhash: blur.thumbhash,
              ...(blur.average ? { placeholder: blur.average } : {}),
            },
          });
          if (count === 1) result.filled += 1;
          else result.changed += 1;
        } catch (error) {
          result.failed += 1;
          console.warn(`  skipped ${photo.id} ${photo.fileName}: ${reasonOf(error)}`);
        }
      }
    }),
  );
  return result;
}

async function blurOf(
  key: string,
  photo: BackfillRow,
): Promise<{ thumbhash: string; average: string | null }> {
  // Through the loader, so this works against Cloudflare and the local
  // imgproxy alike — and a thumbnail goes straight to the bucket.
  const response = await fetch(imageLoader({ src: key, width: IMAGE_SIZES[0] }));
  // A thumbnail can be recorded on the row while its object is gone; the grid
  // falls back to the original then, and so does this. Only then: anything else
  // says nothing about the object, and the original costs a transformation.
  if (response.status === 404 && key !== photo.objectKey) return blurOf(photo.objectKey, photo);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${key}`);
  const { data, info } = await sharp(Buffer.from(await response.arrayBuffer()))
    .rotate()
    .resize(THUMBHASH_MAX_SIDE, THUMBHASH_MAX_SIDE, { fit: "inside", kernel: "mitchell" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const thumbhash = thumbhashOfPixels(info.width, info.height, data);
  if (!isThumbhash(thumbhash)) throw new Error(`the encoder wrote ${thumbhash}`);
  return { thumbhash, average: thumbhashAverage(thumbhash) };
}

function reasonOf(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause instanceof Error ? ` (${error.cause.message})` : "";
  return `${error.message}${cause}`;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DIRECT_URL must be set");
  if (!process.env.NEXT_PUBLIC_PHOTOS_BASE_URL) {
    throw new Error("NEXT_PUBLIC_PHOTOS_BASE_URL must be set — the pixels come from the CDN");
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const missing = { thumbhash: null, status: "CONFIRMED" } as const;
  const [total, withoutThumbnail] = await Promise.all([
    prisma.photo.count({ where: missing }),
    prisma.photo.count({ where: { ...missing, thumbObjectKey: null } }),
  ]);
  console.log(
    `photos without a thumbhash: ${total}; of those, ${withoutThumbnail} without a thumbnail ` +
      `(a transformation each, unless already requested this month)`,
  );
  if (dryRun) {
    await prisma.$disconnect();
    return;
  }

  const totals = { filled: 0, changed: 0, failed: 0 };
  // Keyset over ids, so rows the batch fills (or skips) are never read twice.
  let afterId: string | undefined;

  for (;;) {
    const photos = await prisma.photo.findMany({
      where: { ...missing, ...(afterId ? { id: { gt: afterId } } : {}) },
      orderBy: { id: "asc" },
      take: BATCH,
      select: { id: true, objectKey: true, thumbObjectKey: true, fileName: true },
    });
    if (photos.length === 0) break;
    afterId = photos.at(-1)!.id;

    const batch = await fillBatch(photos, prisma.photo);
    totals.filled += batch.filled;
    totals.changed += batch.changed;
    totals.failed += batch.failed;
    console.log(`  ${totals.filled + totals.changed + totals.failed} / ${total}`);
  }

  console.log(
    `filled ${totals.filled}, changed meanwhile ${totals.changed}, failed ${totals.failed}`,
  );
  await prisma.$disconnect();
  if (totals.failed > 0) process.exitCode = 1;
}

// Not when a test imports this file.
if (process.argv[1]?.endsWith("backfill-thumbhash.ts")) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
