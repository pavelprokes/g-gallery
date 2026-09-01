import { test, expect } from "./fixtures";
import fs from "node:fs";
import path from "node:path";

/**
 * The photographer's credit tile in the grid (docs/PROMO-CARDS.md).
 *
 * The invariant worth a browser is not "the card renders" — a unit test covers
 * the layout maths — it is that the card is *inert everywhere else*: it must
 * not become a photo the lightbox can open, an arrow-key landing spot, a
 * selectable item, or a row that shifts the indices of the photos around it.
 *
 * The seed places it at slot 5 in the same gallery `gallery-view.spec.ts`
 * asserts on, so that file's own expectations (tile count, "1 / N", roving
 * tabindex, shift-click ranges) are the other half of this coverage.
 */

const seed = JSON.parse(fs.readFileSync(path.join(__dirname, ".seed.json"), "utf8")) as {
  token: string;
  slug: string;
  photoCount: number;
  promoSlot: number;
  promoHeadline: string;
  promoCtaUrl: string;
};

const promo = (page: import("@playwright/test").Page) => page.locator("[data-promo-tile]");

test.describe("promo tile in the gallery grid", () => {
  test("renders as a tile with a link to the photographer's site", async ({ page }) => {
    await page.goto(`/g/${seed.token}/${seed.slug}`);

    const card = promo(page);
    await expect(card).toHaveCount(1);
    await expect(card.getByText(seed.promoHeadline)).toBeVisible();

    const link = card.getByRole("link");
    await expect(link).toHaveAttribute("href", seed.promoCtaUrl);
    await expect(link).toHaveAttribute("target", "_blank");
    // `noreferrer` keeps the share token in the URL from reaching the
    // photographer's own analytics as a Referer (CLAUDE.md invariant #7).
    await expect(link).toHaveAttribute("rel", /noreferrer/);

    // Laid out as a landscape frame, like the photo it stands in for.
    const box = await card.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width / box!.height).toBeCloseTo(1.5, 1);
  });

  test("sits at its slot without displacing a photo out of the gallery", async ({ page }) => {
    await page.goto(`/g/${seed.token}/${seed.slug}`);
    const grid = page.getByRole("list", { name: "Fotky v galerii" });
    const tiles = grid.locator('button[aria-label^="Otevřít"]');

    // Every photo is still there: the card is added to the layout, never
    // substituted for a photo.
    await expect.poll(async () => tiles.count()).toBe(seed.photoCount);

    // And it really is between them, not appended after the last row.
    const promoBox = (await promo(page).boundingBox())!;
    const lastBox = (await tiles.last().boundingBox())!;
    expect(promoBox.y).toBeLessThan(lastBox.y);
  });

  test("is not reachable by the lightbox or by arrow keys", async ({ page }) => {
    await page.goto(`/g/${seed.token}/${seed.slug}`);
    const grid = page.getByRole("list", { name: "Fotky v galerii" });
    const tiles = grid.locator('button[aria-label^="Otevřít"]');

    await tiles.first().focus();

    // Step across every photo in the gallery. The card occupies a column in
    // one of these rows; focus must never land on it, and the count the
    // lightbox reports must stay the photo count throughout.
    for (let i = 1; i < seed.photoCount; i += 1) {
      await page.keyboard.press("ArrowRight");
      await expect(promo(page).getByRole("link")).not.toBeFocused();
    }
    await expect(tiles.nth(seed.photoCount - 1)).toBeFocused();

    // Opening the photo at the card's slot shows a photo, and the total never
    // counts the card.
    await tiles.nth(seed.promoSlot - 1).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByText(`${seed.promoSlot} / ${seed.photoCount}`)).toBeVisible();
  });

  test("cannot be selected or downloaded", async ({ page }) => {
    await page.goto(`/g/${seed.token}/${seed.slug}`);

    // One checkbox per photo, none for the card.
    await expect.poll(async () => page.getByRole("checkbox").count()).toBe(seed.photoCount);
    await expect(promo(page).getByRole("checkbox")).toHaveCount(0);

    // "Select all" is the whole gallery — and the whole gallery is photos.
    await page.getByRole("checkbox").first().click();
    await page
      .locator(".sticky")
      .getByRole("button", { name: /Vybrat vše/ })
      .click();
    await expect(
      page.locator(".sticky").getByText(`${seed.photoCount} vybraných`, { exact: true }),
    ).toBeVisible();
  });
});
