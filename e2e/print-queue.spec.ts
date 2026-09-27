import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Print marks: kept through a dropped connection (src/lib/print-queue.ts) and
 * visible to everyone else picking the same order. A bride counted 50 marks
 * where the admin showed 28; a mark that vanishes when the signal drops, or
 * that the partner on another phone cannot see, is what this pins down.
 */

const seed = JSON.parse(fs.readFileSync(path.join(__dirname, ".seed.json"), "utf8")) as {
  token: string;
  slug: string;
};

/**
 * Each project and test marks its own photo of the shared seed gallery: the
 * projects run in parallel, and one test's mark is the other's "somebody
 * else's copies".
 */
function photoFor(projectName: string, test: 0 | 1): number {
  return (projectName === "chromium" ? 0 : 2) + test;
}

async function openGallery(page: Page) {
  // Marking waits for the viewer's saved marks to load; so does the test.
  const loaded = page.waitForResponse((r) => r.url().includes("/print?anonKey="));
  await page.goto(`/g/${seed.token}/${seed.slug}`);
  await loaded;
}

function tile(page: Page, index: number) {
  return page
    .getByRole("list", { name: "Fotky v galerii" })
    .locator('button[aria-label^="Otevřít"]')
    .nth(index);
}

async function unmark(page: Page, index: number) {
  await tile(page, index).click();
  const saved = page.waitForResponse(
    (r) => r.url().endsWith("/print") && r.request().method() === "POST",
  );
  await page.getByRole("dialog").getByRole("button", { name: "Ubrat kopii k tisku" }).click();
  expect((await saved).ok()).toBe(true);
}

test("a print mark made offline is saved when the connection returns", async ({
  page,
  context,
}, testInfo) => {
  const index = photoFor(testInfo.project.name, 0);
  await openGallery(page);
  await tile(page, index).click();

  await context.setOffline(true);
  await page.getByRole("dialog").getByRole("button", { name: "Označit k tisku" }).click();
  await page.getByRole("button", { name: "Přeskočit" }).click();

  const summary = page.getByRole("status").filter({ hasText: "K tisku:" });
  await expect(summary).toContainText("K tisku: 1 fotka · 1 ks");
  await expect(summary).toContainText("Bez připojení – 1 změna čeká");

  await context.setOffline(false);
  await expect(summary).toContainText("Uloženo", { timeout: 15_000 });

  // Now from the server, not from this tab's memory or its stored queue.
  await openGallery(page);
  await expect(summary).toContainText("K tisku: 1 fotka · 1 ks");
  await expect(summary).toContainText("Uloženo");

  // Leave the shared seed gallery as it was.
  await unmark(page, index);
  await expect(page.getByText("K tisku: 1 fotka")).toHaveCount(0);
});

test("copies somebody else marked are visible on another device", async ({
  page,
  browser,
}, testInfo) => {
  const index = photoFor(testInfo.project.name, 1);

  await openGallery(page);
  await tile(page, index).click();
  const saved = page.waitForResponse(
    (r) => r.url().endsWith("/print") && r.request().method() === "POST",
  );
  await page.getByRole("dialog").getByRole("button", { name: "Označit k tisku" }).click();
  await page.getByRole("button", { name: "Přeskočit" }).click();
  expect((await saved).ok()).toBe(true);

  // The partner's phone: a separate browser, so a separate viewer.
  const other = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    locale: "cs-CZ",
  });
  try {
    const partner = await other.newPage();
    await openGallery(partner);
    await expect(partner.getByRole("status").filter({ hasText: "Se všemi:" })).toBeVisible();
    await tile(partner, index).click();
    await expect(
      partner
        .getByRole("dialog")
        .getByRole("button", { name: "Označit k tisku – ostatní už chtějí 1 ks" }),
    ).toBeVisible();
  } finally {
    await other.close();
  }

  await page.keyboard.press("Escape");
  await unmark(page, index);
});
