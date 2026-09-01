/** Deletes everything the E2E user owns — galleries cascade to their photos
 * and share links, events to nothing but themselves. Same
 * `tsx --conditions=react-server` requirement as seed.ts. */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/db";

async function main() {
  const seedPath = path.join(__dirname, ".seed.json");
  if (!fs.existsSync(seedPath)) return;

  // Everything the seed and the specs created belongs to the one E2E user, so
  // sweeping by owner is both simpler and safer than tracking ids — a gallery
  // a test created (a guest upload, a new wedding) would otherwise be missed.
  await prisma.gallery.deleteMany({ where: { owner: { email: "e2e@example.com" } } });
  await prisma.event.deleteMany({ where: { owner: { email: "e2e@example.com" } } });
  // Promo cards hang off the *user*, not off a gallery, so deleting the
  // galleries only cascades their placements — the cards themselves would
  // survive into the next run and accumulate.
  await prisma.promoCard.deleteMany({ where: { owner: { email: "e2e@example.com" } } });
  fs.unlinkSync(seedPath);

  await prisma.$disconnect();
}

void main();
