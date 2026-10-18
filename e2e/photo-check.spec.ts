import fs from "node:fs";
import path from "node:path";
import { test, expect } from "./fixtures";

/**
 * The photo check (docs/SOCIAL-VIDEO.md §4): closed and soft eyes listed from
 * the stored faces, a photo kept (and put back), one deleted, and the photos
 * not searched yet searched on a click.
 *
 * Chromium only: the gallery is shared and the spec changes it.
 */
const seed = JSON.parse(fs.readFileSync(path.join(__dirname, ".seed.json"), "utf8")) as {
  adminCookie: { name: string; value: string };
  photoCheckGalleryId: string;
};

test.beforeEach(async ({ context, baseURL }) => {
  test.skip(test.info().project.name !== "chromium", "changes a shared gallery");
  await context.addCookies([{ ...seed.adminCookie, url: baseURL! }]);
});

test("the photographer goes through closed and soft eyes before the couple sees them", async ({
  page,
}) => {
  await page.goto(`/admin/g/${seed.photoCheckGalleryId}`);
  await page.getByRole("link", { name: "Kontrola fotek" }).click();
  await expect(page.getByRole("heading", { name: "Kontrola fotek", level: 1 })).toBeVisible();
  await expect(page.getByText("Tváře známe u 3 z 4 fotek.")).toBeVisible();

  const open = page.getByRole("heading", { name: /^K prohlédnutí/ });
  await expect(open).toHaveText("K prohlédnutí (2)");
  const card = (fileName: string) => page.getByRole("listitem").filter({ hasText: fileName });
  await expect(card("kontrola_0001.jpg")).toContainText("Zavřené oči");
  await expect(card("kontrola_0003.jpg")).toContainText("Neostré oči");
  await expect(card("kontrola_0002.jpg")).toHaveCount(0);

  // Kept: off the list, and still off it after a reload.
  await card("kontrola_0001.jpg").getByRole("button", { name: "Ponechat" }).click();
  await expect(open).toHaveText("K prohlédnutí (1)");
  await page.reload();
  await expect(open).toHaveText("K prohlédnutí (1)");
  await expect(page.getByRole("heading", { name: "Ponechané (1 fotka)" })).toBeVisible();

  // …and back on it.
  await page.getByRole("button", { name: "Zobrazit" }).click();
  await card("kontrola_0001.jpg").getByRole("button", { name: "Vrátit do kontroly" }).click();
  await expect(open).toHaveText("K prohlédnutí (2)");

  // Deleted: gone from the gallery.
  page.once("dialog", (dialog) => void dialog.accept());
  await card("kontrola_0003.jpg").getByRole("button", { name: "Smazat z galerie" }).click();
  await expect(card("kontrola_0003.jpg")).toHaveCount(0);
  await page.reload();
  await expect(open).toHaveText("K prohlédnutí (1)");
  await expect(page.getByText("Tváře známe u 2 z 3 fotek.")).toBeVisible();

  // The photo not searched yet is searched on the click; its bytes are not in
  // the bucket here, so it is counted as not loaded and left for next time.
  await page.getByRole("button", { name: "Zkontrolovat (1 fotka)" }).click();
  await expect(page.getByText(/1 fotka se nenačetla/)).toBeVisible({ timeout: 60_000 });
});
