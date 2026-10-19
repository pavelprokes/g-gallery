import fs from "node:fs";
import path from "node:path";
import { test, expect } from "./fixtures";

/**
 * Who is who (docs/SOCIAL-VIDEO.md §4): the couple added, faces named by
 * clicking, the names kept over a reload, a face holding one name, and a
 * person deleted with their tags.
 *
 * Chromium only: the gallery is shared and the spec changes it.
 */
const seed = JSON.parse(fs.readFileSync(path.join(__dirname, ".seed.json"), "utf8")) as {
  adminCookie: { name: string; value: string };
  faceTagGalleryId: string;
  faceSeriesGalleryId: string;
};

test.beforeEach(async ({ context, baseURL }) => {
  test.skip(test.info().project.name !== "chromium", "changes a shared gallery");
  await context.addCookies([{ ...seed.adminCookie, url: baseURL! }]);
});

test("the photographer names the couple's faces by hand", async ({ page }) => {
  await page.goto(`/admin/g/${seed.faceTagGalleryId}`);
  await page.getByRole("link", { name: "Kdo je kdo" }).click();
  await expect(page.getByRole("heading", { name: "Kdo je kdo", level: 1 })).toBeVisible();
  await expect(page.getByText("Tváře známe u 2 z 3 fotek.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "3 tváře" })).toBeVisible();

  const person = (name: string) =>
    page.getByRole("group", { name: "Koho označuješ" }).getByRole("button", { name });
  const couplePhoto = page.getByRole("button", { name: /^Tvář na fotce lide_0001\.jpg/ });
  const left = couplePhoto.nth(0);
  const right = couplePhoto.nth(1);

  // Clicking a face before choosing anyone says what to do first. Retried: a
  // click before the page hydrates does nothing, and under a full run's load
  // that can be the first one.
  await expect(async () => {
    await left.click();
    await expect(page.getByText("Nejdřív nahoře vyber, koho označuješ.")).toBeVisible({
      timeout: 1000,
    });
  }).toPass();

  await page.getByRole("button", { name: "Přidat: Nevěsta" }).click();
  await expect(person(/^Nevěsta, novomanželé · 0$/)).toHaveAttribute("aria-pressed", "true");
  await left.click();
  await expect(left).toHaveAttribute("aria-pressed", "true");
  await expect(person(/^Nevěsta, novomanželé · 1$/)).toBeVisible();
  // Still listed under "Neoznačené" until the filter changes.
  await expect(page.getByRole("heading", { name: "3 tváře" })).toBeVisible();

  await page.getByRole("button", { name: "Přidat: Ženich" }).click();
  await expect(person(/^Ženich, novomanželé · 0$/)).toHaveAttribute("aria-pressed", "true");
  await right.click();
  await expect(person(/^Ženich, novomanželé · 1$/)).toBeVisible();
  await page.waitForLoadState("networkidle");

  await page.reload();
  const filter = page.getByLabel("Zobrazit");
  await expect(filter.locator("option:checked")).toHaveText("Neoznačené (1)");
  await expect(async () => {
    await filter.selectOption({ label: "Nevěsta (1)" });
    await expect(page.getByRole("heading", { name: "1 tvář" })).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect(
    page.getByRole("button", { name: "Tvář na fotce lide_0001.jpg, Nevěsta" }),
  ).toBeVisible();

  // A face holds one name: the bride on the groom's face takes it from him,
  // and leaves her old face.
  await filter.selectOption({ label: "Všechny (3)" });
  // The first of the couple is chosen when the page opens.
  await expect(person(/^Nevěsta/)).toHaveAttribute("aria-pressed", "true");
  // Waited for: the list updates before the save is done, and a reload would cut it off.
  const saved = page.waitForResponse((r) => r.request().method() === "POST");
  await page.getByRole("button", { name: "Tvář na fotce lide_0001.jpg, Ženich" }).click();
  await saved;
  await page.reload();
  await expect(person(/^Nevěsta, novomanželé · 1$/)).toBeVisible();
  await expect(person(/^Ženich, novomanželé · 0$/)).toBeVisible();
  await expect(page.getByLabel("Zobrazit").locator("option:checked")).toHaveText("Neoznačené (2)");

  // Deleted with its tags.
  await expect(person(/^Nevěsta/)).toHaveAttribute("aria-pressed", "true");
  page.on("dialog", (dialog) => void dialog.accept());
  await expect(async () => {
    const remove = page.getByRole("button", { name: "Smazat", exact: true });
    if (await remove.count()) await remove.click({ timeout: 1000 });
    await expect(person(/^Nevěsta/)).toHaveCount(0, { timeout: 1000 });
  }).toPass();
  await page.reload();
  await expect(page.getByLabel("Zobrazit").locator("option:checked")).toHaveText("Neoznačené (3)");
});

test("a face named in a burst is offered on the rest of the series", async ({ page }) => {
  await page.goto(`/admin/g/${seed.faceSeriesGalleryId}/people`);
  await expect(page.getByRole("heading", { name: "4 tváře" })).toBeVisible();
  const offer = page.getByRole("status").filter({ hasText: "ze série" });

  // Retried: a click before the page hydrates does nothing.
  await expect(async () => {
    const preset = page.getByRole("button", { name: "Přidat: Nevěsta" });
    if (await preset.count()) await preset.click({ timeout: 1000 });
    await expect(page.getByRole("button", { name: /^Nevěsta, novomanželé/ })).toBeVisible({
      timeout: 1000,
    });
  }).toPass();
  await page.getByRole("button", { name: /^Tvář na fotce serie_0002\.jpg/ }).click();
  // The shots either side, seconds apart — not the one a minute later.
  await expect(offer).toContainText("na 2 sousedních fotkách");
  const saved = page.waitForResponse((r) => r.request().method() === "POST");
  await offer.getByRole("button", { name: "Označit i tam" }).click();
  await saved;
  await expect(offer).toHaveCount(0);

  await page.reload();
  const bride = page.getByRole("button", { name: /^Nevěsta, novomanželé · 3$/ });
  await expect(bride).toBeVisible();
  await expect(page.getByRole("button", { name: "Tvář na fotce serie_0004.jpg" })).toBeVisible();
});
