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

  // A second gallery for the guest-upload flow (docs/GUEST-GALLERIES.md §6),
  // kept apart from the viewer-flow one so an upload never changes the photo
  // count the grid/lightbox tests assert on.
  const guestGallery = await prisma.gallery.create({
    data: {
      ownerId: user.id,
      title: "E2E Guest Gallery",
      eventDate: new Date("2026-08-12T00:00:00Z"),
      status: "PUBLISHED",
      publishedAt: new Date(),
      storagePrefix: `galleries/e2e-guest-${Date.now()}`,
    },
  });

  const uploadToken = generateShareToken();
  const uploadSlug = gallerySlug(guestGallery.title, guestGallery.eventDate);
  await prisma.shareLink.create({
    data: {
      galleryId: guestGallery.id,
      tokenHash: hashShareToken(uploadToken),
      allowDownload: true,
      allowReactions: true,
      allowUpload: true,
      slug: uploadSlug,
    },
  });

  // Same gallery, a link that may only look. Proves the refusal is bound to
  // the link and not to the gallery.
  const readOnlyToken = generateShareToken();
  await prisma.shareLink.create({
    data: {
      galleryId: guestGallery.id,
      tokenHash: hashShareToken(readOnlyToken),
      allowUpload: false,
      slug: uploadSlug,
    },
  });

  // --- wedding pages (docs/GUEST-GALLERIES.md §2) ---------------------------
  // One wedding with two galleries — one listed, one attached but hidden — so
  // the two switches can be told apart, and one with a single listed gallery
  // for the render-in-place case.
  const wedding = await makeWedding(user.id, "Pavel a Patricie", "Statek Benice");
  // Two listed, so the page renders as a rozcestník — with a single listed
  // gallery it renders that gallery in place instead, which the solo wedding
  // below covers.
  const guests = await makeEventGallery(user.id, wedding.id, "Od hostů", "od-hostu", true, 4);
  const listed = await makeEventGallery(user.id, wedding.id, "První výběr", "prvni-vyber", true, 3);
  const hidden = await makeEventGallery(
    user.id,
    wedding.id,
    "Kompletní set",
    "kompletni",
    false,
    2,
  );

  const solo = await makeWedding(user.id, "Eliška a Honza", "Zámek Loučeň");
  const soloGallery = await makeEventGallery(user.id, solo.id, "Od hostů", "od-hostu", true, 2);

  fs.writeFileSync(
    path.join(__dirname, ".seed.json"),
    JSON.stringify({
      galleryId: gallery.id,
      token,
      slug,
      photoCount: aspects.length,
      guestGalleryId: guestGallery.id,
      uploadToken,
      uploadSlug,
      readOnlyToken,
      weddingToken: wedding.token,
      weddingSlug: wedding.slug,
      weddingGalleryIds: [guests, listed, hidden],
      soloWeddingToken: solo.token,
      soloWeddingSlug: solo.slug,
      soloGalleryIds: [soloGallery],
    }),
  );

  await prisma.$disconnect();
}

void main();

/** A wedding page plus its raw token, which exists only here and in .seed.json. */
async function makeWedding(ownerId: string, title: string, venue: string) {
  const token = generateShareToken();
  const eventDate = new Date("2026-08-12T00:00:00Z");
  const slug = gallerySlug(title, eventDate);
  const event = await prisma.event.create({
    data: { ownerId, title, venue, eventDate, tokenHash: hashShareToken(token), slug },
    select: { id: true },
  });
  return { id: event.id, token, slug };
}

/**
 * A gallery attached to a wedding page, with the share link its card grants
 * through. Returns the gallery id so teardown can remove it.
 */
async function makeEventGallery(
  ownerId: string,
  eventId: string,
  title: string,
  eventKey: string,
  listedOnEvent: boolean,
  photos: number,
): Promise<string> {
  const gallery = await prisma.gallery.create({
    data: {
      ownerId,
      title,
      eventDate: new Date("2026-08-12T00:00:00Z"),
      status: "PUBLISHED",
      publishedAt: new Date(),
      storagePrefix: `galleries/e2e-ev-${eventKey}-${Date.now()}`,
      eventId,
      eventKey,
      listedOnEvent,
    },
  });

  for (let i = 0; i < photos; i += 1) {
    await prisma.photo.create({
      data: {
        galleryId: gallery.id,
        objectKey: `${gallery.storagePrefix}/photo-${i}.jpg`,
        fileName: `${eventKey}_${i}.jpg`,
        mimeType: "image/jpeg",
        width: 1200,
        height: 800,
        placeholder: "#a37c5c",
        status: "CONFIRMED",
        sizeBytes: 900_000,
      },
    });
  }

  const link = await prisma.shareLink.create({
    data: {
      galleryId: gallery.id,
      tokenHash: hashShareToken(generateShareToken()),
      slug: gallerySlug(title, null),
    },
    select: { id: true },
  });
  await prisma.gallery.update({ where: { id: gallery.id }, data: { eventLinkId: link.id } });

  return gallery.id;
}
