import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";

/**
 * The photographer's admin, signed in through the session the seed writes
 * (e2e/seed.ts `makeAdminSession`) — Google OAuth never runs in E2E.
 */
const seed = JSON.parse(fs.readFileSync(path.join(__dirname, ".seed.json"), "utf8")) as {
  adminCookie: { name: string; value: string };
  galleryId: string;
  photoCount: number;
  selectGalleryIds: Record<string, string>;
};

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ ...seed.adminCookie, url: baseURL! }]);
});

/**
 * Scrolls every lazy image into range, then lists those showing as broken
 * because their object is missing — the production case (a thumbnail whose
 * PUT failed). Images that exist but will not decode are left out: the guest
 * upload specs running alongside store tiny fixture JPEGs WebKit refuses.
 */
async function missingImages(page: Page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += window.innerHeight) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  });
  await page.waitForLoadState("networkidle");
  const broken = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLImageElement>("main img")]
      .filter((img) => img.complete && img.naturalWidth === 0)
      .map((img) => img.currentSrc),
  );
  const statuses = await Promise.all(
    broken.map((src) => page.request.get(src).then((r) => r.status())),
  );
  return broken.filter((_, i) => statuses[i]! >= 400);
}

test("overview: newest wedding day first, and no broken-image icons", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Přehled" })).toBeVisible();

  // Seeded photos have no bytes behind them, so every cover fails — thumbnail
  // and original alike. The tile must fall back to its colour, not an icon.
  // Polled: between an image's error event and React swapping it out, the
  // broken one is briefly still in the DOM.
  await expect.poll(() => missingImages(page)).toEqual([]);

  // Weddings and galleries are two lists; each is sorted on its own.
  const lists = page.locator("main ul").filter({ has: page.locator("a[href^='/admin/']") });
  expect(await lists.count()).toBe(2);
  for (const list of await lists.all()) {
    const dates = (await list.locator(":scope > li").allInnerTexts())
      .map((row) => row.match(/(\d{1,2})\.\s(\d{1,2})\.\s(\d{4})/))
      .filter((m) => m !== null)
      .map(([, d, mo, y]) => Date.UTC(+y!, +mo! - 1, +d!));
    expect(dates.length).toBeGreaterThan(1);
    expect(dates).toEqual(dates.toSorted((a, b) => b - a));
  }
});

test("gallery page: status in Czech, never the raw enum", async ({ page }) => {
  await page.goto(`/admin/g/${seed.galleryId}`);
  await expect(page.getByText(`Publikováno · ${seed.photoCount} fotek`)).toBeVisible();
  await expect(page.getByText("PUBLISHED")).toHaveCount(0);
});

test.describe("photo selection", () => {
  // One gallery, changed as it goes — the steps depend on each other.
  test.describe.configure({ mode: "serial" });
  const galleryUrl = () => `/admin/g/${seed.selectGalleryIds[test.info().project.name]}`;

  test("a tap selects a photo, and the bar sets it as the cover", async ({ page }) => {
    await page.goto(galleryUrl());
    const bar = page.getByRole("toolbar", { name: "Akce s vybranými fotkami" });
    await expect(bar).toBeHidden();

    await page.getByRole("checkbox", { name: "Vybrat vyber_3.jpg" }).check();
    await expect(bar).toContainText("Vybráno: 1 fotka");
    await bar.getByRole("button", { name: "Nastavit jako titulní" }).click();

    // The action refreshes the page and clears the selection.
    await expect(bar).toBeHidden();
    const tile = page.locator("label", {
      has: page.getByRole("checkbox", { name: "Vybrat vyber_3.jpg" }),
    });
    await expect(tile.getByText("Titulní")).toBeVisible();
  });

  test("shift-click selects a range, Escape clears it", async ({ page }) => {
    await page.goto(galleryUrl());
    const boxes = page.getByRole("checkbox", { name: /^Vybrat vyber_/ });
    await boxes.nth(0).click();
    // On the tile, not the box — the label path, which Firefox does not forward.
    await page
      .locator("label")
      .filter({ has: page.locator(`input[name="photo"]`) })
      .nth(3)
      .click({ modifiers: ["Shift"] });
    const bar = page.getByRole("toolbar", { name: "Akce s vybranými fotkami" });
    await expect(bar).toContainText("Vybráno: 4 fotky");
    // Only a single photo can be the cover.
    await expect(bar.getByRole("button", { name: "Nastavit jako titulní" })).toHaveCount(0);

    await page.keyboard.press("Escape");
    await expect(bar).toBeHidden();
    await expect(boxes.nth(0)).not.toBeChecked();
  });

  test("deletes the selected photos after a confirm", async ({ page }) => {
    await page.goto(galleryUrl());
    const boxes = page.getByRole("checkbox", { name: /^Vybrat vyber_/ });
    await expect(boxes).toHaveCount(6);
    await page.getByRole("checkbox", { name: "Vybrat vyber_5.jpg" }).check();
    await page.getByRole("checkbox", { name: "Vybrat vyber_6.jpg" }).check();

    page.once("dialog", (dialog) => {
      expect(dialog.message()).toBe("Smazat 2 fotky? Tohle už nejde vzít zpět.");
      void dialog.accept();
    });
    await page.getByRole("toolbar").getByRole("button", { name: "Smazat" }).click();

    await expect(boxes).toHaveCount(4);
    await expect(page.getByRole("checkbox", { name: "Vybrat vyber_5.jpg" })).toHaveCount(0);
  });
});
