import { test, expect } from "./fixtures";
import fs from "node:fs";
import path from "node:path";

/**
 * Chapters in the guest's grid (docs/CHAPTERS.md).
 *
 * The invariant worth a browser is the jump: tapping a chapter far down a long
 * gallery lands on its header *without downloading the photos in between* —
 * which only holds if the jump is instant and the grid stays virtualized. The
 * placement rules themselves are unit-tested in src/lib/gallery-grid.test.ts.
 */

const seed = JSON.parse(fs.readFileSync(path.join(__dirname, ".seed.json"), "utf8")) as {
  chapters: {
    token: string;
    slug: string;
    titles: string[];
    anchors: string[];
    lastChapterAt: number;
  };
};
const { token, slug, titles, anchors, lastChapterAt } = seed.chapters;

test.describe("gallery chapters", () => {
  test("lists every chapter with photos, and none without", async ({ page }) => {
    await page.goto(`/g/${token}/${slug}`);

    const bar = page.getByRole("navigation", { name: /Kapitoly|Chapters|Chapitres/ });
    await expect(bar.getByRole("link")).toHaveText(titles);
    // The first chapter starts at the first photo, so the grid opens on it.
    await expect(page.getByRole("heading", { level: 2, name: titles[0] })).toBeVisible();
  });

  test("jumps to a chapter past the loaded pages without loading what it skips", async ({
    page,
  }) => {
    const photoIndices = new Set<number>();
    page.on("request", (request) => {
      const match = /chapter-photo-(\d+)\.jpg/.exec(decodeURIComponent(request.url()));
      if (match) photoIndices.add(Number(match[1]));
    });

    await page.goto(`/g/${token}/${slug}`);
    const bar = page.getByRole("navigation", { name: /Kapitoly|Chapters|Chapitres/ });
    const last = titles.at(-1)!;
    await bar.getByRole("link", { name: last }).click();

    const heading = page.getByRole("heading", { level: 2, name: last });
    await expect(heading).toBeInViewport();
    await expect(heading).toBeFocused();
    await expect(bar.getByRole("link", { name: last })).toHaveAttribute("aria-current", "location");

    // The observer does see image requests — the target's own rows loaded…
    await expect.poll(() => [...photoIndices].some((i) => i >= lastChapterAt)).toBe(true);
    // …but nothing from the middle of the gallery was fetched on the way down.
    const skipped = [...photoIndices].filter((i) => i > 40 && i < lastChapterAt - 20);
    expect(skipped).toEqual([]);
  });

  test("the chapter bar follows the scroll", async ({ page }) => {
    await page.goto(`/g/${token}/${slug}`);
    const bar = page.getByRole("navigation", { name: /Kapitoly|Chapters|Chapitres/ });
    await expect(bar.getByRole("link", { name: titles[0] })).toHaveAttribute(
      "aria-current",
      "location",
    );

    await bar.getByRole("link", { name: titles[1] }).click();
    await expect(bar.getByRole("link", { name: titles[1] })).toHaveAttribute(
      "aria-current",
      "location",
    );
    await expect(bar.getByRole("link", { name: titles[0] })).not.toHaveAttribute("aria-current");
  });

  test("the URL follows the chapter, so it can be sent", async ({ page }) => {
    await page.goto(`/g/${token}/${slug}`);
    // Opened at the top: the URL stays as it was opened.
    expect(new URL(page.url()).hash).toBe("");

    const bar = page.getByRole("navigation", { name: /Kapitoly|Chapters|Chapitres/ });
    await expect(bar.getByRole("link", { name: titles[1] })).toHaveAttribute(
      "href",
      `#${anchors[1]}`,
    );
    await bar.getByRole("link", { name: titles[1] }).click();
    await expect(page).toHaveURL(new RegExp(`#${anchors[1]}$`));
  });

  test("a link with a chapter opens the gallery on it", async ({ page }) => {
    const pages: string[] = [];
    const photoIndices = new Set<number>();
    page.on("request", (request) => {
      if (/\/api\/g\/[^/]+\/photos/.test(request.url())) pages.push(request.url());
      const match = /chapter-photo-(\d+)\.jpg/.exec(decodeURIComponent(request.url()));
      if (match) photoIndices.add(Number(match[1]));
    });
    await page.goto(`/g/${token}/${slug}#${anchors.at(-1)}`);
    await expect(page.getByRole("heading", { level: 2, name: titles.at(-1) })).toBeInViewport();
    // Its start is two pages past the first: both came in one request
    // (docs/GALLERY-LOADING.md). Counted up to the landing — the grid may ask
    // for more on its own after that.
    const jump = [...pages];
    await expect(page).toHaveURL(new RegExp(`#${anchors.at(-1)}$`));
    expect(jump).toHaveLength(1);
    expect(new URL(jump[0]!).searchParams.has("throughKey")).toBe(true);
    // The rows the grid first laid out were about to be left: nothing far from
    // the chapter was fetched — only its own rows and the overscan around them
    // (docs/GALLERY-LOADING.md).
    await expect.poll(() => [...photoIndices].some((i) => i >= lastChapterAt)).toBe(true);
    expect([...photoIndices].filter((i) => i < lastChapterAt - 40)).toEqual([]);
  });

  test("a link with a chapter fetches the chapter first, not the row left behind its bar", async ({
    page,
  }) => {
    // docs/GALLERY-LOADING.md: the row before the chapter lands under the bar.
    const asked: number[] = [];
    await page.route(/chapter-photo-\d+\.jpg/, (route) => {
      asked.push(Number(/chapter-photo-(\d+)\.jpg/.exec(route.request().url())![1]));
    });
    // The images never arrive, so the page may never fire `load`.
    await page.goto(`/g/${token}/${slug}#${anchors.at(-1)}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 2, name: titles.at(-1) })).toBeInViewport();
    await expect.poll(() => asked.length).toBeGreaterThan(0);
    expect(asked.filter((photo) => photo < lastChapterAt)).toEqual([]);
  });

  for (const [what, hash] of [
    ["an unknown chapter", "#neexistuje"],
    ["a chapter left with no photos", "#prazdna"],
    ["a malformed anchor", "#100%"],
  ] as const) {
    test(`a link to ${what} opens the start of the gallery`, async ({ page }) => {
      await page.goto(`/g/${token}/${slug}${hash}`);
      await expect(page.getByRole("heading", { level: 2, name: titles[0] })).toBeInViewport();
      await expect.poll(() => new URL(page.url()).hash).toBe("");
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
    });
  }

  test("a photo link with a chapter anchor opens the photo, asking for no page", async ({
    page,
  }) => {
    // Two loops could pull pages here — the photo's and the chapter's — and
    // each used to abort the other's request and ask for the same page again.
    // The pages up to the photo now come with the page itself
    // (docs/GALLERY-LOADING.md).
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const response = await page.request.get(
        `/api/g/${token}/photos${cursor ? `?cursor=${cursor}` : ""}`,
      );
      const body = (await response.json()) as {
        items: { id: string }[];
        nextCursor: string | null;
      };
      ids.push(...body.items.map((item) => item.id));
      cursor = body.nextCursor;
    } while (cursor);
    const target = ids[lastChapterAt + 1]!;

    const pages: string[] = [];
    page.on("request", (request) => {
      if (/\/api\/g\/[^/]+\/photos/.test(request.url())) pages.push(request.url());
    });
    await page.goto(`/g/${token}/${slug}?foto=${target}#${anchors.at(-1)}`);

    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`foto=${target}`));
    expect(pages).toEqual([]);

    // The lightbox pushes its history entry a moment after the dialog renders;
    // a Back sent before that leaves the page (Firefox was fast enough to).
    await expect
      .poll(() =>
        page.evaluate(() => (history.state as { galleryLightbox?: boolean })?.galleryLightbox),
      )
      .toBe(true);
    await page.goBack();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(page).not.toHaveURL(/foto=/);
  });
});
