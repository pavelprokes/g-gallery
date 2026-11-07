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
  selectGalleryIds: Record<string, string>;
  webCopyGalleryIds: Record<string, string>;
  uploadGalleryIds: Record<string, string>;
  weddingId: string;
};

const ONE_PIXEL_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==";

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
      .map((row) => row.match(/(\d{1,2})\.\s(\d{1,2})\.\s(\d{4})/))
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

test("photos dropped anywhere on the gallery's page upload there", async ({ page }) => {
  // WebKit cannot read a synthetic drop's file entry (NotFoundError); a real one reads fine.
  test.skip(test.info().project.name !== "chromium");
  await page.goto(`/admin/g/${seed.uploadGalleryIds[test.info().project.name]}`);
  const photos = page.getByRole("heading", { name: /^Fotky/ });
  await expect(photos).toBeVisible();
  // Far from the upload panel, on purpose.
  const panel = await page.getByRole("heading", { name: "Nahrát fotky" }).boundingBox();
  expect(panel!.y).toBeLessThan((await photos.boundingBox())!.y);

  const dataTransfer = await page.evaluateHandle((jpeg) => {
    const bytes = Uint8Array.from(atob(jpeg), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "upustena.jpg", { type: "image/jpeg" }));
    return transfer;
  }, ONE_PIXEL_JPEG_BASE64);
  const hint = page.getByText("Pusť fotky, nahraju je do téhle galerie");
  await expect(hint).toBeHidden();
  await photos.dispatchEvent("dragover", { dataTransfer });
  await expect(hint).toBeVisible();
  await photos.dispatchEvent("drop", { dataTransfer });
  await expect(hint).toBeHidden();

  await expect(page.getByRole("checkbox", { name: "Vybrat upustena.jpg" })).toBeAttached({
    timeout: 15_000,
  });
});

test("a drag that starts on the page is not an upload", async ({ page }) => {
  // An image dragged off a tile carries "Files" too. Synthetic: Playwright's real
  // mouse drag drops that type from its `dragover`, so it cannot show this.
  await page.goto(`/admin/g/${seed.uploadGalleryIds[test.info().project.name]}`);
  const photos = page.getByRole("heading", { name: /^Fotky/ });
  await expect(photos).toBeVisible();
  const dataTransfer = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["x"], "nahled.jpg", { type: "image/jpeg" }));
    return transfer;
  });
  const hint = page.getByText("Pusť fotky, nahraju je do téhle galerie");

  await photos.dispatchEvent("dragstart", { dataTransfer });
  await photos.dispatchEvent("dragover", { dataTransfer });
  await page.waitForTimeout(100);
  // Now, not eventually: the hint goes by itself half a second after the last `dragover`.
  expect(await hint.count()).toBe(0);

  // That drag over, a file from outside counts again.
  await photos.dispatchEvent("dragend", { dataTransfer });
  await photos.dispatchEvent("dragover", { dataTransfer });
  await expect(hint).toBeVisible();
});

test("a photo opens large and the others page on from it", async ({ page }) => {
  await page.goto(`/admin/g/${seed.webCopyGalleryIds[test.info().project.name]}`);
  const open = page.getByRole("button", { name: /^Zvětšit kopie_/ });
  await expect(open).toHaveCount(6);
  await open.nth(1).dispatchEvent("click");

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("2 / 6")).toBeVisible();
  // It opened, it did not select: a tile's own click selects.
  await expect(page.getByRole("toolbar")).toHaveCount(0);

  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByText("3 / 6")).toBeVisible();
  await dialog.getByRole("button", { name: "Předchozí fotka" }).click();
  await expect(dialog.getByText("2 / 6")).toBeVisible();

  await dialog.getByRole("button", { name: "Předchozí fotka" }).click();
  await expect(dialog.getByText("1 / 6")).toBeVisible();
  // Nothing before the first.
  await expect(dialog.getByRole("button", { name: "Předchozí fotka" })).toHaveCount(0);

  // The ‹ went away under the pointer, so the focus left the dialog: the keys still page.
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByText("2 / 6")).toBeVisible();

  await page.keyboard.press("Escape");
  // Out of the page, not just closed, which is all a role sees: the `close` event comes a
  // moment later, and pressing again before it (no person could) would not open it.
  await expect(page.locator("dialog")).toHaveCount(0);

  // Esc closes the photo and leaves a selection alone.
  await page
    .getByRole("checkbox", { name: /^Vybrat kopie_/ })
    .first()
    .dispatchEvent("click");
  await open.first().dispatchEvent("click");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("toolbar")).toContainText("Vybráno: 1 fotka");
});

test("the website's page suggests couples, and links to each gallery and page", async ({
  page,
}) => {
  await page.goto("/admin/web");
  const suggestion = page.locator('form:has(input[name="webSlug"])').first();
  await expect(suggestion.getByRole("button", { name: "Přidat na web" })).toBeVisible();
  await expect(suggestion.locator('input[name="photo"]:checked')).not.toHaveCount(0);
  await expect(suggestion.locator('input[name="webSlug"]')).toHaveValue(/^[a-z0-9-]+$/);

  const portfolio = page.getByRole("listitem").filter({ hasText: /^E2E Web cíl chromium/ });
  // A draft: it may have no page on the website yet.
  await expect(portfolio.getByRole("link", { name: /Na webu/ })).toHaveCount(0);
  await portfolio.getByRole("link", { name: "Otevřít galerii" }).click();
  await expect(page).toHaveURL(/\/admin\/g\//);
  await expect(page.getByRole("heading", { name: "E2E Web cíl chromium" })).toBeVisible();
});

test("the panels sit under the photos, a jump away", async ({ page }) => {
  await page.goto(`/admin/g/${seed.uploadGalleryIds[test.info().project.name]}`);
  const nav = page.getByRole("navigation", { name: "Pod fotkami" });
  await nav.getByRole("link", { name: "Sdílené odkazy" }).click();
  await expect(page).toHaveURL(/#odkazy$/);
  await expect(page.locator("#odkazy")).toBeInViewport();
});

test("the overview opens on tiles, and rows stay chosen for the session", async ({ page }) => {
  await page.goto("/admin");
  const tiles = page.getByRole("button", { name: "Dlaždice" });
  const rows = page.getByRole("button", { name: "Řádky" });
  const firstTitle = page.locator("main ul > li").first().locator("a[href^='/admin/']").first();
  const widthOfCover = () =>
    page
      .locator("main ul > li")
      .first()
      .locator("div")
      .first()
      .evaluate((cover) => cover.getBoundingClientRect().width);
  await expect(tiles).toHaveAttribute("aria-pressed", "true");
  await expect(firstTitle).toBeVisible();
  expect(await widthOfCover()).toBeGreaterThan(120);

  await rows.click();
  await expect(rows).toHaveAttribute("aria-pressed", "true");
  expect(await widthOfCover()).toBe(64);
  // A line between rows, none under the last.
  const bottomBorder = (item: ReturnType<typeof page.locator>) =>
    item.evaluate((li) => getComputedStyle(li).borderBottomWidth);
  const items = page.locator("main ul").first().locator(":scope > li");
  expect(await bottomBorder(items.first())).toBe("1px");
  expect(await bottomBorder(items.last())).toBe("0px");

  await page.reload();
  await expect(rows).toHaveAttribute("aria-pressed", "true");
  expect(await widthOfCover()).toBe(64);
  await expect(firstTitle).toBeVisible();
});

test("copying to the web counts the photos, and says when it is done and where they went", async ({
  page,
}) => {
  const project = test.info().project.name;
  const source = `/admin/g/${seed.webCopyGalleryIds[project]}`;
  // Slow enough to read the count; it passes in a moment on a local bucket.
  await page.route(`**${source}`, async (route) => {
    if (route.request().method() === "POST") await new Promise((done) => setTimeout(done, 400));
    await route.continue();
  });
  await page.goto(source);
  const boxes = page.getByRole("checkbox", { name: /^Vybrat kopie_/ });
  await expect(boxes).toHaveCount(6);
  // Not a click at coordinates: the bar that appears covers the lower tiles on a phone.
  for (let n = 0; n < 6; n += 1) await boxes.nth(n).dispatchEvent("click");

  const bar = page.getByRole("toolbar", { name: "Akce s vybranými fotkami" });
  await bar.getByLabel("Webová galerie").selectOption({ label: `E2E Web cíl ${project}` });
  await bar.getByRole("button", { name: "Kopírovat na web" }).click();

  await expect(bar.getByRole("button", { name: "Kopíruji 4 / 6" })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Průběh kopírování na web" })).toBeVisible();
  await expect(
    page.getByRole("paragraph").filter({ hasText: "Zkopírováno na web: 6 fotek" }),
  ).toBeVisible();
  await expect(bar).toBeHidden();

  await page.getByRole("link", { name: `Otevřít E2E Web cíl ${project}` }).click();
  await expect(page.getByRole("heading", { name: `E2E Web cíl ${project}` })).toBeVisible();
  await expect(boxes).toHaveCount(6);
});

test.describe("photo selection", () => {
  // One gallery, changed as it goes — the steps depend on each other.
  test.describe.configure({ mode: "serial" });
  const galleryUrl = () => `/admin/g/${seed.selectGalleryIds[test.info().project.name]}`;

  test("a tap selects a photo, and the bar sets it as the cover", async ({ page }) => {
    await page.goto(galleryUrl());
    const bar = page.getByRole("toolbar", { name: "Akce s vybranými fotkami" });
    await expect(bar).toBeHidden();

    await page.getByRole("checkbox", { name: "Vybrat vyber_3.jpg" }).check();
    await expect(bar).toContainText("Vybráno: 1 fotka");
    await bar.getByRole("button", { name: "Nastavit jako titulní" }).click();

    // The action refreshes the page and clears the selection.
    await expect(bar).toBeHidden();
    const tile = page.locator("label", {
      has: page.getByRole("checkbox", { name: "Vybrat vyber_3.jpg" }),
    });
    await expect(tile.getByText("Titulní")).toBeVisible();
  });

  test("shift-click selects a range, Escape clears it", async ({ page }) => {
    await page.goto(galleryUrl());
    const boxes = page.getByRole("checkbox", { name: /^Vybrat vyber_/ });
    await boxes.nth(0).click();
    // On the tile, not the box — the label path, which Firefox does not forward.
    await page
      .locator("label")
      .filter({ has: page.locator(`input[name="photo"]`) })
      .nth(3)
      .click({ modifiers: ["Shift"] });
    const bar = page.getByRole("toolbar", { name: "Akce s vybranými fotkami" });
    await expect(bar).toContainText("Vybráno: 4 fotky");
    // Only a single photo can be the cover.
    await expect(bar.getByRole("button", { name: "Nastavit jako titulní" })).toHaveCount(0);

    await page.keyboard.press("Escape");
    await expect(bar).toBeHidden();
    await expect(boxes.nth(0)).not.toBeChecked();
  });

  test("deletes the selected photos after a confirm", async ({ page }) => {
    await page.goto(galleryUrl());
    const boxes = page.getByRole("checkbox", { name: /^Vybrat vyber_/ });
    await expect(boxes).toHaveCount(6);
    await page.getByRole("checkbox", { name: "Vybrat vyber_5.jpg" }).check();
    await page.getByRole("checkbox", { name: "Vybrat vyber_6.jpg" }).check();

    page.once("dialog", (dialog) => {
      expect(dialog.message()).toBe("Smazat 2 fotky? Tohle už nejde vzít zpět.");
      void dialog.accept();
    });
    await page.getByRole("toolbar").getByRole("button", { name: "Smazat" }).click();

    await expect(boxes).toHaveCount(4);
    await expect(page.getByRole("checkbox", { name: "Vybrat vyber_5.jpg" })).toHaveCount(0);
  });
});

test("activity: a sitting of downloads is one row, older pages load by cursor", async ({
  page,
}) => {
  await page.goto("/admin/updates");
  // Eight archive downloads, 9:08–9:14 Prague time.
  await expect(page.getByRole("link", { name: "Stažení z galerie · 8×" })).toBeVisible();
  await expect(page.getByText("E2E Aktivita · 9:08–9:14")).toBeVisible();

  // 110 favourites a day apart do not fit on one page.
  await page.getByRole("link", { name: "Načíst starší" }).click();
  await expect(page).toHaveURL(/\?before=/);
  await expect(page.getByRole("link", { name: "Zpět na nejnovější" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "1. 1. 2025", exact: true })).toBeVisible();
  // The push settings belong to the first page only.
  await expect(page.getByText("Upozornění na návštěvu")).toHaveCount(0);
});

test("activity: a malformed cursor falls back to the first page", async ({ page }) => {
  await page.goto("/admin/updates?before=nonsense");
  await expect(page.getByText("Upozornění na návštěvu")).toBeVisible();
});

test("on a phone: thumb-sized targets, no drag-and-drop or chart talk", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "touch layout only");
  // Every visible button and breadcrumb, both ways — an arrow button can be
  // 44px tall and still a 28px-wide miss.
  const tooSmall = () =>
    page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("main button, main nav a")]
        .filter((el) => el.checkVisibility())
        .map((el) => {
          const { width, height } = el.getBoundingClientRect();
          return `${el.innerText.trim()} ${Math.round(width)}x${Math.round(height)}`;
        })
        .filter((target) => {
          const [width, height] = target.split(" ").at(-1)!.split("x").map(Number);
          return width! < 44 || height! < 44;
        }),
    );

  await page.goto(`/admin/g/${seed.galleryId}`);
  await expect(page.getByText("Nebo je přetáhni kamkoliv na stránku.")).toBeHidden();
  expect(await tooSmall()).toEqual([]);

  // The wedding page: three galleries, so the move-up/down arrows show.
  await page.goto(`/admin/e/${seed.weddingId}`);
  await expect(page.getByRole("button", { name: "Posunout dolů" }).first()).toBeVisible();
  expect(await tooSmall()).toEqual([]);

  await page.goto("/admin");
  const legends = page.getByText("opakované návštěvy", { exact: true });
  await expect(legends).not.toHaveCount(0);
  for (const legend of await legends.all()) await expect(legend).toBeHidden();
});

test("every gallery and wedding opens as guests see it, in a new tab", async ({ page }) => {
  await page.goto("/admin");
  const openGallery = page.getByRole("link", { name: "Otevřít galerii ↗" });
  await expect(openGallery.first()).toBeVisible();
  await expect(openGallery.first()).toHaveAttribute("target", "_blank");
  await expect(openGallery.first()).toHaveAttribute("href", /^\/g\//);
  await expect(page.getByRole("link", { name: "Otevřít svatbu ↗" }).first()).toHaveAttribute(
    "href",
    /^\/s\//,
  );

  await page.goto(`/admin/g/${seed.galleryId}`);
  const header = page.getByRole("link", { name: "Otevřít galerii ↗" });
  await expect(header).toHaveAttribute("target", "_blank");
  const [guestTab] = await Promise.all([page.context().waitForEvent("page"), header.click()]);
  await guestTab.waitForLoadState();
  await expect(guestTab.getByRole("list", { name: "Fotky v galerii" })).toBeVisible();
  await guestTab.close();

  await page.goto(`/admin/e/${seed.weddingId}`);
  await expect(page.getByRole("link", { name: "Otevřít svatbu ↗" })).toHaveAttribute(
    "href",
    /^\/s\//,
  );
});

test("chapters and highlights stay folded until opened", async ({ page }) => {
  await page.goto(`/admin/g/${seed.galleryId}`);
  for (const title of ["Kapitoly", "Výběr na začátku galerie"]) {
    const panel = page
      .locator("details")
      .filter({ has: page.getByRole("heading", { name: title }) });
    await expect(panel).not.toHaveAttribute("open");
    await panel.locator("summary").click();
    await expect(panel).toHaveAttribute("open");
  }
  // Opened for editing on the timeline, where chapters are made.
  await page.goto(`/admin/g/${seed.galleryId}?sort=order`);
  await expect(
    page.locator("details").filter({ has: page.getByRole("heading", { name: "Kapitoly" }) }),
  ).toHaveAttribute("open");
});

test("a gallery's faces are searched without a click", async ({ page }) => {
  await page.goto(`/admin/g/${seed.galleryId}`);
  // Seeded photos have no bytes, so the search runs and reports them unloaded —
  // what matters is that it started on its own.
  await expect(
    page.getByRole("status").filter({ hasText: /Hledám tváře|Tváře jsou hledané/ }),
  ).toBeVisible({ timeout: 30_000 });
});

test('"Dárkové video" starts the gift on arrival, and says why a browser cannot', async ({
  page,
}) => {
  await page.goto(`/admin/g/${seed.galleryId}`);
  await page.getByRole("link", { name: "Dárkové video" }).click();
  // Playwright's Chromium encodes no H.264 — the gift says so instead of failing silently.
  await expect(page.getByText(/neumí H\.264/)).toBeVisible({ timeout: 30_000 });
  // Taken off the address, so a reload does not make the gift twice.
  await expect(page).toHaveURL(new RegExp(`/admin/g/${seed.galleryId}/video$`));
});
