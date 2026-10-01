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
import { createHmac, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/db";
import { generateShareToken, hashShareToken } from "../src/lib/share-token";
import { gallerySlug } from "../src/lib/gallery-slug";
import { refreshWovenOrder } from "../src/lib/woven-order-db";

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
        // Confirm always sets a capture time in production; a minute apart in
        // index order keeps the timeline deterministic for the specs.
        takenAt: new Date(Date.UTC(2026, 7, 22, 12, i)),
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

  // The owner's credit tile, placed in the *viewer-flow* gallery on purpose
  // (docs/PROMO-CARDS.md): every existing assertion in gallery-view.spec.ts —
  // tile count, lightbox "1 / N", arrow-key roving, shift-click ranges — then
  // doubles as proof that a non-photo tile in the grid disturbs none of them.
  const promoCard = await prisma.promoCard.create({
    data: {
      ownerId: user.id,
      name: "E2E Promo",
      eyebrow: "Fotografie",
      headline: "Fotil E2E Fotograf",
      body: "Svatby po celé republice.",
      ctaLabel: "Portfolio",
      ctaUrl: "https://example.com/portfolio",
      theme: "LIGHT",
    },
    select: { id: true },
  });
  const promoSlot = 5;
  await prisma.galleryPromo.create({
    data: { galleryId: gallery.id, promoCardId: promoCard.id, slot: promoSlot, enabled: true },
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
      // As the admin makes a guests' gallery (docs/PHOTO-ORDER.md).
      photoOrder: "TAKEN_AT",
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
  // Accepts uploads, so the wedding page renders it as the compact guest row
  // under the photographer's tiles (docs/GUEST-GALLERIES.md §2).
  const guests = await makeEventGallery(user.id, wedding.id, "Od hostů", "od-hostu", true, 4, true);
  const listed = await makeEventGallery(user.id, wedding.id, "První výběr", "prvni-vyber", true, 3);
  const hidden = await makeEventGallery(
    user.id,
    wedding.id,
    "Kompletní set",
    "kompletni",
    false,
    2,
  );

  // Guest-facing translations typed in the admin (docs/I18N.md §Content). One
  // gallery translated into both languages, one into English only — so the
  // French page exercises its own language *and* the fall back to English —
  // and the couple's names left alone, as they usually are.
  await prisma.event.update({
    where: { id: wedding.id },
    data: { translations: { en: { venue: "Benice Farm" }, fr: { venue: "Domaine de Benice" } } },
  });
  await prisma.gallery.update({
    where: { id: guests },
    data: {
      translations: { en: { title: "From the guests" }, fr: { title: "Photos des invités" } },
    },
  });
  await prisma.gallery.update({
    where: { id: listed },
    data: { translations: { en: { title: "First picks" } } },
  });

  // One per browser project. Deleting asserts on exact counts, and both
  // projects run in parallel — sharing a gallery would make the count a race
  // rather than a fact. Seeded with photos nobody's anonKey owns, which is what
  // "somebody else's photo" looks like to a fresh browser context.
  const selfDelete: Record<string, { token: string; slug: string }> = {};
  for (const project of ["chromium", "mobile-safari"]) {
    const wedding = await makeWedding(user.id, `Klára a Tomáš ${project}`, "Mlýn Kamenice");
    await makeEventGallery(user.id, wedding.id, "Od hostů", "od-hostu", true, 2, true);
    selfDelete[project] = { token: wedding.token, slug: wedding.slug };
  }

  // The name asked before the picker (docs/GUEST-GALLERIES.md §6). Empty
  // galleries of their own, one set per project, so "the photo I just added"
  // is simply the only tile. `second` is the next gallery the same guest opens:
  // a name given in `first` must credit their photos there too.
  const naming: Record<
    string,
    { first: GuestLink; second: GuestLink; skip: GuestLink; optOut: GuestLink }
  > = {};
  for (const project of ["chromium", "mobile-safari"]) {
    naming[project] = {
      first: await makeGuestGallery(user.id, `E2E Jméno 1 ${project}`),
      second: await makeGuestGallery(user.id, `E2E Jméno 2 ${project}`),
      skip: await makeGuestGallery(user.id, `E2E Bez jména ${project}`),
      optOut: await makeGuestGallery(user.id, `E2E Nepočítat ${project}`),
    };
  }

  const solo = await makeWedding(user.id, "Eliška a Honza", "Zámek Loučeň");
  const soloGallery = await makeEventGallery(user.id, solo.id, "Od hostů", "od-hostu", true, 2);

  // --- pre-built "download all" archive, one gallery per state (docs/TODO.md
  // §7). Their own galleries, so the photo counts the grid/lightbox specs
  // assert on stay untouched.
  const archives = {
    // Never built: the only state that may hide the download link.
    none: await makeArchiveGallery(user.id, "E2E Archiv – nikdy", {}),
    ready: await makeArchiveGallery(user.id, "E2E Archiv – hotový", {
      zipStatus: "READY",
      zipObjectKey: "galleries/e2e-archive/_archive.zip",
      zipSizeBytes: 12_300_000n,
      zipBuiltAt: new Date("2026-09-01T10:00:00Z"),
    }),
    // A rebuild in flight over an archive that already exists. R2 leaves the
    // finished object at the key untouched until the multipart upload
    // completes, so this must still offer the previous archive — hiding it
    // was the bug that made a whole gallery look broken.
    rebuilding: await makeArchiveGallery(user.id, "E2E Archiv – přestavba", {
      zipStatus: "BUILDING",
      zipObjectKey: "galleries/e2e-archive/_archive.zip",
      zipSizeBytes: 12_300_000n,
      zipBuiltAt: new Date("2026-09-01T10:00:00Z"),
    }),
    // Over LARGE_ARCHIVE_BYTES, so "Stáhnout vše" asks before it starts. The
    // size is a real delivered wedding's — and past the int4 ceiling that used
    // to make a gallery this big impossible to record at all.
    large: await makeArchiveGallery(user.id, "E2E Archiv – velká svatba", {
      zipStatus: "READY",
      zipObjectKey: "galleries/e2e-archive/_archive-00000000000000000000000000000001.zip",
      zipSizeBytes: BigInt("6572945527"),
      zipBuiltAt: new Date("2026-09-01T10:00:00Z"),
    }),
    // Same, after a build that failed. FAILED used to be terminal *and*
    // hide the link, so this gallery had no download button ever again.
    failed: await makeArchiveGallery(user.id, "E2E Archiv – selhala přestavba", {
      zipStatus: "FAILED",
      zipAttempts: 2,
      zipObjectKey: "galleries/e2e-archive/_archive.zip",
      zipSizeBytes: 12_300_000n,
      zipBuiltAt: new Date("2026-09-01T10:00:00Z"),
    }),
  };

  const chapters = await makeChaptersGallery(user.id);
  const fileOrder = await makeFileOrderGallery(user.id);
  const wovenOrder = await makeWovenOrderGallery(user.id);
  const highlights = await makeHighlightsGallery(user.id);

  const adminCookie = await makeAdminSession(user.id);
  await makeActivity(user.id);
  // One per browser project: they run side by side and this one is mutated.
  const selectGalleryIds = {
    chromium: await makeSelectGallery(user.id),
    "mobile-safari": await makeSelectGallery(user.id),
  };

  fs.writeFileSync(
    path.join(__dirname, ".seed.json"),
    JSON.stringify({
      adminCookie,
      selectGalleryIds,
      galleryId: gallery.id,
      token,
      slug,
      photoCount: aspects.length,
      promoSlot,
      promoHeadline: "Fotil E2E Fotograf",
      promoCtaUrl: "https://example.com/portfolio",
      guestGalleryId: guestGallery.id,
      uploadToken,
      uploadSlug,
      readOnlyToken,
      weddingId: wedding.id,
      weddingToken: wedding.token,
      weddingSlug: wedding.slug,
      weddingGalleryIds: [guests, listed, hidden],
      soloWeddingToken: solo.token,
      soloWeddingSlug: solo.slug,
      soloGalleryIds: [soloGallery],
      selfDelete,
      naming,
      archives,
      chapters,
      fileOrder,
      wovenOrder,
      highlights,
    }),
  );

  await prisma.$disconnect();
}

void main();

/**
 * A standalone published gallery whose only interesting property is the state
 * of its pre-built archive, plus a share link that allows downloads. Two
 * photos, because a one-photo gallery takes the "download the single file"
 * branch instead of the archive branch.
 */
async function makeArchiveGallery(
  ownerId: string,
  title: string,
  zip: {
    zipStatus?: "NONE" | "PENDING" | "BUILDING" | "READY" | "FAILED";
    zipObjectKey?: string;
    zipSizeBytes?: bigint;
    zipBuiltAt?: Date;
    zipAttempts?: number;
  },
) {
  const gallery = await prisma.gallery.create({
    data: {
      ownerId,
      title,
      eventDate: new Date("2026-08-12T00:00:00Z"),
      status: "PUBLISHED",
      publishedAt: new Date(),
      storagePrefix: `galleries/e2e-archive-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ...zip,
    },
  });

  for (let i = 0; i < 2; i += 1) {
    await prisma.photo.create({
      data: {
        galleryId: gallery.id,
        objectKey: `${gallery.storagePrefix}/photo-${i}.jpg`,
        fileName: `archive_${i}.jpg`,
        mimeType: "image/jpeg",
        width: 1200,
        height: 800,
        placeholder: "#a37c5c",
        status: "CONFIRMED",
        sizeBytes: 1_000_000,
        crc32: "deadbeef",
        takenAt: new Date(Date.UTC(2026, 7, 22, 12, i)),
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
      slug,
    },
  });
  return { id: gallery.id, token, slug };
}

interface GuestLink {
  token: string;
  slug: string;
}

/** A standalone, empty gallery whose share link accepts guest uploads. */
async function makeGuestGallery(ownerId: string, title: string): Promise<GuestLink> {
  const gallery = await prisma.gallery.create({
    data: {
      ownerId,
      title,
      status: "PUBLISHED",
      publishedAt: new Date(),
      storagePrefix: `galleries/e2e-name-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      // As the admin makes a guests' gallery (docs/PHOTO-ORDER.md).
      photoOrder: "TAKEN_AT",
    },
  });
  const token = generateShareToken();
  const slug = gallerySlug(title, null);
  await prisma.shareLink.create({
    data: {
      galleryId: gallery.id,
      tokenHash: hashShareToken(token),
      allowReactions: true,
      allowUpload: true,
      slug,
    },
  });
  return { token, slug };
}

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
  allowUpload = false,
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
      // As the wedding page's "pro hosty" makes a guests' gallery (docs/PHOTO-ORDER.md).
      ...(allowUpload ? { photoOrder: "TAKEN_AT" as const } : {}),
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
        takenAt: new Date(Date.UTC(2026, 7, 22, 12, i)),
      },
    });
  }

  const link = await prisma.shareLink.create({
    data: {
      galleryId: gallery.id,
      tokenHash: hashShareToken(generateShareToken()),
      slug: gallerySlug(title, null),
      allowUpload,
    },
    select: { id: true },
  });
  await prisma.gallery.update({ where: { id: gallery.id }, data: { eventLinkId: link.id } });

  return gallery.id;
}

/**
 * A gallery long enough that its last chapter sits past the first two photo
 * pages (60 each), so jumping to it has to fetch metadata it does not have yet
 * (docs/CHAPTERS.md). One chapter starts after the last photo — empty, and
 * never shown.
 */
async function makeChaptersGallery(ownerId: string) {
  const gallery = await prisma.gallery.create({
    data: {
      ownerId,
      title: "E2E Kapitoly",
      status: "PUBLISHED",
      publishedAt: new Date(),
      storagePrefix: `galleries/e2e-chapters-${Date.now()}`,
    },
  });

  const photoCount = 130;
  const takenAt = (i: number) => new Date(Date.UTC(2026, 7, 22, 10, i));
  const ids: string[] = [];
  for (let i = 0; i < photoCount; i += 1) {
    const photo = await prisma.photo.create({
      data: {
        galleryId: gallery.id,
        objectKey: `${gallery.storagePrefix}/chapter-photo-${i}.jpg`,
        fileName: `chapter_${i}.jpg`,
        mimeType: "image/jpeg",
        width: 1200,
        height: 800,
        placeholder: "#a37c5c",
        status: "CONFIRMED",
        sizeBytes: 900_000,
        takenAt: takenAt(i),
      },
      select: { id: true },
    });
    ids.push(photo.id);
  }

  const starts = [
    { title: "Přípravy", slug: "getting-ready", at: 0 },
    { title: "Obřad", slug: "ceremony", at: 40 },
    { title: "První tanec", slug: "first-dance", at: 125 },
  ];
  for (const { title, slug, at } of starts) {
    await prisma.galleryChapter.create({
      data: {
        galleryId: gallery.id,
        title,
        slug,
        startTakenAt: takenAt(at),
        startPhotoId: ids[at]!,
      },
    });
  }
  await prisma.galleryChapter.create({
    data: {
      galleryId: gallery.id,
      title: "Prázdná",
      slug: "prazdna",
      startTakenAt: takenAt(photoCount + 5),
      startPhotoId: "zzz",
    },
  });

  const token = generateShareToken();
  const slug = gallerySlug(gallery.title, null);
  await prisma.shareLink.create({
    data: { galleryId: gallery.id, tokenHash: hashShareToken(token), slug },
  });

  return {
    token,
    slug,
    titles: starts.map((s) => s.title),
    anchors: starts.map((s) => s.slug),
    lastChapterAt: 125,
  };
}

/**
 * A gallery shown in file-name order (docs/PHOTO-ORDER.md), built like the
 * wedding that asked for it: the photographer's export numbering
 * (`svatba_0001_PPR…`), and a second camera — every fifth photo — whose clock
 * reads an hour early, so capture-time order would pull its photos an hour
 * back. More photos than one page, so the cursor has to carry the order.
 * Inserted last-first, so neither ids nor insertion order happen to agree
 * with the file names.
 */
async function makeFileOrderGallery(ownerId: string) {
  const gallery = await prisma.gallery.create({
    data: {
      ownerId,
      title: "E2E Pořadí podle názvu",
      status: "PUBLISHED",
      publishedAt: new Date(),
      storagePrefix: `galleries/e2e-file-order-${Date.now()}`,
      photoOrder: "FILE_NAME",
    },
  });

  const photoCount = 70;
  const secondBody = (n: number) => n % 5 === 0;
  const takenAt = (n: number) =>
    new Date(Date.UTC(2026, 8, 5, 8, n) - (secondBody(n) ? 3_600_000 : 0));
  const fileName = (n: number) =>
    `svatba_${String(n).padStart(4, "0")}_${secondBody(n) ? "_P5D" : "PPR"}${5000 + n}.jpg`;
  const rows = new Map<number, { id: string }>();
  for (let n = photoCount; n >= 1; n -= 1) {
    const photo = await prisma.photo.create({
      data: {
        galleryId: gallery.id,
        objectKey: `${gallery.storagePrefix}/order-photo-${n}.jpg`,
        fileName: fileName(n),
        mimeType: "image/jpeg",
        width: 1200,
        height: 800,
        placeholder: "#8a6f5a",
        status: "CONFIRMED",
        sizeBytes: 900_000,
        takenAt: takenAt(n),
      },
      // Its file-name key comes from the database trigger, not from here.
      select: { id: true },
    });
    rows.set(n, photo);
  }

  const starts = [
    { title: "Přípravy", slug: "getting-ready", at: 1 },
    { title: "Obřad", slug: "ceremony", at: 30 },
  ];
  for (const { title, slug, at } of starts) {
    await prisma.galleryChapter.create({
      data: {
        galleryId: gallery.id,
        title,
        slug,
        startTakenAt: takenAt(at),
        // Its file-name key comes from the database trigger, like the photo's.
        startPhotoId: rows.get(at)!.id,
      },
    });
  }

  const token = generateShareToken();
  const slug = gallerySlug(gallery.title, null);
  await prisma.shareLink.create({
    data: { galleryId: gallery.id, tokenHash: hashShareToken(token), slug },
  });

  return {
    token,
    slug,
    fileNames: Array.from({ length: photoCount }, (_, i) => fileName(i + 1)),
    chapterAt: 30,
  };
}

/**
 * File-name order with guests woven in by time (docs/PHOTO-ORDER.md): the same
 * export as `makeFileOrderGallery` — a second body an hour early — plus four
 * guests' phone photos, whose names (`IMG_…`) would sort them before every
 * `svatba_…` by name. One is taken while the early body was shooting, one
 * before the first export photo, one after the chapter starts. Woven by the
 * app's own `refreshWovenOrder`, as switching the order in the admin does.
 */
async function makeWovenOrderGallery(ownerId: string) {
  const gallery = await prisma.gallery.create({
    data: {
      ownerId,
      title: "E2E Hosté podle času",
      status: "PUBLISHED",
      publishedAt: new Date(),
      storagePrefix: `galleries/e2e-woven-order-${Date.now()}`,
      photoOrder: "FILE_NAME_GUESTS_BY_TIME",
    },
  });

  const photoCount = 70;
  const secondBody = (n: number) => n % 5 === 0;
  const at = (minute: number, second = 0) => new Date(Date.UTC(2026, 8, 5, 8, minute, second));
  const takenAt = (n: number) => new Date(at(n).getTime() - (secondBody(n) ? 3_600_000 : 0));
  const fileName = (n: number) =>
    `svatba_${String(n).padStart(4, "0")}_${secondBody(n) ? "_P5D" : "PPR"}${5000 + n}.jpg`;
  const photo = (name: string, key: string, taken: Date, source: "OWNER" | "GUEST") =>
    prisma.photo.create({
      data: {
        galleryId: gallery.id,
        objectKey: `${gallery.storagePrefix}/${key}.jpg`,
        fileName: name,
        mimeType: "image/jpeg",
        width: 1200,
        height: 800,
        placeholder: "#8a6f5a",
        status: "CONFIRMED",
        sizeBytes: 900_000,
        takenAt: taken,
        source,
      },
      select: { id: true },
    });

  const rows = new Map<number, { id: string }>();
  for (let n = photoCount; n >= 1; n -= 1) {
    rows.set(n, await photo(fileName(n), `woven-${n}`, takenAt(n), "OWNER"));
  }
  // [file name, taken at, the export photo it follows (0 = opens the gallery)]
  const guests = [
    ["IMG_4801.jpg", at(0, 30), 0],
    ["IMG_4802.jpg", at(10, 30), 10],
    ["IMG_4803.jpg", at(12, 30), 12],
    ["IMG_4804.jpg", at(45, 30), 45],
  ] as const;
  for (const [name, taken] of guests) await photo(name, name, taken, "GUEST");

  await prisma.galleryChapter.create({
    data: {
      galleryId: gallery.id,
      title: "Obřad",
      slug: "ceremony",
      startTakenAt: takenAt(30),
      startPhotoId: rows.get(30)!.id,
    },
  });
  await refreshWovenOrder(gallery.id);

  const token = generateShareToken();
  const slug = gallerySlug(gallery.title, null);
  await prisma.shareLink.create({
    data: { galleryId: gallery.id, tokenHash: hashShareToken(token), slug },
  });

  const expected: string[] = guests.filter(([, , after]) => after === 0).map(([name]) => name);
  for (let n = 1; n <= photoCount; n += 1) {
    expected.push(fileName(n));
    for (const [name, , after] of guests) if (after === n) expected.push(name);
  }
  return { token, slug, fileNames: expected, chapterFrom: expected.indexOf(fileName(30)) };
}

/**
 * A gallery for the highlights (docs/HIGHLIGHTS.md): long enough for the
 * automatic pick, two parts of the day split by a long pause, one photo
 * rated above the rest, one pinned by hand past the first two photo pages —
 * so jumping to it has to fetch metadata the grid does not have yet.
 */
async function makeHighlightsGallery(ownerId: string) {
  const gallery = await prisma.gallery.create({
    data: {
      ownerId,
      title: "E2E Výběr",
      status: "PUBLISHED",
      publishedAt: new Date(),
      storagePrefix: `galleries/e2e-highlights-${Date.now()}`,
      // Off by default; the photographer turns them on (docs/HIGHLIGHTS.md).
      highlightsEnabled: true,
    },
  });

  const photoCount = 130;
  const starred = 30;
  const pinned = 125;
  const excluded = 70;
  for (let i = 0; i < photoCount; i += 1) {
    // Minutes 0–59, then a 40-minute pause, then the rest.
    const minute = i < 60 ? i : i + 40;
    await prisma.photo.create({
      data: {
        galleryId: gallery.id,
        objectKey: `${gallery.storagePrefix}/highlight-photo-${i}.jpg`,
        fileName: `highlight_${i}.jpg`,
        mimeType: "image/jpeg",
        width: 1200,
        height: 800,
        placeholder: "#6b8f71",
        status: "CONFIRMED",
        sizeBytes: 900_000,
        takenAt: new Date(Date.UTC(2026, 7, 22, 10, minute)),
        xmpRating: i === starred ? 5 : 4,
        highlightPin: i === pinned ? true : i === excluded ? false : null,
      },
    });
  }

  const token = generateShareToken();
  const slug = gallerySlug(gallery.title, null);
  await prisma.shareLink.create({
    data: { galleryId: gallery.id, tokenHash: hashShareToken(token), slug },
  });

  return {
    token,
    slug,
    starredFile: `highlight_${starred}.jpg`,
    pinnedFile: `highlight_${pinned}.jpg`,
    excludedFile: `highlight_${excluded}.jpg`,
  };
}

/**
 * A signed-in admin without Google OAuth: a `session` row for the E2E user
 * plus the cookie better-auth would have set for it. The value is signed the
 * way better-call signs it (HMAC-SHA256 with BETTER_AUTH_SECRET, standard
 * base64, then URI-encoded), so `auth.api.getSession` accepts it unchanged —
 * no bypass lives in the app. Deleted with the user's sessions on teardown.
 */
async function makeAdminSession(userId: string) {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET missing — the admin specs need it");
  const token = randomBytes(24).toString("base64url");
  await prisma.session.create({
    data: {
      id: `e2e-${token.slice(0, 12)}`,
      token,
      userId,
      // better-auth's default lifetime: anything shorter is "due for refresh"
      // on the first request, which would try to set a cookie from an RSC.
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });
  const signature = createHmac("sha256", secret).update(token).digest("base64");
  return { name: "better-auth.session_token", value: encodeURIComponent(`${token}.${signature}`) };
}

/** Six photos the admin selection spec may cover, pin and delete — its own
 * gallery, so deleting never shifts another spec's counts. */
async function makeSelectGallery(ownerId: string) {
  const gallery = await prisma.gallery.create({
    data: {
      ownerId,
      title: "E2E Výběr fotek",
      status: "PUBLISHED",
      publishedAt: new Date(),
      storagePrefix: `galleries/e2e-select-${Date.now()}`,
    },
  });
  for (let n = 1; n <= 6; n += 1) {
    await prisma.photo.create({
      data: {
        galleryId: gallery.id,
        objectKey: `${gallery.storagePrefix}/select-${n}.jpg`,
        fileName: `vyber_${n}.jpg`,
        mimeType: "image/jpeg",
        width: 1200,
        height: 800,
        placeholder: "#9a7b62",
        status: "CONFIRMED",
        sizeBytes: 900_000,
        takenAt: new Date(Date.UTC(2026, 8, 5, 10, n)),
      },
    });
  }
  return gallery.id;
}

/**
 * The admin Activity feed's fixtures, in a gallery of their own: eight archive
 * downloads in one sitting (must read as one row; like production, they carry
 * no viewer), and 110 favourites a
 * day apart in 2025 — more than one page, so "Načíst starší" has work to do.
 */
async function makeActivity(ownerId: string) {
  const gallery = await prisma.gallery.create({
    data: {
      ownerId,
      title: "E2E Aktivita",
      status: "PUBLISHED",
      publishedAt: new Date(),
      storagePrefix: `galleries/e2e-activity-${Date.now()}`,
    },
  });
  const downloads = [8, 9, 9, 10, 11, 12, 13, 14].map((minute) => ({
    galleryId: gallery.id,
    type: "DOWNLOAD" as const,
    createdAt: new Date(Date.UTC(2026, 8, 27, 7, minute)),
  }));
  const favorites = Array.from({ length: 110 }, (_, day) => ({
    galleryId: gallery.id,
    type: "FAVORITE" as const,
    createdAt: new Date(Date.UTC(2025, 0, 1 + day, 12)),
  }));
  await prisma.activityEvent.createMany({ data: [...downloads, ...favorites] });
}
