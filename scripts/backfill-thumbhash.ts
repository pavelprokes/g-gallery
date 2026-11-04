/**
 * Fills `Photo.thumbhash` for photos uploaded before the column existed, and
 * replaces their `placeholder` with the ThumbHash's true average colour.
 *
 *   pnpm backfill:thumbhash            # every confirmed photo without one
 *   pnpm backfill:thumbhash --dry-run  # count and compute, write nothing
 *
 * New uploads compute both in the browser (src/lib/thumbhash.ts). The old
 * colour was not an average: the 1×1 resize sampled near the middle of the
 * photo, so it goes too — every photo the script touches gets both from the
 * same pixels.
 *
 * Pixels come from the 512 px grid thumbnail the uploading browser stored
 * beside the original, straight from the bucket (no transformation billed);
 * a photo without one from the grid's own smallest variant, which galleries
 * already request — no new kind of transformation. `sharp` shrinks them to
 * ≤100 px with an area-averaging resize and the hash is computed here.
 *
 * Writes to the database `DIRECT_URL` points at: run against production only
 * on purpose. Safe to re-run: it only touches rows where `thumbhash` is still
 * null, and a photo that fails is skipped rather than aborting the batch.
 */
import "dotenv/config";
import sharp from "sharp";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import imageLoader from "../src/lib/image-loader";
import { DEVICE_SIZES } from "../src/lib/image-sizes";
import {
  THUMBHASH_MAX_SIDE,
  isThumbhash,
  thumbhashAverage,
  thumbhashOfPixels,
} from "../src/lib/thumbhash";

/** Small downloads, but keep it polite to the CDN. */
const CONCURRENCY = 6;
const BATCH = 500;

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DIRECT_URL must be set");
  if (!process.env.NEXT_PUBLIC_PHOTOS_BASE_URL) {
    throw new Error("NEXT_PUBLIC_PHOTOS_BASE_URL must be set — the pixels come from the CDN");
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const total = await prisma.photo.count({ where: { thumbhash: null, status: "CONFIRMED" } });
  console.log(`photos without a thumbhash: ${total}${dryRun ? " (dry run)" : ""}`);

  let done = 0;
  let failed = 0;
  // Keyset over ids, so rows the batch fills (or skips) are never read twice.
  let afterId: string | undefined;

  for (;;) {
    const photos = await prisma.photo.findMany({
      where: {
        thumbhash: null,
        status: "CONFIRMED",
        ...(afterId ? { id: { gt: afterId } } : {}),
      },
      orderBy: { id: "asc" },
      take: BATCH,
      select: { id: true, objectKey: true, thumbObjectKey: true, fileName: true },
    });
    if (photos.length === 0) break;
    afterId = photos.at(-1)!.id;

    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, photos.length) }, async () => {
        for (;;) {
          const photo = photos[cursor++];
          if (!photo) return;

          const blur = await blurOf(photo.thumbObjectKey ?? photo.objectKey);
          if (!blur) {
            failed += 1;
            console.warn(`  skipped ${photo.fileName}`);
            continue;
          }
          if (!dryRun) {
            await prisma.photo.update({
              where: { id: photo.id },
              data: {
                thumbhash: blur.thumbhash,
                ...(blur.average ? { placeholder: blur.average } : {}),
              },
            });
          }
          done += 1;
        }
      }),
    );
    console.log(`  ${done + failed} / ${total}`);
  }

  console.log(`${dryRun ? "computed" : "filled"} ${done}, skipped ${failed}`);
  await prisma.$disconnect();
}

async function blurOf(key: string): Promise<{ thumbhash: string; average: string | null } | null> {
  try {
    // Through the loader, so this works against Cloudflare and the local
    // imgproxy alike — and a thumbnail goes straight to the bucket.
    const response = await fetch(imageLoader({ src: key, width: DEVICE_SIZES[0] }));
    if (!response.ok) return null;
    const { data, info } = await sharp(Buffer.from(await response.arrayBuffer()))
      .rotate()
      .resize(THUMBHASH_MAX_SIDE, THUMBHASH_MAX_SIDE, { fit: "inside", kernel: "mitchell" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const thumbhash = thumbhashOfPixels(info.width, info.height, data);
    if (!isThumbhash(thumbhash)) return null;
    return { thumbhash, average: thumbhashAverage(thumbhash) };
  } catch {
    return null;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
