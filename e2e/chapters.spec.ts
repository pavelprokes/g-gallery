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
    await page.goto(`/g/${token}/${slug}#${anchors.at(-1)}`);
    await expect(page.getByRole("heading", { level: 2, name: titles.at(-1) })).toBeInViewport();
    await expect(page).toHaveURL(new RegExp(`#${anchors.at(-1)}$`));
  });

  for (const [what, hash] of [
    ["an unknown chapter", "#neexistuje"],
    ["a chapter left with no photos", "#prazdna"],
  ] as const) {
    test(`a link to ${what} opens the start of the gallery`, async ({ page }) => {
      await page.goto(`/g/${token}/${slug}${hash}`);
      await expect(page.getByRole("heading", { level: 2, name: titles[0] })).toBeInViewport();
      await expect.poll(() => new URL(page.url()).hash).toBe("");
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
    });
  }
});
