import fs from "node:fs";
import path from "node:path";
import { test, expect } from "./fixtures";

/**
 * The admin grid's filters (docs/ADMIN-FILTERS.md): every choice is in the
 * URL, so it survives a reload and the browser's Back undoes it.
 */
const seed = JSON.parse(fs.readFileSync(path.join(__dirname, ".seed.json"), "utf8")) as {
  adminCookie: { name: string; value: string };
  filterGalleryId: string;
};

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ ...seed.adminCookie, url: baseURL! }]);
});

const tiles = (page: import("@playwright/test").Page) =>
  page.getByRole("img", { name: /^svatba_000\d_PPR100\d\.jpg$/ });

test("filters narrow the grid, live in the URL, and Back undoes them", async ({ page }) => {
  await page.goto(`/admin/g/${seed.filterGalleryId}`);
  const filters = page.getByRole("group", { name: "Filtry fotek" });
  await expect(tiles(page)).toHaveCount(4);

  await filters.getByRole("link", { name: /Srdíčka/ }).click();
  await expect(page).toHaveURL(/[?&]f=favorites/);
  await expect(tiles(page)).toHaveCount(1);
  await expect(page.getByRole("img", { name: "svatba_0001_PPR1001.jpg" })).toHaveCount(1);

  await page.goBack();
  await expect(tiles(page)).toHaveCount(4);

  await filters.getByRole("link", { name: /K tisku/ }).click();
  await expect(page.getByRole("img", { name: "svatba_0002_PPR1002.jpg" })).toHaveCount(1);
  await expect(tiles(page)).toHaveCount(1);
  // The print summary still comes with the print filter.
  await expect(page.getByText(/Fotky k tisku:/)).toBeVisible();

  await page.goto(`/admin/g/${seed.filterGalleryId}`);
  await filters.getByLabel("Označená osoba").selectOption({ label: "Sofie" });
  await expect(page).toHaveURL(/[?&]person=/);
  await expect(tiles(page)).toHaveCount(1);
  await expect(page.getByRole("img", { name: "svatba_0003_PPR1003.jpg" })).toHaveCount(1);

  await page.goto(`/admin/g/${seed.filterGalleryId}`);
  await filters.getByRole("searchbox", { name: "Hledat podle názvu souboru" }).fill("PPR1004");
  await filters.getByRole("searchbox", { name: "Hledat podle názvu souboru" }).press("Enter");
  await expect(page).toHaveURL(/[?&]q=PPR1004/);
  await expect(tiles(page)).toHaveCount(1);
  await page.reload();
  await expect(tiles(page)).toHaveCount(1);
  const reset = page.getByRole("link", { name: "Zrušit filtry" }).first();
  // Mobile WebKit taps mid-scroll when the click scrolls the link in itself.
  await reset.scrollIntoViewIfNeeded();
  await reset.click();
  await expect(tiles(page)).toHaveCount(4);
});

test("most viewed puts the most viewed photo first", async ({ page }) => {
  await page.goto(`/admin/g/${seed.filterGalleryId}?sort=views`);
  await expect(tiles(page).first()).toHaveAccessibleName("svatba_0003_PPR1003.jpg");
});
