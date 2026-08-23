/** Deletes the gallery `e2e/seed.ts` created — cascades to its photos and
 * share link. Same `tsx --conditions=react-server` requirement as seed.ts. */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/db";

async function main() {
  const seedPath = path.join(__dirname, ".seed.json");
  if (!fs.existsSync(seedPath)) return;

  const seed = JSON.parse(fs.readFileSync(seedPath, "utf8")) as {
    galleryId: string;
    guestGalleryId?: string;
    weddingGalleryIds?: string[];
    soloGalleryIds?: string[];
  };

  const galleryIds = [
    seed.galleryId,
    seed.guestGalleryId,
    ...(seed.weddingGalleryIds ?? []),
    ...(seed.soloGalleryIds ?? []),
  ].filter((id): id is string => Boolean(id));

  await prisma.gallery.deleteMany({ where: { id: { in: galleryIds } } });
  // Events own no R2 objects and their galleries are already gone by here.
  await prisma.event.deleteMany({ where: { owner: { email: "e2e@example.com" } } });
  fs.unlinkSync(seedPath);

  await prisma.$disconnect();
}

void main();
