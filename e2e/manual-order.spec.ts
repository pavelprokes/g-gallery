import fs from "node:fs";
import path from "node:path";
import type { APIRequestContext, Page } from "@playwright/test";
import { test, expect } from "./fixtures";

/**
 * A gallery arranged by hand (docs/PHOTO-ORDER.md §Manual order): switched to
 * it from file-name order, photos moved by keyboard and by dragging, and the
 * guests' pages — every page of the cursor, the chapters — follow. Switching
 * away and back keeps the arrangement.
 *
 * Chromium only: the gallery is shared and the spec changes it.
 */
const seed = JSON.parse(fs.readFileSync(path.join(__dirname, ".seed.json"), "utf8")) as {
  adminCookie: { name: string; value: string };
  manualOrder: { galleryId: string; token: string; slug: string; fileNames: string[] };
};
const { galleryId, token, slug, fileNames } = seed.manualOrder;
const file = (n: number) => fileNames[n - 1]!;

/** The whole gallery as guests page through it. */
async function guestOrder(request: APIRequestContext): Promise<string[]> {
  const seen: string[] = [];
  let cursor: string | null = null;
  do {
    const response = await request.get(
      `/api/g/${token}/photos${cursor ? `?cursor=${cursor}` : ""}`,
    );
    expect(response.ok()).toBe(true);
    const body = (await response.json()) as {
      items: { fileName: string }[];
      nextCursor: string | null;
    };
    seen.push(...body.items.map((item) => item.fileName));
    cursor = body.nextCursor;
  } while (cursor);
  return seen;
}

/** Waits for every drop to be saved. */
async function saved(page: Page) {
  await expect(page.getByText("Ukládám…")).toHaveCount(0);
}

test.beforeEach(async ({ context, baseURL }) => {
  test.skip(test.info().project.name !== "chromium", "changes a shared gallery");
  await context.addCookies([{ ...seed.adminCookie, url: baseURL! }]);
});

test("the photographer arranges the gallery by hand and guests see it", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await page.goto(`/admin/g/${galleryId}/order`);
  await page.getByRole("button", { name: "Řadit ručně" }).click();

  // Starts from the order it showed: file names.
  const board = page.getByRole("list", { name: "Pořadí fotek v galerii" });
  const handles = board.getByRole("button", { name: /^Přesunout/ });
  await expect(handles).toHaveCount(fileNames.length);
  expect(await guestOrder(request)).toEqual(fileNames);

  // Keyboard: the last photo to the front, then the thirtieth — where the
  // second chapter begins — in front of it.
  await handles.nth(69).focus();
  await page.keyboard.press("Home");
  await saved(page);
  // Everything moved one on: the thirtieth file is at index 30 now.
  await expect(handles.nth(30)).toHaveAccessibleName(new RegExp(file(30)));
  await handles.nth(30).focus();
  await page.keyboard.press("Home");
  await saved(page);

  // Mouse: the first file's photo (third now) dragged two places on.
  const tiles = board.getByRole("listitem");
  const from = (await tiles.nth(2).boundingBox())!;
  const to = (await tiles.nth(4).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
  await saved(page);

  const arranged = [
    file(30),
    file(70),
    file(2),
    file(3),
    file(1),
    ...fileNames.slice(3, 29),
    ...fileNames.slice(30, 69),
  ];
  // Across the page boundary, nothing repeated or lost.
  expect(await guestOrder(request)).toEqual(arranged);

  // A chapter goes where its photo goes: "Obřad" now opens the gallery.
  await page.goto(`/g/${token}/${slug}`);
  const bar = page.getByRole("navigation", { name: /Kapitoly|Chapters|Chapitres/ });
  await expect(bar.getByRole("link")).toHaveText(["Obřad", "Přípravy"]);

  // Switching to file names and back keeps the arrangement.
  await page.goto(`/admin/g/${galleryId}`);
  const orders = page.getByRole("group", { name: "Pořadí fotek" });
  await orders.getByRole("button", { name: "Podle názvu souboru" }).click();
  await expect(orders.getByRole("button", { name: "Podle názvu souboru" })).toBeDisabled();
  expect(await guestOrder(request)).toEqual(fileNames);
  await orders.getByRole("button", { name: "Ručně" }).click();
  await expect(orders.getByRole("button", { name: "Ručně" })).toBeDisabled();
  expect(await guestOrder(request)).toEqual(arranged);
});
