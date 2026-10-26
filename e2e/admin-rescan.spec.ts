import fs from "node:fs";
import path from "node:path";
import { test, expect } from "./fixtures";

/**
 * The bulk face scan (docs/SOCIAL-VIDEO.md §4, "The whole gallery"): reached
 * from the overview, it lists what the gallery pages would scan on their own.
 * Not started here — a scan saves faces, and other specs read the seed's.
 */
const seed = JSON.parse(fs.readFileSync(path.join(__dirname, ".seed.json"), "utf8")) as {
  adminCookie: { name: string; value: string };
};

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ ...seed.adminCookie, url: baseURL! }]);
});

test("the overview links the bulk scan, which counts what is left", async ({ page }) => {
  await page.goto("/admin");
  await page.getByRole("link", { name: "Přepočet fotek" }).click();
  await expect(page).toHaveURL(/\/admin\/prepocet$/);
  await expect(page.getByRole("heading", { level: 1, name: "Přepočet fotek" })).toBeVisible();
  // The seed holds photos never searched for faces.
  await expect(page.getByText(/^K přepočtu: \d+ fot/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Přepočítat vše" })).toBeEnabled();
});
