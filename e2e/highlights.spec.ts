import { test, expect } from "./fixtures";
import fs from "node:fs";
import path from "node:path";

/**
 * The highlights above the grid (docs/HIGHLIGHTS.md). The pick itself is
 * unit-tested in src/lib/gallery-highlights.test.ts; what needs a browser is
 * that the strip shows the pick, and that a tile takes the viewer to the
 * photo's own place in the grid — even one past the pages loaded so far.
 */

const seed = JSON.parse(fs.readFileSync(path.join(__dirname, ".seed.json"), "utf8")) as {
  highlights: {
    token: string;
    slug: string;
    starredFile: string;
    pinnedFile: string;
    excludedFile: string;
  };
};
const { token, slug, starredFile, pinnedFile, excludedFile } = seed.highlights;

const STRIP = /To nejlepší z celého dne|Highlights of the day|Les plus beaux moments/;
const tileName = (file: string) =>
  new RegExp(`(Ukázat v galerii|Show in the gallery|Voir dans la galerie) ?: ${file}$`);
const gridName = (file: string) => new RegExp(`^(Otevřít|Open|Ouvrir) ${file}$`);

test.describe("gallery highlights", () => {
  test("shows six photos: the pinned one, the one rated above the rest, never the excluded one", async ({
    page,
  }) => {
    await page.goto(`/g/${token}/${slug}`);
    const strip = page.getByRole("region", { name: STRIP });
    await expect(strip.getByRole("button")).toHaveCount(6);
    await expect(strip.getByRole("button", { name: tileName(pinnedFile) })).toBeVisible();
    await expect(strip.getByRole("button", { name: tileName(starredFile) })).toBeAttached();
    await expect(strip.getByRole("button", { name: tileName(excludedFile) })).toHaveCount(0);
  });

  test("a tile takes the viewer to the photo's place in the grid", async ({ page }) => {
    await page.goto(`/g/${token}/${slug}`);
    const strip = page.getByRole("region", { name: STRIP });
    // The pinned photo is the last of 130 — past the first two 60-photo pages.
    await strip.getByRole("button", { name: tileName(pinnedFile) }).click();

    const tile = page.getByRole("button", { name: gridName(pinnedFile) });
    await expect(tile).toBeInViewport();
    await expect(tile).toBeFocused();
  });

  test("the wheel over the strip scrolls the page, not the strip", async ({ page, isMobile }) => {
    test.skip(isMobile, "no mouse wheel on a phone");
    await page.goto(`/g/${token}/${slug}`);
    const strip = page.getByRole("region", { name: STRIP });
    await strip.getByRole("button").first().hover();
    await page.mouse.wheel(0, 400);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
  });
});
