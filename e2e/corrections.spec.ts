import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";

/**
 * The corrections mode (docs/CORRECTIONS.md): the couple opens it with the
 * link's PIN — every time — writes, edits and deletes corrections on photos,
 * and the photographer reads and resolves them in the admin. Guests on
 * another link never see any of it.
 */
const seed = JSON.parse(fs.readFileSync(path.join(__dirname, ".seed.json"), "utf8")) as {
  adminCookie: { name: string; value: string };
  correctionGalleries: Record<
    string,
    { galleryId: string; token: string; plainToken: string; slug: string; pin: string }
  >;
};

const galleryFor = (project: string) => {
  const gallery = seed.correctionGalleries[project];
  if (!gallery) throw new Error(`no corrections gallery seeded for ${project}`);
  return gallery;
};

const tile = (page: Page, index: number) =>
  page
    .getByRole("list", { name: "Fotky v galerii" })
    .locator('button[aria-label^="Otevřít"]')
    .nth(index);

async function enterMode(page: Page, pin: string) {
  await page.getByRole("button", { name: "Připomínky" }).click();
  const sheet = page.getByRole("dialog", { name: "PIN pro připomínky" });
  await sheet.getByRole("textbox").fill(pin);
  await sheet.getByRole("button", { name: "Vstoupit" }).click();
}

test.describe.configure({ mode: "serial" });

test("the couple writes, edits and deletes corrections behind the PIN", async ({ page }) => {
  const gallery = galleryFor(test.info().project.name);
  await page.goto(`/g/${gallery.token}/${gallery.slug}`);

  // A wrong PIN is refused and says so.
  await enterMode(page, "000000");
  const sheet = page.getByRole("dialog", { name: "PIN pro připomínky" });
  await expect(sheet.getByRole("alert")).toHaveText(/PIN nesedí/);
  await sheet.getByRole("textbox").fill(gallery.pin);
  await sheet.getByRole("button", { name: "Vstoupit" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Režim připomínek" })).toBeVisible();

  await tile(page, 0).click();
  const panel = page.getByRole("complementary", { name: "Připomínky k fotce" });
  await expect(panel).toContainText("K téhle fotce zatím nic");
  await panel
    .getByRole("textbox", { name: "Nová připomínka" })
    .fill("Vyretušovat skvrnu na šatech");
  await panel.getByRole("button", { name: "Označit místo" }).click();
  await page.locator('[aria-label^="Ťukni na místo ve fotce"]').click();
  await expect(panel.getByRole("button", { name: "Zrušit místo" })).toBeVisible();
  await panel.getByRole("button", { name: "Přidat" }).click();
  await expect(panel.getByRole("listitem")).toHaveCount(1);
  await expect(panel.getByRole("listitem")).toContainText("Vyretušovat skvrnu na šatech");

  await panel.getByRole("button", { name: "Upravit" }).click();
  await panel
    .getByRole("textbox", { name: "Upravit připomínku 1" })
    .fill("Vyretušovat skvrnu a srovnat horizont");
  await panel.getByRole("button", { name: "Uložit" }).click();
  await expect(panel.getByRole("listitem")).toContainText("srovnat horizont");

  // A second one, deleted again.
  await panel.getByRole("textbox", { name: "Nová připomínka" }).fill("Tohle smažu");
  await panel.getByRole("button", { name: "Přidat" }).click();
  await expect(panel.getByRole("listitem")).toHaveCount(2);
  await panel.getByRole("listitem").nth(1).getByRole("button", { name: "Smazat" }).click();
  await panel.getByRole("listitem").nth(1).getByRole("button", { name: "Smazat" }).click();
  await expect(panel.getByRole("listitem")).toHaveCount(1);

  // Each entry asks for the PIN again: a reload is out of the mode.
  await page.reload();
  await expect(page.getByRole("button", { name: "Připomínky" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(page.getByRole("status").filter({ hasText: "Režim připomínek" })).toHaveCount(0);
});

test("guests on another link never see the mode, and the API wants the PIN", async ({
  page,
  request,
}) => {
  const gallery = galleryFor(test.info().project.name);
  await page.goto(`/g/${gallery.plainToken}/${gallery.slug}`);
  await expect(tile(page, 0)).toBeVisible();
  await expect(page.getByRole("button", { name: "Připomínky" })).toHaveCount(0);

  const plain = await request.get(`/api/g/${gallery.plainToken}/corrections`);
  expect(plain.status()).toBe(403);
  const noSession = await request.get(`/api/g/${gallery.token}/corrections`);
  expect(noSession.status()).toBe(401);
});

test("the photographer reads and resolves them in the admin", async ({
  page,
  context,
  baseURL,
}) => {
  const gallery = galleryFor(test.info().project.name);
  await context.addCookies([{ ...seed.adminCookie, url: baseURL! }]);
  await page.goto(`/admin/g/${gallery.galleryId}`);
  await page.getByRole("link", { name: "Připomínky (1)" }).click();
  await expect(page).toHaveURL(/[?&]f=comments/);
  const list = page.getByRole("list", { name: "Připomínky klienta k svatba_0001_PPR1.jpg" });
  await expect(list).toContainText("srovnat horizont");
  // The spot the couple marked, on the whole photo.
  await expect(
    page.getByRole("img", { name: "Místa připomínek na svatba_0001_PPR1.jpg" }),
  ).toHaveCount(1);
  await list.getByRole("button", { name: "Označit vyřízené" }).click();
  // Resolved, it leaves the "open corrections" view and stays on the photo.
  await expect(list).toHaveCount(0);
  await page.goto(`/admin/g/${gallery.galleryId}`);
  await expect(
    page
      .getByRole("list", { name: "Připomínky klienta k svatba_0001_PPR1.jpg" })
      .getByRole("button", { name: /Vyřízeno ✓/ }),
  ).toBeVisible();
});
