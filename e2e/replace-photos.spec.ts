import fs from "node:fs";
import path from "node:path";
import { test, expect } from "./fixtures";

/**
 * A corrected export replaces the delivered photo it was made from
 * (docs/REPLACE-PHOTOS.md): paired by the camera's name, asked about first,
 * and the photo keeps its name, place and hearts while its file changes.
 */
const seed = JSON.parse(fs.readFileSync(path.join(__dirname, ".seed.json"), "utf8")) as {
  adminCookie: { name: string; value: string };
  replaceGalleryIds: Record<string, string>;
};

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ ...seed.adminCookie, url: baseURL! }]);
});

test("a corrected export replaces its photo and a new shot is filed by number", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const galleryId = seed.replaceGalleryIds[test.info().project.name]!;
  await page.goto(`/admin/g/${galleryId}`);

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
  const file = (name: string) => ({ name, mimeType: "image/jpeg", buffer: Buffer.from(jpeg) });

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
});
