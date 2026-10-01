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
      .map((row) => row.match(/(\d{1,2})\. (\d{1,2})\. (\d{4})/))
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
