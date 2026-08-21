/**
 * Fills `Photo.placeholder` for photos uploaded before the column existed.
 *
 *   pnpm backfill:placeholders
 *
 * New uploads compute the colour in the browser. This does the same job for
 * the back catalogue by asking the transform host for a 1×1 PNG — the resize
 * is the averaging, and a 1×1 PNG is small enough to decode here with zlib
 * rather than pulling in an image library.
 *
 * Safe to re-run: it only touches rows where the column is still null, and a
 * photo that fails is skipped rather than aborting the batch.
 */
import "dotenv/config";
import { inflateSync } from "node:zlib";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { averagingUrl } from "../src/lib/image-loader";
import { isPlaceholder } from "../src/lib/placeholder";

/** One transform per photo, so keep the concurrency modest. */
const CONCURRENCY = 4;

async function main() {
  const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DIRECT_URL must be set");
  if (!process.env.NEXT_PUBLIC_PHOTOS_BASE_URL) {
    throw new Error(
      "NEXT_PUBLIC_PHOTOS_BASE_URL must be set — the transform host does the averaging",
    );
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  const photos = await prisma.photo.findMany({
    where: { placeholder: null, status: "CONFIRMED" },
    select: { id: true, objectKey: true, fileName: true },
  });
  console.log(`photos without a placeholder: ${photos.length}`);

  let done = 0;
  let failed = 0;
  let cursor = 0;

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, photos.length) }, async () => {
      for (;;) {
        const photo = photos[cursor++];
        if (!photo) return;

        const colour = await averageColor(photo.objectKey);
        if (!colour) {
          failed += 1;
          console.warn(`  skipped ${photo.fileName}`);
          continue;
        }

        await prisma.photo.update({ where: { id: photo.id }, data: { placeholder: colour } });
        done += 1;
      }
    }),
  );

  console.log(`filled ${done}, skipped ${failed}`);
  await prisma.$disconnect();
}

/**
 * Asks the transform host for a 1×1 PNG and reads its single pixel.
 *
 * The loader is reused rather than building a URL by hand, so this works
 * against Cloudflare and the local imgproxy without knowing which is which.
 */
async function averageColor(objectKey: string): Promise<string | null> {
  try {
    const url = averagingUrl(objectKey);
    if (!url) return null;
    const response = await fetch(url);
    if (!response.ok) return null;

    const colour = decodePngPixel(Buffer.from(await response.arrayBuffer()));
    return colour && isPlaceholder(colour) ? colour : null;
  } catch {
    return null;
  }
}

/**
 * Reads the first pixel out of a tiny PNG.
 *
 * Only handles what a 1×1 transform actually emits — 8-bit RGB or RGBA, no
 * interlacing, no palette. Anything else returns null and the photo is skipped;
 * a missing placeholder is cosmetic.
 */
function decodePngPixel(png: Buffer): string | null {
  if (png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") return null;

  let offset = 8;
  let colourType: number | null = null;
  const idat: Buffer[] = [];

  while (offset + 8 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString("ascii");
    const data = png.subarray(offset + 8, offset + 8 + length);

    if (type === "IHDR") {
      if (data.readUInt8(8) !== 8) return null; // bit depth
      colourType = data.readUInt8(9);
      if (data.readUInt8(12) !== 0) return null; // interlaced
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }

    offset += 12 + length; // length + type + data + CRC
  }

  if (colourType !== 2 && colourType !== 6) return null;
  if (idat.length === 0) return null;

  // Scanline: one filter byte, then the pixel. A 1×1 image cannot reference a
  // previous pixel or row, so every filter type reduces to the raw bytes.
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length < 4) return null;

  const [r, g, b] = [raw[1], raw[2], raw[3]];
  if (r === undefined || g === undefined || b === undefined) return null;

  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
