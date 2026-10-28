import fs from "node:fs";
import path from "node:path";
import { test, expect } from "./fixtures";

/**
 * The engraving plate (docs/ENGRAVING.md): reached from the wedding, prefilled
 * from its title and date, downloaded as outlined SVG and as a JPG at the
 * template's size and resolution. Reads only — the seeded wedding is shared.
 */
const seed = JSON.parse(fs.readFileSync(path.join(__dirname, ".seed.json"), "utf8")) as {
  adminCookie: { name: string; value: string };
  weddingId: string;
};

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ ...seed.adminCookie, url: baseURL! }]);
});

/** Width and height from a JPEG's start-of-frame marker. */
function jpegSize(bytes: Buffer): { width: number; height: number } {
  let offset = 2;
  while (offset < bytes.length) {
    const marker = bytes[offset + 1]!;
    const length = bytes.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xc2) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  throw new Error("no SOF marker");
}

test("the photographer downloads the plate for a wedding", async ({ page }) => {
  await page.goto(`/admin/e/${seed.weddingId}`);
  await page.getByRole("link", { name: "Gravírování" }).click();
  await expect(page.getByRole("heading", { name: "Gravírování", level: 1 })).toBeVisible();

  // "Pavel a Patricie", 12. 8. 2026 — split and written the way the plate shows them.
  await expect(page.getByLabel("První jméno")).toHaveValue("Pavel");
  await expect(page.getByLabel("Spojka")).toHaveValue("a");
  await expect(page.getByLabel("Druhé jméno")).toHaveValue("Patricie");
  await expect(page.getByLabel("Datum")).toHaveValue("12. 8. 2026");

  const preview = page.getByRole("img", { name: /^Náhled gravírování/ });
  await expect(preview.locator("svg #jmena")).toBeAttached();
  await expect(preview.locator("svg #ramecek")).toBeAttached();

  await page.getByLabel("Spojka").selectOption("&");
  await expect(preview).toHaveAccessibleName("Náhled gravírování: Pavel & Patricie, 12. 8. 2026");

  const svgDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Stáhnout SVG (křivky)" }).click();
  const svgFile = await svgDownload;
  expect(svgFile.suggestedFilename()).toBe("gravirovani-pavel-patricie-2026-08-12.svg");
  const svg = fs.readFileSync((await svgFile.path())!, "utf8");
  expect(svg).toContain('width="1702" height="1815"');
  expect(svg).toContain('<path id="jmena" d="M');
  // Outlines only: a laser without the font engraves the same.
  expect(svg).not.toContain("<text");

  const jpgDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Stáhnout JPG" }).click();
  const jpgFile = await jpgDownload;
  expect(jpgFile.suggestedFilename()).toBe("gravirovani-pavel-patricie-2026-08-12.jpg");
  const jpg = fs.readFileSync((await jpgFile.path())!);
  expect(jpegSize(jpg)).toEqual({ width: 1702, height: 1815 });
  // JFIF density: dots per inch, 144 × 144.
  expect([...jpg.subarray(13, 18)]).toEqual([1, 0, 144, 0, 144]);
});

test("a script face keeps the date in Playfair", async ({ page }) => {
  await page.goto(`/admin/e/${seed.weddingId}/engraving`);
  await page.getByLabel("Font").selectOption({ label: "Great Vibes (psací)" });
  await expect(page.getByText("Datum zůstává v Playfair Display")).toBeVisible();

  const textDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "SVG s textem" }).click();
  const svg = fs.readFileSync((await (await textDownload).path())!, "utf8");
  expect(svg).toContain('font-family="Great Vibes"');
  expect(svg).toContain('font-family="Playfair Display"');
  expect(svg).toContain(">12. 8. 2026</text>");
});
