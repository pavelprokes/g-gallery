/**
 * Seeds one gallery + share link for the E2E viewer-flow test and writes
 * its token/slug to `e2e/.seed.json` for the spec file to read.
 *
 * Run via `tsx --conditions=react-server` (not the Playwright test runner
 * itself): `src/lib/db.ts` imports `server-only`, which throws unless that
 * condition is set (CLAUDE.md — "Standalone scripts importing src/lib/*
 * need tsx --conditions=react-server"), and Playwright's own TS transform
 * does not set it. `e2e/global-setup.ts` shells out to this script instead
 * of importing it directly, for the same reason.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/db";
import { generateShareToken, hashShareToken } from "../src/lib/share-token";
import { gallerySlug } from "../src/lib/gallery-slug";

async function main() {
  let user = await prisma.user.findFirst({ where: { email: "e2e@example.com" } });
  if (!user) {
    user = await prisma.user.create({
      data: { id: "e2e-user", name: "E2E Test User", email: "e2e@example.com", role: "admin" },
    });
  }

  const gallery = await prisma.gallery.create({
    data: {
      ownerId: user.id,
      title: "E2E Test Gallery",
      eventDate: new Date("2026-08-12T00:00:00Z"),
      status: "PUBLISHED",
      publishedAt: new Date(),
      storagePrefix: `galleries/e2e-${Date.now()}`,
    },
  });

  // Aspect ratios varied enough to exercise the justified-layout algorithm
  // without needing real R2 objects — the test never opens the lightbox on
  // an image far enough to require the byte actually decoding correctly,
  // only that the grid, selection, and navigation mechanics work.
  const aspects = [1.5, 0.667, 1.5, 1.333, 1.0, 1.5, 0.75, 1.5, 0.667, 1.5, 1.0, 1.5];
  for (let i = 0; i < aspects.length; i += 1) {
    const height = 800;
    await prisma.photo.create({
      data: {
        galleryId: gallery.id,
        objectKey: `${gallery.storagePrefix}/photo-${i}.jpg`,
        fileName: `e2e_${String(i).padStart(4, "0")}.jpg`,
        mimeType: "image/jpeg",
        width: Math.round(aspects[i]! * height),
        height,
        placeholder: "#a37c5c",
        status: "CONFIRMED",
        sizeBytes: 1_000_000,
      },
    });
  }

  const token = generateShareToken();
  const slug = gallerySlug(gallery.title, gallery.eventDate);
  await prisma.shareLink.create({
    data: {
      galleryId: gallery.id,
      tokenHash: hashShareToken(token),
      allowDownload: true,
      allowReactions: true,
      slug,
    },
  });

  fs.writeFileSync(
    path.join(__dirname, ".seed.json"),
    JSON.stringify({ galleryId: gallery.id, token, slug, photoCount: aspects.length }),
  );

  await prisma.$disconnect();
}

void main();
