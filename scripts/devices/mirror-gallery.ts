/**
 * A local copy of a live gallery's photo list, pointing at the live CDN, so a
 * local build can be measured with real photos before it is merged
 * (docs/DEVICE-TESTING.md §A change, before merging). The local seed has no
 * image files at all.
 *
 *   pnpm mirror:gallery <https://…/g/{token}/{slug}>
 *
 * Reads only the gallery's public photos API — what any guest's browser reads
 * — and writes only the local database: it refuses a DATABASE_URL that is not
 * on this machine. Run again to replace the previous mirror.
 */
import "dotenv/config";
import os from "node:os";
import { prisma } from "../../src/lib/db";
import { gallerySlug } from "../../src/lib/gallery-slug";
import { generateShareToken, hashShareToken } from "../../src/lib/share-token";

interface Item {
  objectKey: string;
  thumbObjectKey: string | null;
  video: unknown;
  fileName: string;
  width: number | null;
  height: number | null;
  placeholder: string | null;
}

const PREFIX = "mirror/";

async function main() {
  const link = URL.canParse(process.argv[2] ?? "") ? new URL(process.argv[2]!) : null;
  const token = link?.pathname.startsWith("/g/") ? link.pathname.split("/")[2] : undefined;
  if (!link || !token) throw new Error("usage: pnpm mirror:gallery <https://…/g/{token}/{slug}>");
  const database = new URL(process.env.DATABASE_URL ?? "postgres://unset");
  if (!["localhost", "127.0.0.1", "::1"].includes(database.hostname)) {
    throw new Error(`DATABASE_URL is on ${database.hostname}, not this machine — refusing`);
  }

  const items: Item[] = [];
  let cursor: string | null = null;
  do {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    const response = await fetch(`${link.origin}/api/g/${token}/photos${query}`);
    if (!response.ok) throw new Error(`photos API: ${response.status}`);
    const page = (await response.json()) as { items: Item[]; nextCursor: string | null };
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);

  const owner = await prisma.user.upsert({
    where: { email: "e2e@example.com" },
    update: {},
    create: { id: "e2e-user", name: "E2E Test User", email: "e2e@example.com", role: "admin" },
  });
  await prisma.gallery.deleteMany({ where: { storagePrefix: `${PREFIX}${token}` } });
  const eventDate = new Date("2026-08-22T00:00:00Z");
  const gallery = await prisma.gallery.create({
    data: {
      ownerId: owner.id,
      title: "Mirror",
      eventDate,
      status: "PUBLISHED",
      publishedAt: new Date(),
      storagePrefix: `${PREFIX}${token}`,
    },
  });
  // Films are left out: a poster without its MP4 row would play nothing.
  const photos = items.filter((item) => !item.video);
  await prisma.photo.createMany({
    data: photos.map((item, index) => ({
      galleryId: gallery.id,
      objectKey: item.objectKey,
      thumbObjectKey: item.thumbObjectKey,
      fileName: item.fileName,
      width: item.width,
      height: item.height,
      placeholder: item.placeholder,
      status: "CONFIRMED" as const,
      // In the live gallery's order: the timeline sorts by capture time.
      takenAt: new Date(eventDate.getTime() + 12 * 3_600_000 + index * 1000),
    })),
  });
  const localToken = generateShareToken();
  const slug = gallerySlug(gallery.title, eventDate);
  await prisma.shareLink.create({
    data: { galleryId: gallery.id, tokenHash: hashShareToken(localToken), slug },
  });
  // This machine's network address, not 127.0.0.1: WebKit sends loopback
  // past the throttling proxy, so its page would load at full speed.
  const host =
    Object.values(os.networkInterfaces())
      .flat()
      .find((address) => address?.family === "IPv4" && !address.internal)?.address ?? "127.0.0.1";
  console.log(`${photos.length} photos → http://${host}:3000/g/${localToken}/${slug}`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
