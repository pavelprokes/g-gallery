import fs from "node:fs";
import path from "node:path";
import type { APIRequestContext, Page } from "@playwright/test";
import { test, expect } from "./fixtures";

/**
 * A corrected export replaces the delivered photo it was made from
 * (docs/REPLACE-PHOTOS.md): paired by the camera's name, asked about first,
 * and the photo keeps its name, place and hearts while its file changes.
 */
const seed = JSON.parse(fs.readFileSync(path.join(__dirname, ".seed.json"), "utf8")) as {
  adminCookie: { name: string; value: string };
  replaceGalleries: Record<
    string,
    Record<"replaced" | "noBlur", { id: string; token: string; oldThumbhash: string }>
  >;
};

/** A corrected export: a real JPEG the browser decodes, and a colour of its own. */
async function correctedExport(page: Page) {
  const jpeg = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 900;
    canvas.height = 600;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#c08040";
    ctx.fillRect(0, 0, 900, 600);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.85),
    );
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  return (name: string) => ({ name, mimeType: "image/jpeg", buffer: Buffer.from(jpeg) });
}

/** The row's blur, from what any guest's grid reads. */
async function thumbhashOf(request: APIRequestContext, token: string, fileName: string) {
  const { items } = (await (await request.get(`/api/g/${token}/photos`)).json()) as {
    items: { fileName: string; thumbhash: string | null }[];
  };
  return items.find((item) => item.fileName === fileName)!.thumbhash;
}

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ ...seed.adminCookie, url: baseURL! }]);
});

test("a corrected export replaces its photo and a new shot is filed by number", async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const gallery = seed.replaceGalleries[test.info().project.name]!.replaced;
  await page.goto(`/admin/g/${gallery.id}`);

  const file = await correctedExport(page);

  await page
    .locator('input[type="file"][accept*="image/jpeg"]')
    // Exported with bare camera names, as Lightroom does without a sequence.
    .setInputFiles([file("PPR1002.jpg"), file("PPR1500.jpg")]);

  const pairs = page.getByRole("list", { name: "Co se nahradí" });
  // Pre-selected, but a choice: each pair can be turned down on its own.
  await expect(page.getByLabel("Co nahradí PPR1002.jpg").locator("option:checked")).toHaveText(
    "nahradit svatba_0002_PPR1002.jpg",
  );
  await expect(pairs).toContainText("PPR1500.jpg → nová, zařadí se za svatba_0003_PPR1003.jpg");
  await page.getByRole("button", { name: "Nahradit a zařadit" }).click();
  await expect(page.getByText("2/2 nahráno")).toBeVisible({ timeout: 45_000 });

  // Three delivered + one new: the replaced one did not become a fourth.
  await expect(page.getByText(/· 4 fotky/)).toBeVisible();
  const replaced = page.getByRole("img", { name: "svatba_0002_PPR1002.jpg" });
  await expect(replaced).toHaveCount(1);
  // Its file is the new upload — a fresh key — and its heart is still on it.
  await expect(replaced).not.toHaveAttribute("src", /PPR1002/);
  await expect(page.getByText("♥ 1")).toBeVisible();
  await expect(page.getByRole("img", { name: "PPR1002.jpg", exact: true })).toHaveCount(0);
  // The new shot is stored under the delivered sequence, so it sorts in place.
  await expect(page.getByRole("img", { name: "svatba_0003_PPR1500.jpg" })).toHaveCount(1);

  // A new picture, a new blur (docs/GALLERY-LOADING.md).
  const blur = await thumbhashOf(request, gallery.token, "svatba_0002_PPR1002.jpg");
  expect(blur).toMatch(/^[A-Za-z0-9+/]{18,36}={0,2}$/);
  expect(blur).not.toBe(gallery.oldThumbhash);
});

test("a replacement whose browser drew no blur drops the old picture's", async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const gallery = seed.replaceGalleries[test.info().project.name]!.noBlur;
  // A browser that could not compute one sends none; its colour is kept, its
  // blur must not be: a corrected export can be a different crop. In the page,
  // not `page.route`: with interception on, WebKit's signed PUT is refused.
  await page.addInitScript(() => {
    const realFetch = window.fetch;
    window.fetch = (input, init) => {
      if (String(input).includes("/api/uploads/confirm") && typeof init?.body === "string") {
        const body = JSON.parse(init.body) as Record<string, unknown>;
        delete body.thumbhash;
        return realFetch(input, { ...init, body: JSON.stringify(body) });
      }
      return realFetch(input, init);
    };
  });
  await page.goto(`/admin/g/${gallery.id}`);
  const file = await correctedExport(page);
  await page
    .locator('input[type="file"][accept*="image/jpeg"]')
    .setInputFiles([file("PPR1002.jpg")]);
  await page.getByRole("button", { name: /^Nahradit/ }).click();
  await expect(page.getByText("1/1 nahráno")).toBeVisible({ timeout: 45_000 });

  expect(await thumbhashOf(request, gallery.token, "svatba_0001_PPR1001.jpg")).toBe(
    gallery.oldThumbhash,
  );
  expect(await thumbhashOf(request, gallery.token, "svatba_0002_PPR1002.jpg")).toBeNull();
});
