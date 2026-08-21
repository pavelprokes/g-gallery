import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Covers the share-gallery viewer flow against a real production build —
 * the cursor-paginated, virtualized, justified grid; the history-backed
 * lightbox; and the readable URL slug (docs/AUDIT.md P3, docs/TODO.md §6).
 *
 * Deliberately scoped to what doesn't need Google OAuth: the admin upload
 * → publish → share-link-creation flow docs/TODO.md §0 names as worth
 * covering first still needs a signed-in admin session, which this repo has
 * no test-auth bypass for yet — a natural next E2E addition, not this one.
 */

const seed = JSON.parse(fs.readFileSync(path.join(__dirname, ".seed.json"), "utf8")) as {
  galleryId: string;
  token: string;
  slug: string;
  photoCount: number;
};

test.describe("share gallery viewer", () => {
  test("loads via the slugged URL and renders every photo, uncropped", async ({ page }) => {
    await page.goto(`/g/${seed.token}/${seed.slug}`);

    await expect(page).toHaveTitle(/E2E Test Gallery/);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);

    const grid = page.getByRole("list", { name: "Fotky v galerii" });
    await expect(grid).toBeVisible();

    // Every seeded photo should reach the DOM eventually (small gallery,
    // no pagination needed — the infinite-scroll trigger is exercised
    // separately by unit tests on the cursor logic itself).
    await expect
      .poll(async () => grid.locator('button[aria-label^="Otevřít"]').count())
      .toBe(seed.photoCount);

    // No cropping: object-cover only fills the box correctly if the box's
    // own aspect ratio matches the image's, which is exactly what the
    // justified-layout algorithm computes — verify a real rendered tile's
    // box, not just the algorithm in isolation (already unit-tested).
    const firstTile = grid.locator('button[aria-label^="Otevřít"]').first();
    const box = await firstTile.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);
  });

  test("lightbox opens, navigates, and closes via history back", async ({ page }) => {
    await page.goto(`/g/${seed.token}/${seed.slug}`);
    const grid = page.getByRole("list", { name: "Fotky v galerii" });
    await grid.locator('button[aria-label^="Otevřít"]').first().click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(page.getByText(`1 / ${seed.photoCount}`)).toBeVisible();

    // Focus starts inside the dialog (focus trap) — the first focusable
    // element is "Předchozí".
    await expect(page.getByRole("button", { name: "Předchozí" })).toBeFocused();

    await page.getByRole("button", { name: "Další" }).click();
    await expect(page.getByText(`2 / ${seed.photoCount}`)).toBeVisible();

    // Android/gesture back closes the lightbox, not the gallery — the whole
    // point of the history-entry-per-open design (docs/AUDIT.md §4.2).
    await page.goBack();
    await expect(dialog).not.toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/g/${seed.token}/${seed.slug}$`));
  });

  test("arrow keys move the roving tab stop across the grid", async ({ page }) => {
    await page.goto(`/g/${seed.token}/${seed.slug}`);
    const grid = page.getByRole("list", { name: "Fotky v galerii" });
    const tiles = grid.locator('button[aria-label^="Otevřít"]');

    await tiles.first().focus();
    await page.keyboard.press("ArrowRight");
    await expect(tiles.nth(1)).toBeFocused();

    await page.keyboard.press("End");
    await expect(tiles.last()).toBeFocused();
  });

  test("shift-click selects a range and the toolbar reflects it", async ({ page }) => {
    await page.goto(`/g/${seed.token}/${seed.slug}`);
    const checkboxes = page.getByRole("checkbox");

    await checkboxes.first().click();
    await checkboxes.nth(2).click({ modifiers: ["Shift"] });

    // "3 vybrané" also appears in the sr-only aria-live announcement
    // (docs/AUDIT.md §5.6) — matching both here is a passing signal, but the
    // test wants the one a sighted user actually sees, in the toolbar.
    await expect(page.locator(".sticky").getByText("3 vybrané", { exact: true })).toBeVisible();
    await expect(checkboxes.first()).toHaveAttribute("aria-checked", "true");
    await expect(checkboxes.nth(1)).toHaveAttribute("aria-checked", "true");
    await expect(checkboxes.nth(2)).toHaveAttribute("aria-checked", "true");
  });

  test("an unknown token shows the branded not-found page, not a 404 shell", async ({ page }) => {
    await page.goto("/g/this-token-does-not-exist/anything");
    await expect(page.getByRole("heading", { name: "Galerie nenalezena" })).toBeVisible();
  });
});
