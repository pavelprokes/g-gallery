import { test, expect } from "./fixtures";
import fs from "node:fs";
import path from "node:path";

/**
 * A print mark made without a connection is kept and saved once the
 * connection returns, instead of silently reverting (src/lib/print-queue.ts).
 * A bride counted 50 marks where the admin showed 28; a mark that vanishes
 * when the signal drops is the failure this pins down.
 */

const seed = JSON.parse(fs.readFileSync(path.join(__dirname, ".seed.json"), "utf8")) as {
  token: string;
  slug: string;
};

test("a print mark made offline is saved when the connection returns", async ({
  page,
  context,
}) => {
  await page.goto(`/g/${seed.token}/${seed.slug}`);
  const grid = page.getByRole("list", { name: "Fotky v galerii" });
  await grid.locator('button[aria-label^="Otevřít"]').first().click();

  await context.setOffline(true);
  await page.getByRole("dialog").getByRole("button", { name: "Označit k tisku" }).click();
  await page.getByRole("button", { name: "Přeskočit" }).click();

  const summary = page.getByRole("status").filter({ hasText: "K tisku:" });
  await expect(summary).toContainText("K tisku: 1 fotka · 1 ks");
  await expect(summary).toContainText("Bez připojení – 1 změna čeká");

  await context.setOffline(false);
  await expect(summary).toContainText("Uloženo", { timeout: 15_000 });

  // Now from the server, not from this tab's memory or its stored queue.
  await page.reload();
  await expect(summary).toContainText("K tisku: 1 fotka · 1 ks");
  await expect(summary).toContainText("Uloženo");

  // Leave the shared seed gallery as it was.
  await grid.locator('button[aria-label^="Otevřít"]').first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Ubrat kopii k tisku" }).click();
  await expect(summary).toContainText("K tisku: 0 fotek · 0 ks");
});
