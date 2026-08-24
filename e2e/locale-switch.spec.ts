import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * The CS/EN locale switcher (src/i18n/request.ts, src/components/locale-switcher.tsx):
 * autodetected from Accept-Language on first visit, then pinned by a cookie
 * so every later request — including the very next one — renders
 * consistently without renegotiating or flashing the wrong language.
 *
 * `playwright.config.ts` pins the default browser context to `cs-CZ` so
 * every other spec keeps asserting on Czech text; this file is the one place
 * that deliberately overrides it to exercise English.
 */

const seed = JSON.parse(fs.readFileSync(path.join(__dirname, ".seed.json"), "utf8")) as {
  token: string;
  slug: string;
};

const LOCALE_COOKIE = "NEXT_LOCALE";
const LOCALE_STORAGE_KEY = "g-gallery-locale";

test.describe("locale switching", () => {
  test("a browser set to English is autodetected, and the cookie is persisted after mount", async ({
    browser,
  }) => {
    const context = await browser.newContext({ locale: "en-US" });
    const page = await context.newPage();

    await page.goto(`/g/${seed.token}/${seed.slug}`);

    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("list", { name: "Photos in the gallery" })).toBeVisible();

    // The server only guessed from Accept-Language and cannot set a cookie
    // mid-render — the client bootstrap persists it shortly after mount.
    await expect
      .poll(async () => {
        const cookies = await context.cookies();
        return cookies.find((c) => c.name === LOCALE_COOKIE)?.value;
      })
      .toBe("en");

    await context.close();
  });

  test("switching locale updates the cookie, localStorage, visible text and <html lang>, without changing the URL", async ({
    page,
  }) => {
    await page.goto(`/g/${seed.token}/${seed.slug}`);

    // Default context locale is cs-CZ (playwright.config.ts) — starts Czech.
    await expect(page.getByRole("list", { name: "Fotky v galerii" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "cs");

    const urlBefore = page.url();
    await page
      .getByRole("group", { name: "Čeština / English" })
      .getByRole("button", { name: "EN" })
      .click();

    await expect(page.getByRole("list", { name: "Photos in the gallery" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    expect(page.url()).toBe(urlBefore);

    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === LOCALE_COOKIE)?.value).toBe("en");
    expect(await page.evaluate((key) => window.localStorage.getItem(key), LOCALE_STORAGE_KEY)).toBe(
      "en",
    );
  });

  test("a returning visit with a stored cookie renders in that language immediately", async ({
    page,
    context,
  }) => {
    await context.addCookies([{ name: LOCALE_COOKIE, value: "en", url: "http://127.0.0.1:3000" }]);

    await page.goto(`/g/${seed.token}/${seed.slug}`, { waitUntil: "domcontentloaded" });

    // Cookie wins over the cs-CZ browser locale immediately on first paint —
    // no renegotiation, no flash of Czech before it swaps to English.
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("list", { name: "Photos in the gallery" })).toBeVisible();
  });
});
