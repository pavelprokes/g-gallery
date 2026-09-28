import { test, expect } from "./fixtures";
import fs from "node:fs";
import path from "node:path";

/**
 * A gallery shown in file-name order (docs/PHOTO-ORDER.md). The seed's second
 * camera reads an hour early, so in capture-time order its photos would sit an
 * hour back; here every photo sits where its file name puts it — in the grid,
 * across the page boundary, and under the right chapter.
 */

const seed = JSON.parse(fs.readFileSync(path.join(__dirname, ".seed.json"), "utf8")) as {
  fileOrder: { token: string; slug: string; fileNames: string[]; chapterAt: number };
};
const { token, slug, fileNames, chapterAt } = seed.fileOrder;

test.describe("photo order by file name", () => {
  test("pages through the whole gallery in file-name order", async ({ request }) => {
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

  test("a cursor from the other order is told the order changed, not served a wrong page", async ({
    request,
  }) => {
    // What a page opened before the photographer switched the order would send.
    const stale = Buffer.from(
      JSON.stringify({ o: "TAKEN_AT", key: "2026-09-05T08:30:00.000Z", id: "x" }),
    ).toString("base64url");
    const response = await request.get(`/api/g/${token}/photos?cursor=${stale}`);
    expect(response.status()).toBe(409);
    expect(await response.json()).toEqual({ error: "order_changed" });

    const garbage = await request.get(`/api/g/${token}/photos?cursor=nonsense`);
    expect(garbage.status()).toBe(400);
  });

  test("the grid opens on the first file, with the second camera in its place", async ({
    page,
  }) => {
    await page.goto(`/g/${token}/${slug}`);
    const grid = page.getByRole("list", { name: /Fotky v galerii|Photos in the gallery/ });
    const tiles = grid.locator('button[aria-label^="Otevřít"], button[aria-label^="Open"]');
    await expect(tiles.first()).toBeVisible();
    const labels = await tiles.evaluateAll((buttons) =>
      buttons.slice(0, 6).map((b) => b.getAttribute("aria-label") ?? ""),
    );
    // svatba_0005 is the second camera's: by capture time it would open the
    // gallery, an hour before everything else.
    expect(labels.map((label) => label.replace(/^\S+\s/, ""))).toEqual(fileNames.slice(0, 6));
  });

  test("a chapter holds the photos from its file onwards", async ({ page }) => {
    await page.goto(`/g/${token}/${slug}`);
    const bar = page.getByRole("navigation", { name: /Kapitoly|Chapters|Chapitres/ });
    await expect(bar.getByRole("link")).toHaveText(["Přípravy", "Obřad"]);

    await bar.getByRole("link", { name: "Obřad" }).click();
    const heading = page.getByRole("heading", { level: 2, name: "Obřad" });
    await expect(heading).toBeInViewport();
    // The header row carries the chapter's photo count: every file from
    // svatba_0030 to the end, second camera included.
    const header = page.locator("li").filter({ has: heading });
    await expect(header).toContainText(`${fileNames.length - chapterAt + 1} `);
  });
});
