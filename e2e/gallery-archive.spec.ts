import { test, expect } from "./fixtures";
import fs from "node:fs";
import path from "node:path";

/**
 * The "download all" control, across every state the pre-built archive
 * (docs/TODO.md §7) can be in.
 *
 * Written after the 2026-09-01 outage, in which a 377-photo production gallery
 * showed "Připravujeme archiv" for a full day. Two separate bugs had to line
 * up for that, and both are asserted here:
 *
 *  1. The builder Worker could not finish a large archive at all, so the
 *     gallery ended in `FAILED` — covered by unit tests on the pieces
 *     (`zip-part-assembly`, `zip-build-policy`), not reachable from a browser.
 *  2. The viewer hid the download link for anything but READY/PENDING. Even
 *     though a complete archive was sitting in R2 untouched — an in-flight
 *     multipart upload does not disturb the object already at the key — a
 *     gallery mid-rebuild, or one whose rebuild had failed, showed the couple
 *     a dead "Připravujeme archiv" button. That half is what this spec pins.
 *
 * The rule these tests encode: **once an archive has been built, the download
 * link never disappears again.**
 */

const seed = JSON.parse(fs.readFileSync(path.join(__dirname, ".seed.json"), "utf8")) as {
  archives: Record<
    "none" | "ready" | "rebuilding" | "failed",
    { id: string; token: string; slug: string }
  >;
};

const PREPARING = "Připravujeme archiv";

test.describe("pre-built archive: the download control", () => {
  test("offers the archive, with its size, when one is ready", async ({ page }) => {
    await page.goto(`/g/${seed.archives.ready.token}/${seed.archives.ready.slug}`);

    // 12_300_000 bytes — the size is in the label because 8 GB is a different
    // decision on a phone than 12 MB is.
    const link = page.getByRole("link", { name: /Stáhnout vše \(/ });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", /_archive\.zip$/);
    await expect(link).toHaveAttribute("title", "Stáhnout vše (ZIP)");

    await expect(page.getByRole("button", { name: PREPARING })).toHaveCount(0);
  });

  test("keeps serving the previous archive while a rebuild is running", async ({ page }) => {
    await page.goto(`/g/${seed.archives.rebuilding.token}/${seed.archives.rebuilding.slug}`);

    const link = page.getByRole("link", { name: /Stáhnout vše \(/ });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", /_archive\.zip$/);
    // Flagged as one photo short rather than presented as complete.
    await expect(link).toHaveAttribute("title", /obnovuje/);

    await expect(page.getByRole("button", { name: PREPARING })).toHaveCount(0);
  });

  test("keeps serving the previous archive after a rebuild fails", async ({ page }) => {
    // The exact production shape: FAILED, with a complete archive still in R2.
    await page.goto(`/g/${seed.archives.failed.token}/${seed.archives.failed.slug}`);

    const link = page.getByRole("link", { name: /Stáhnout vše \(/ });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", /_archive\.zip$/);
    await expect(page.getByRole("button", { name: PREPARING })).toHaveCount(0);
  });

  test("says so honestly when no archive has ever been built", async ({ page }) => {
    await page.goto(`/g/${seed.archives.none.token}/${seed.archives.none.slug}`);

    // The one state where "Připravujeme archiv" is the truth. It must be
    // disabled — a link here would point at a key that 404s — and it must
    // explain the way out rather than being a dead control.
    const button = page.getByRole("button", { name: PREPARING });
    await expect(button).toBeVisible();
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute("title", /Vyber si zatím fotky|za chvíli/);

    await expect(page.getByRole("link", { name: /Stáhnout vše/ })).toHaveCount(0);
  });

  test("a viewer can still take photos now while the archive is missing", async ({ page }) => {
    // The promise the "Připravujeme archiv" tooltip makes: selecting photos
    // and downloading those does not depend on the pre-built archive at all.
    // If this breaks, the honest empty state becomes a dead end.
    await page.goto(`/g/${seed.archives.none.token}/${seed.archives.none.slug}`);

    const grid = page.getByRole("list", { name: "Fotky v galerii" });
    await expect(grid).toBeVisible();

    await page.getByRole("checkbox").first().click();
    await expect(
      page.locator(".sticky").getByRole("button", { name: "Stáhnout 1 fotku" }),
    ).toBeVisible();
  });
});
