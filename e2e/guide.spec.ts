import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";

/**
 * The client guide in every language (/navod in Czech, /guide in English,
 * /guide/<code> for the rest; src/app/navod/guide-page.tsx). Static, so this
 * covers what can break without a type error: the language following the
 * address rather than the browser, the signpost pointing at sections that
 * exist, indexing with hreflang, and the phone layout.
 */

const PATHS = {
  cs: "/navod",
  en: "/guide",
  fr: "/guide/fr",
  de: "/guide/de",
  es: "/guide/es",
  sk: "/guide/sk",
  pl: "/guide/pl",
} as const;
type Lang = keyof typeof PATHS;

const CZECH_IDS = [
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
];
const ENGLISH_IDS = [
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
];

/** Each language's own copy, read from the file the page renders. */
function copy(lang: Lang) {
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, `../src/app/navod/guide.${lang}.json`), "utf8"),
  ) as { heroTitle: string; tocHeading: string; otherLanguages: string };
}

test.describe("client guide", () => {
  for (const lang of Object.keys(PATHS) as Lang[]) {
    test(`${lang}: the address decides the language, and the signpost lands on every section`, async ({
      browser,
    }) => {
      // A browser asking for a different language must not change the page.
      const context = await browser.newContext({ locale: lang === "en" ? "cs-CZ" : "en-US" });
      const page = await context.newPage();
      await page.goto(PATHS[lang]);

      const text = copy(lang);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(text.heroTitle);
      await expect(page.locator("main")).toHaveAttribute("lang", lang);

      const ids = lang === "cs" ? CZECH_IDS : ENGLISH_IDS;
      const nav = page.getByRole("navigation", { name: text.tocHeading });
      await expect(nav.getByRole("link")).toHaveCount(ids.length);
      for (const id of ids) {
        await expect(nav.locator(`a[href="#${id}"]`)).toHaveCount(1);
        await expect(page.locator(`section[aria-labelledby="${id}"] h2#${id}`)).toHaveCount(1);
      }

      // Every other language is one click away, named in itself.
      const others = page.getByRole("navigation", { name: text.otherLanguages });
      await expect(others.getByRole("link")).toHaveCount(6);
      await expect(others.locator(`a[href="${PATHS[lang]}"]`)).toHaveCount(0);

      // hreflang names all seven, the canonical is the page itself.
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /^index/);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
        "href",
        new RegExp(`${PATHS[lang]}$`),
      );
      for (const [other, otherPath] of Object.entries(PATHS)) {
        await expect(page.locator(`link[rel="alternate"][hreflang="${other}"]`)).toHaveAttribute(
          "href",
          new RegExp(`${otherPath}$`),
        );
      }
      await context.close();
    });
  }

  test("the demo print summary speaks the page's language", async ({ page }) => {
    await page.goto("/navod");
    await expect(page.getByText("K tisku: 24 fotek · 30 ks")).toBeVisible();
    await page.goto("/guide");
    await expect(page.getByText("For print: 24 photos · 30 copies")).toBeVisible();
  });

  test("the favourites section links to the device-transfer steps", async ({ page }) => {
    await page.goto("/navod");
    await expect(
      page.locator("#oblibene").locator("..").getByRole("link", {
        name: "Začínáš na telefonu, pokračuješ doma",
      }),
    ).toHaveAttribute("href", "#jine-zarizeni");
    await expect(page.locator("h3#jine-zarizeni")).toHaveCount(1);

    await page.goto("/guide/de");
    await expect(
      page.locator("#favourites").locator("..").locator('a[href="#other-device"]'),
    ).toHaveCount(1);
    await expect(page.locator("h3#other-device")).toHaveCount(1);
  });

  test("an unknown language is not found", async ({ page }) => {
    const response = await page.goto("/guide/xx");
    expect(response?.status()).toBe(404);
  });

  test("the sitemap lists every language", async ({ page }) => {
    const sitemap = await (await page.request.get("/sitemap.xml")).text();
    for (const pagePath of Object.values(PATHS)) expect(sitemap).toContain(`${pagePath}</loc>`);
  });

  test("is linked from the home page and the footer in the reader's language", async ({
    browser,
  }) => {
    for (const [locale, expected] of [
      ["en-US", "/guide"],
      ["de-DE", "/guide/de"],
      ["cs-CZ", "/navod"],
    ] as const) {
      const context = await browser.newContext({ locale });
      const page = await context.newPage();
      await page.goto("/");
      const links = page.locator(`a[href="${expected}"]`);
      // The hero link and the footer's.
      await expect(links).toHaveCount(2);
      await context.close();
    }
  });

  test("does not scroll sideways on a phone", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 360, height: 740 } });
    const page = await context.newPage();
    for (const pagePath of Object.values(PATHS)) {
      await page.goto(pagePath);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, pagePath).toBeLessThanOrEqual(0);
    }
    await context.close();
  });
});
