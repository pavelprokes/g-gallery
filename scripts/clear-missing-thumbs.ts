/**
 * Clears `Photo.thumbObjectKey` where the thumbnail is no longer in the bucket.
 *
 *   pnpm clear:missing-thumbs            # report only
 *   pnpm clear:missing-thumbs --apply    # write
 *
 * The grid renders `thumbObjectKey ?? objectKey`, and on Cloudflare a thumbnail
 * key is served straight from the bucket with no transform behind it. A row
 * pointing at an object that is gone therefore renders an empty tile forever.
 * Nulling the column puts those photos back on the transformed original — the
 * same path a device that could never make a thumbnail already takes.
 *
 * Reads go to the public CDN rather than to R2 credentials on purpose: what
 * matters is whether a viewer can fetch the thumbnail, which is the same
 * question this asks.
 *
 * Safe to re-run: a photo whose thumbnail is present is left alone.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const CONCURRENCY = 8;

async function main() {
  const apply = process.argv.includes("--apply");
  const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DIRECT_URL must be set");
  const base = process.env.NEXT_PUBLIC_PHOTOS_BASE_URL?.replace(/\/$/, "");
  if (!base) throw new Error("NEXT_PUBLIC_PHOTOS_BASE_URL must be set — thumbnails are read there");

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  const photos = await prisma.photo.findMany({
    where: { thumbObjectKey: { not: null } },
    select: { id: true, fileName: true, thumbObjectKey: true },
  });
  console.log(`photos with a recorded thumbnail: ${photos.length}`);

  const missing: { id: string; fileName: string }[] = [];
  let cursor = 0;

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, photos.length) }, async () => {
      for (;;) {
        const photo = photos[cursor++];
        if (!photo?.thumbObjectKey) return;
        if (await exists(`${base}/${encodeKey(photo.thumbObjectKey)}`)) continue;
        missing.push({ id: photo.id, fileName: photo.fileName });
      }
    }),
  );

  console.log(`thumbnails missing from the bucket: ${missing.length}`);
  for (const photo of missing) console.log(`  ${photo.fileName}`);

  if (missing.length === 0) return prisma.$disconnect();

  if (!apply) {
    console.log("\nreport only — re-run with --apply to clear these");
    return prisma.$disconnect();
  }

  const { count } = await prisma.photo.updateMany({
    where: { id: { in: missing.map((photo) => photo.id) } },
    data: { thumbObjectKey: null },
  });
  console.log(`cleared ${count}`);
  await prisma.$disconnect();
}

function encodeKey(objectKey: string): string {
  return objectKey.split("/").map(encodeURIComponent).join("/");
}

/** A network failure counts as present: never drop a key on a flaky read. */
async function exists(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: "HEAD" });
    return response.status !== 404;
  } catch {
    return true;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
