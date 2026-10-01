import { test, expect } from "@playwright/test";

/**
 * The client guide (/navod, src/app/navod/page.tsx). Static, so this covers
 * what can break without a type error: the forced Czech, the table of
 * contents pointing at sections that exist, and the phone layout.
 */

const SECTION_IDS = [
  "tisk",
  "prohlizeni",
  "oblibene",
  "stahovani",
  "hoste",
  "offline",
  "soukromi",
  "problemy",
];

test.describe("client guide", () => {
  test("renders in Czech even for an English browser, footer included", async ({ browser }) => {
    const context = await browser.newContext({ locale: "en-US" });
    const page = await context.newPage();

    await page.goto("/navod");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Jak pracovat se svou galerií",
    );
    await expect(page.locator("main")).toHaveAttribute("lang", "cs");
    // The demo summary reuses the gallery's own messages — those must be Czech too.
    await expect(page.getByText("K tisku: 24 fotek · 30 ks")).toBeVisible();
    await expect(page.getByText("svatební fotograf", { exact: false })).toBeVisible();

    await context.close();
  });

  test("every table-of-contents entry lands on its section", async ({ page }) => {
    await page.goto("/navod");

    const toc = page.getByRole("navigation", { name: "Obsah" });
    await expect(toc.getByRole("link")).toHaveCount(SECTION_IDS.length);

    for (const id of SECTION_IDS) {
      await expect(toc.locator(`a[href="#${id}"]`)).toHaveCount(1);
      await expect(page.locator(`section[aria-labelledby="${id}"] h2#${id}`)).toHaveCount(1);
    }

    await toc.locator('a[href="#stahovani"]').click();
    await expect(page.locator("h2#stahovani")).toBeInViewport();
  });

  test("the favourites section links to the device-transfer steps", async ({ page }) => {
    await page.goto("/navod");

    const link = page.locator("#oblibene").locator("..").getByRole("link", {
      name: "Začínáš na telefonu, pokračuješ doma",
    });
    await expect(link).toHaveAttribute("href", "#jine-zarizeni");
    await expect(page.locator("h3#jine-zarizeni")).toHaveCount(1);
  });

  test("stays out of search results until it is translated", async ({ page }) => {
    await page.goto("/navod");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });

  test("does not scroll sideways on a phone", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 360, height: 740 } });
    const page = await context.newPage();
    await page.goto("/navod");

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    await context.close();
  });
});
