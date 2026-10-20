import { test, expect } from "@playwright/test";

/**
 * The client guide (/navod in Czech, /guide in English;
 * src/app/navod/guide-page.tsx). Static, so this covers what can break without
 * a type error: the language following the address rather than the browser,
 * the signpost pointing at sections that exist, indexing with hreflang, and
 * the phone layout.
 */

const SECTIONS = {
  "/navod": [
    "zaciname",
    "prohlizeni",
    "tisk",
    "oblibene",
    "stahovani",
    "pripominky",
    "hoste",
    "offline",
    "soukromi",
    "problemy",
  ],
  "/guide": [
    "getting-started",
    "browsing",
    "print",
    "favourites",
    "downloading",
    "edits",
    "guests",
    "offline",
    "privacy",
    "troubleshooting",
  ],
} as const;

const SIGNPOST = { "/navod": "Co chceš udělat?", "/guide": "What would you like to do?" } as const;

test.describe("client guide", () => {
  test("the address decides the language, not the browser", async ({ browser }) => {
    const english = await browser.newContext({ locale: "en-US" });
    const czechPage = await english.newPage();
    await czechPage.goto("/navod");
    await expect(czechPage.getByRole("heading", { level: 1 })).toHaveText("Jak na svou galerii");
    await expect(czechPage.locator("main")).toHaveAttribute("lang", "cs");
    // The demo summary reuses the gallery's own messages — those must follow too.
    await expect(czechPage.getByText("K tisku: 24 fotek · 30 ks")).toBeVisible();
    await english.close();

    const czech = await browser.newContext({ locale: "cs-CZ" });
    const englishPage = await czech.newPage();
    await englishPage.goto("/guide");
    await expect(englishPage.getByRole("heading", { level: 1 })).toHaveText(
      "How to use your gallery",
    );
    await expect(englishPage.locator("main")).toHaveAttribute("lang", "en");
    await expect(englishPage.getByText("For print: 24 photos · 30 copies")).toBeVisible();
    await expect(englishPage.getByText("wedding photographer", { exact: false })).toBeVisible();
    await czech.close();
  });

  for (const [path, ids] of Object.entries(SECTIONS)) {
    test(`every signpost entry on ${path} lands on its section`, async ({ page }) => {
      await page.goto(path);

      const nav = page.getByRole("navigation", { name: SIGNPOST[path as keyof typeof SIGNPOST] });
      await expect(nav.getByRole("link")).toHaveCount(ids.length);

      for (const id of ids) {
        await expect(nav.locator(`a[href="#${id}"]`)).toHaveCount(1);
        await expect(page.locator(`section[aria-labelledby="${id}"] h2#${id}`)).toHaveCount(1);
      }

      await nav.locator(`a[href="#${ids[4]}"]`).click();
      await expect(page.locator(`h2#${ids[4]}`)).toBeInViewport();
    });
  }

  test("the favourites section links to the device-transfer steps", async ({ page }) => {
    await page.goto("/navod");

    const link = page.locator("#oblibene").locator("..").getByRole("link", {
      name: "Začínáš na telefonu, pokračuješ doma",
    });
    await expect(link).toHaveAttribute("href", "#jine-zarizeni");
    await expect(page.locator("h3#jine-zarizeni")).toHaveCount(1);

    await page.goto("/guide");
    await expect(
      page.locator("#favourites").locator("..").getByRole("link", {
        name: "Start on your phone, carry on at home",
      }),
    ).toHaveAttribute("href", "#other-device");
  });

  test("is indexed, and each language names the other", async ({ page }) => {
    for (const [path, other, otherLabel] of [
      ["/navod", "/guide", "English version"],
      ["/guide", "/navod", "Česká verze"],
    ] as const) {
      await page.goto(path);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /^index/);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
        "href",
        new RegExp(`${path}$`),
      );
      await expect(page.locator('link[rel="alternate"][hreflang="cs"]')).toHaveAttribute(
        "href",
        /\/navod$/,
      );
      await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveAttribute(
        "href",
        /\/guide$/,
      );
      await expect(page.getByRole("link", { name: otherLabel })).toHaveAttribute("href", other);
    }

    const sitemap = await (await page.request.get("/sitemap.xml")).text();
    expect(sitemap).toContain("/navod</loc>");
    expect(sitemap).toContain("/guide</loc>");
  });

  test("is linked from the home page and the gallery footer in the reader's language", async ({
    browser,
  }) => {
    const context = await browser.newContext({ locale: "en-US" });
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.getByRole("link", { name: /Step-by-step guide/ })).toHaveAttribute(
      "href",
      "/guide",
    );
    await expect(page.getByRole("link", { name: "How to use the gallery" })).toHaveAttribute(
      "href",
      "/guide",
    );
    await context.close();
  });

  test("does not scroll sideways on a phone", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 360, height: 740 } });
    const page = await context.newPage();
    for (const path of Object.keys(SECTIONS)) {
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    }
    await context.close();
  });
});
