import { test, expect } from "./fixtures";
import fs from "node:fs";
import path from "node:path";

/**
 * File-name order with guests woven in by time (docs/PHOTO-ORDER.md). The
 * photographer's photos keep the export's order — a second body an hour early
 * included — and each guest's `IMG_…` lands among them by when it was taken,
 * not at the top where its name would put it.
 */

const seed = JSON.parse(fs.readFileSync(path.join(__dirname, ".seed.json"), "utf8")) as {
  wovenOrder: { token: string; slug: string; fileNames: string[]; chapterFrom: number };
};
const { token, slug, fileNames, chapterFrom } = seed.wovenOrder;

test.describe("file-name order with guests woven in by time", () => {
  test("pages through the export in order, with each guest photo at its time", async ({
    request,
  }) => {
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const url: string = `/api/g/${token}/photos${cursor ? `?cursor=${cursor}` : ""}`;
      const response = await request.get(url);
      expect(response.ok()).toBe(true);
      const body = (await response.json()) as {
        items: { fileName: string }[];
        nextCursor: string | null;
      };
      seen.push(...body.items.map((item) => item.fileName));
      cursor = body.nextCursor;
    } while (cursor);

    // More than one page, nothing repeated, nothing skipped, nothing moved.
    expect(seen).toEqual(fileNames);
  });

  test("a cursor from another order is told the order changed", async ({ request }) => {
    const stale = Buffer.from(
      JSON.stringify({ o: "FILE_NAME", key: "svatba00210", id: "x" }),
    ).toString("base64url");
    const response = await request.get(`/api/g/${token}/photos?cursor=${stale}`);
    expect(response.status()).toBe(409);
    expect(await response.json()).toEqual({ error: "order_changed" });
  });

  test("the grid opens on the earliest guest photo, then the export", async ({ page }) => {
    await page.goto(`/g/${token}/${slug}`);
    const grid = page.getByRole("list", { name: /Fotky v galerii|Photos in the gallery/ });
    const tiles = grid.locator('button[aria-label^="Otevřít"], button[aria-label^="Open"]');
    await expect(tiles.first()).toBeVisible();
    const labels = await tiles.evaluateAll((buttons) =>
      buttons.slice(0, 6).map((b) => b.getAttribute("aria-label") ?? ""),
    );
    expect(labels.map((label) => label.replace(/^\S+\s/, ""))).toEqual(fileNames.slice(0, 6));
  });

  test("a chapter counts the guests' photos taken after it starts", async ({ page }) => {
    await page.goto(`/g/${token}/${slug}`);
    const bar = page.getByRole("navigation", { name: /Kapitoly|Chapters|Chapitres/ });
    await bar.getByRole("link", { name: "Obřad" }).click();
    const heading = page.getByRole("heading", { level: 2, name: "Obřad" });
    await expect(heading).toBeInViewport();
    const header = page.locator("li").filter({ has: heading });
    await expect(header).toContainText(`${fileNames.length - chapterFrom} `);
  });
});
