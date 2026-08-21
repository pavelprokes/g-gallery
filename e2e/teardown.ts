/** Deletes the gallery `e2e/seed.ts` created — cascades to its photos and
 * share link. Same `tsx --conditions=react-server` requirement as seed.ts. */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/db";

async function main() {
  const seedPath = path.join(__dirname, ".seed.json");
  if (!fs.existsSync(seedPath)) return;

  const { galleryId } = JSON.parse(fs.readFileSync(seedPath, "utf8")) as { galleryId: string };
  await prisma.gallery.deleteMany({ where: { id: galleryId } });
  fs.unlinkSync(seedPath);

  await prisma.$disconnect();
}

void main();
