import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * The wedding page (docs/GUEST-GALLERIES.md §2 and §4): one unlisted address
 * that lists several separate galleries and grows over time.
 *
 * The behaviours worth guarding here are the ones that are silent when wrong —
 * a hidden gallery showing up, the address bar being replaced with a URL that
 * can never grow a second card, or a stale card handing out the event token.
 */

const seed = JSON.parse(fs.readFileSync(path.join(__dirname, ".seed.json"), "utf8")) as {
  weddingToken: string;
  weddingSlug: string;
  soloWeddingToken: string;
  soloWeddingSlug: string;
};

test.describe("wedding page", () => {
  test("canonicalises to the slugged URL and lists only what is listed", async ({ page }) => {
    await page.goto(`/s/${seed.weddingToken}`);

    // No slug given: redirected to the canonical form, so the gallery key can
    // never be mistaken for the cosmetic slug.
    await expect(page).toHaveURL(`/s/${seed.weddingToken}/${seed.weddingSlug}`);
    await expect(page).toHaveTitle(/Pavel a Patricie/);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);

    // Identity in the header once, cards named by what tells them apart.
    await expect(page.getByRole("heading", { name: "Pavel a Patricie" })).toBeVisible();
    await expect(page.getByText("Statek Benice")).toBeVisible();

    await expect(page.getByRole("link", { name: /Od hostů/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /První výběr/ })).toBeVisible();
    // Attached but not listed — the switch that hides the card without
    // touching the gallery's own share link.
    await expect(page.getByRole("link", { name: /Kompletní set/ })).toHaveCount(0);
  });

  test("a card opens the gallery and offers the way back", async ({ page }) => {
    await page.goto(`/s/${seed.weddingToken}/${seed.weddingSlug}`);
    await page.getByRole("link", { name: /První výběr/ }).click();

    await expect(page).toHaveURL(`/s/${seed.weddingToken}/${seed.weddingSlug}/prvni-vyber`);
    await expect(page.getByRole("heading", { name: "První výběr" })).toBeVisible();

    const grid = page.getByRole("list", { name: "Fotky v galerii" });
    await expect.poll(() => grid.locator('button[aria-label^="Otevřít"]').count()).toBe(3);

    await page.getByRole("link", { name: "← Pavel a Patricie" }).click();
    await expect(page).toHaveURL(`/s/${seed.weddingToken}/${seed.weddingSlug}`);
  });

  test("a hidden gallery is refused by key, and does not leak the wedding page", async ({
    page,
  }) => {
    await page.goto(`/s/${seed.weddingToken}/${seed.weddingSlug}/kompletni`);

    await expect(page.getByText("Tahle část už není platný")).toBeVisible();
    // Crucially it stays put: redirecting to the hub would hand the event token
    // to someone who only ever had a link to one gallery.
    await expect(page).toHaveURL(`/s/${seed.weddingToken}/${seed.weddingSlug}/kompletni`);
  });

  test("a wedding with one listed gallery renders it in place, keeping the /s/ URL", async ({
    page,
  }) => {
    await page.goto(`/s/${seed.soloWeddingToken}/${seed.soloWeddingSlug}`);

    // The grid, not a rozcestník with a single card — and no redirect, because
    // whatever is in the address bar is what eighty people save on the night.
    await expect(page).toHaveURL(`/s/${seed.soloWeddingToken}/${seed.soloWeddingSlug}`);
    const grid = page.getByRole("list", { name: "Fotky v galerii" });
    await expect.poll(() => grid.locator('button[aria-label^="Otevřít"]').count()).toBe(2);

    // Nothing to go back to, so no back link is offered.
    await expect(page.getByRole("link", { name: /^←/ })).toHaveCount(0);
  });

  test("the projection runs itself and offers nothing to operate", async ({ page }) => {
    await page.goto(`/s/${seed.weddingToken}/${seed.weddingSlug}/prvni-vyber`);

    await page.getByRole("button", { name: "Projekce" }).click();
    const projection = page.getByRole("dialog", { name: "Projekce" });
    await expect(projection).toBeVisible();

    // Nothing to poke at on a screen nobody stands next to: no arrows, no
    // counter, no scrubber — only a way out.
    await expect(projection.getByRole("button")).toHaveCount(1);
    await expect(projection.getByRole("button", { name: "Ukončit" })).toBeAttached();

    await page.keyboard.press("Escape");
    await expect(projection).toBeHidden();
  });

  test("an unknown wedding token shows the branded not-found page", async ({ page }) => {
    const response = await page.goto("/s/definitely-not-a-real-token/whatever");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Stránka nenalezena" })).toBeVisible();
  });
});
