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
  chapters: { token: string; slug: string; titles: string[]; lastChapterAt: number };
};
const { token, slug, titles, lastChapterAt } = seed.chapters;

test.describe("gallery chapters", () => {
  test("lists every chapter with photos, and none without", async ({ page }) => {
    await page.goto(`/g/${token}/${slug}`);

    const bar = page.getByRole("navigation", { name: /Kapitoly|Chapters|Chapitres/ });
    await expect(bar.getByRole("button")).toHaveText(titles);
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
    await bar.getByRole("button", { name: last }).click();

    const heading = page.getByRole("heading", { level: 2, name: last });
    await expect(heading).toBeInViewport();
    await expect(heading).toBeFocused();
    await expect(bar.getByRole("button", { name: last })).toHaveAttribute(
      "aria-current",
      "location",
    );

    // The observer does see image requests — the target's own rows loaded…
    await expect.poll(() => [...photoIndices].some((i) => i >= lastChapterAt)).toBe(true);
    // …but nothing from the middle of the gallery was fetched on the way down.
    const skipped = [...photoIndices].filter((i) => i > 40 && i < lastChapterAt - 20);
    expect(skipped).toEqual([]);
  });

  test("the chapter bar follows the scroll", async ({ page }) => {
    await page.goto(`/g/${token}/${slug}`);
    const bar = page.getByRole("navigation", { name: /Kapitoly|Chapters|Chapitres/ });
    await expect(bar.getByRole("button", { name: titles[0] })).toHaveAttribute(
      "aria-current",
      "location",
    );

    await bar.getByRole("button", { name: titles[1] }).click();
    await expect(bar.getByRole("button", { name: titles[1] })).toHaveAttribute(
      "aria-current",
      "location",
    );
    await expect(bar.getByRole("button", { name: titles[0] })).not.toHaveAttribute("aria-current");
  });
});
