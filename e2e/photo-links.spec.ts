import { test, expect, type Page } from "./fixtures";
import fs from "node:fs";
import path from "node:path";

/**
 * The link-compatibility contract (docs/GALLERY-LOADING.md): every shape of
 * guest link that existed before the photo-link loading work keeps doing
 * exactly what it did, and a photo's link now loads that photo before
 * anything else. Runs on the 130-photo chapters gallery, so a linked photo can
 * sit past the pages a plain visit loads.
 */

const seed = JSON.parse(fs.readFileSync(path.join(__dirname, ".seed.json"), "utf8")) as {
  chapters: { token: string; slug: string; anchors: string[]; lastChapterAt: number };
  soloWeddingToken: string;
  soloWeddingSlug: string;
};
const { token, slug, anchors, lastChapterAt } = seed.chapters;
const gallery = `/g/${token}/${slug}`;
const PHOTOS_API = /\/api\/g\/[^/]+\/photos/;

interface SeedPhoto {
  id: string;
  fileName: string;
  objectKey: string;
}

async function allPhotos(page: Page): Promise<SeedPhoto[]> {
  const photos: SeedPhoto[] = [];
  let cursor: string | null = null;
  do {
    const response = await page.request.get(
      `/api/g/${token}/photos${cursor ? `?cursor=${cursor}` : ""}`,
    );
    const body = (await response.json()) as { items: SeedPhoto[]; nextCursor: string | null };
    photos.push(...body.items);
    cursor = body.nextCursor;
  } while (cursor);
  return photos;
}

/** The seeded file behind an image request, or null for anything else. */
function photoFile(url: string): string | null {
  return /chapter-photo-\d+\.jpg/.exec(decodeURIComponent(url))?.[0] ?? null;
}

/**
 * The address as the page sees it. `page.url()` trails a quick run of
 * `replaceState` calls in WebKit, which the lightbox makes on Back.
 */
const search = (page: Page) => page.evaluate(() => location.search);

/**
 * The lightbox is open *and* its history entry exists. The entry is pushed by
 * an effect a moment after the dialog renders; a Back sent inside that moment
 * leaves the page, for a test as it would for a person (who cannot be that
 * fast).
 */
async function opened(page: Page) {
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => new URLSearchParams(location.search).has("foto")))
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() => (history.state as { galleryLightbox?: boolean })?.galleryLightbox),
    )
    .toBe(true);
}

const fileOf = (photo: SeedPhoto) => photoFile(photo.objectKey)!;
const tileOf = (page: Page, photo: SeedPhoto) =>
  page.locator(`main button[aria-label^="Otevřít"][aria-label*="${photo.fileName}"]`);

let photos: SeedPhoto[];
let far: SeedPhoto;
let near: SeedPhoto;

test.beforeEach(async ({ page }) => {
  photos ??= await allPhotos(page);
  // Past the second page — a plain visit loads only the first.
  far = photos[lastChapterAt + 1]!;
  near = photos[5]!;
});

test.describe("photo links", () => {
  test("a photo past the first pages opens before anything else loads", async ({ page }) => {
    // Every photo image request, in the order sent, and when it settled.
    let clock = 0;
    const log: { url: string; file: string; start: number; end?: number }[] = [];
    const pages: string[] = [];
    page.on("request", (request) => {
      if (PHOTOS_API.test(request.url())) pages.push(request.url());
      const file = request.resourceType() === "image" ? photoFile(request.url()) : null;
      if (file) log.push({ url: request.url(), file, start: ++clock });
    });
    const settle = (request: { url: () => string }) => {
      const entry = log.find((e) => e.url === request.url() && e.end === undefined);
      if (entry) entry.end = ++clock;
    };
    page.on("requestfinished", settle);
    page.on("requestfailed", settle);

    await page.goto(`${gallery}?foto=${far.id}`);
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // While it is open the address names it (and, scrolled behind the dialog,
    // the chapter it sits in — as before).
    await expect(page).toHaveURL(new RegExp(`\\?foto=${far.id}(#|$)`));

    // The pages up to the photo came with the page: none was fetched.
    expect(pages).toEqual([]);

    // The photo's full size (asked for at 100vw, so 1080 px or wider) is
    // requested, and no other photo is asked for before that request is done.
    // (Done, not drawn: this seed's rows have no files behind them.)
    const width = (url: string) =>
      Number(/fit:(\d+)|width=(\d+)/.exec(url)?.slice(1).find(Boolean));
    const fullDone = () =>
      log.find((e) => e.file === fileOf(far) && width(e.url) >= 1080 && e.end !== undefined)?.end;
    await expect.poll(fullDone).toBeDefined();
    const others = log.filter((e) => e.file !== fileOf(far));
    expect(others.filter((e) => e.start < fullDone()!)).toEqual([]);

    // Back is the gallery, on the photo's own tile — whose image now loads.
    await page.goBack();
    await expect(dialog).not.toBeVisible();
    await expect(page).not.toHaveURL(/foto=/);
    await expect(tileOf(page, far)).toBeInViewport();
    await expect.poll(() => log.filter((e) => e.file !== fileOf(far)).length).toBeGreaterThan(0);
  });

  test("with another chapter's anchor, the photo wins and Back lands on it", async ({ page }) => {
    await page.goto(`${gallery}?foto=${far.id}#${anchors[1]}`);
    await opened(page);
    await expect(page).toHaveURL(new RegExp(`foto=${far.id}`));
    await page.goBack();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(tileOf(page, far)).toBeInViewport();
    await expect(page).not.toHaveURL(/foto=/);
  });

  test("with an anchor that names no chapter, the dead anchor does not survive", async ({
    page,
  }) => {
    await page.goto(`${gallery}?foto=${far.id}#neexistuje`);
    await opened(page);
    await page.goBack();
    await expect(tileOf(page, far)).toBeInViewport();
    await expect.poll(() => page.evaluate(() => location.hash)).not.toBe("#neexistuje");
  });

  test("a repeated parameter opens the first photo and keeps one", async ({ page }) => {
    await page.goto(`${gallery}?foto=${near.id}&foto=${far.id}`);
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect
      .poll(async () => new URLSearchParams(await search(page)).getAll("foto"))
      .toEqual([near.id]);
  });

  test("other parameters stay in the address, also after Back", async ({ page }) => {
    await page.goto(`${gallery}?fbclid=abc&foto=${far.id}`);
    await opened(page);
    await page.goBack();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect.poll(() => search(page)).toBe("?fbclid=abc");
  });

  test("the slug never matters", async ({ page }) => {
    await page.goto(`/g/${token}?foto=${far.id}`);
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.goto(`/g/${token}/stary-nazev/navic?foto=${near.id}`);
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`foto=${near.id}`));
  });

  test("a photo that is not here opens nothing, and the parameter goes", async ({ page }) => {
    await page.goto(`${gallery}?foto=neexistujici123`);
    await expect(tileOf(page, photos[0]!)).toBeVisible();
    await expect.poll(() => search(page)).toBe("");
    await expect(page.getByRole("dialog")).not.toBeVisible();
  });

  test("a malformed parameter is left as it is", async ({ page }) => {
    await page.goto(`${gallery}?foto=a.b`);
    await expect(tileOf(page, photos[0]!)).toBeVisible();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    expect(await search(page)).toBe("?foto=a.b");
  });

  test("a wedding link without its slug keeps the photo through the redirect", async ({ page }) => {
    const wedding = `/s/${seed.soloWeddingToken}/${seed.soloWeddingSlug}`;
    await page.goto(wedding);
    await page
      .getByRole("button", { name: /^Otevřít/ })
      .first()
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    const id = new URLSearchParams(await search(page)).get("foto");
    expect(id).toBeTruthy();

    await page.goto(`/s/${seed.soloWeddingToken}?foto=${id}`);
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page).toHaveURL(`${wedding}?foto=${id}`);
  });
});
