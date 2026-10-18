import fs from "node:fs";
import path from "node:path";
import { test, expect } from "./fixtures";

/**
 * The social video, end to end (docs/SOCIAL-VIDEO.md): photos uploaded through
 * the admin into MinIO → the video page proposes them → reordered by keyboard
 * and by dragging → faces looked for with the self-hosted MediaPipe → frames
 * encoded in the browser → an MP4 downloaded.
 *
 * Chromium only: WebCodecs encoding is what is under test, and Playwright's
 * Chromium has it (VP9 — it lacks H.264, which real Chrome has). The photos are
 * drawn in the page rather than committed: the pipeline is under test here,
 * not the detector's eye.
 */
const seed = JSON.parse(fs.readFileSync(path.join(__dirname, ".seed.json"), "utf8")) as {
  adminCookie: { name: string; value: string };
  socialVideoGalleryId: string;
};

test.beforeEach(async ({ context, baseURL }) => {
  test.skip(test.info().project.name !== "chromium", "WebCodecs encoding — one engine is enough");
  await context.addCookies([{ ...seed.adminCookie, url: baseURL! }]);
});

test("the photographer turns the gallery into a video and downloads it", async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto(`/admin/g/${seed.socialVideoGalleryId}`);

  // Two landscape photos and a portrait one, drawn and JPEG-encoded in the page.
  const photos = await page.evaluate(async () => {
    const draw = async (width: number, height: number, hue: number) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      const sky = ctx.createLinearGradient(0, 0, 0, height);
      sky.addColorStop(0, `hsl(${hue} 60% 75%)`);
      sky.addColorStop(1, `hsl(${hue + 40} 50% 30%)`);
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = `hsl(${hue + 180} 50% 50%)`;
      for (let i = 0; i < 12; i++) {
        ctx.beginPath();
        ctx.arc(((i * 0.37) % 1) * width, ((i * 0.61) % 1) * height, height / 12, 0, Math.PI * 2);
        ctx.fill();
      }
      const blob = await new Promise<Blob>((resolve) =>
        canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.85),
      );
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    };
    return [await draw(3000, 2000, 20), await draw(2000, 3000, 200), await draw(3000, 2000, 120)];
  });
  await page.locator('input[type="file"][accept*="image/jpeg"]').setInputFiles(
    photos.map((bytes, i) => ({
      name: `svatba_000${i + 1}.jpg`,
      mimeType: "image/jpeg",
      buffer: Buffer.from(bytes),
    })),
  );
  await expect(page.getByText("3/3 nahráno")).toBeVisible({ timeout: 90_000 });

  await page.getByRole("link", { name: "Video pro sítě" }).click();
  await expect(page.getByRole("heading", { name: "Video pro sítě" })).toBeVisible();

  // A gallery smaller than the video gets all of its photos proposed.
  const strip = page.getByRole("list", { name: "Pořadí fotek ve videu" });
  await expect(strip.getByRole("listitem")).toHaveCount(3);
  const handles = strip.getByRole("button", { name: /^Přesunout/ });
  const order = async () =>
    (await handles.evaluateAll((els) => els.map((el) => el.getAttribute("aria-label") ?? ""))).map(
      (label) => label.match(/svatba_\d{4}/)?.[0],
    );
  const proposed = await order();

  // Keyboard: the first photo moves one place on.
  await handles.first().focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(order).toEqual([proposed[1], proposed[0], proposed[2]]);
  await expect(handles.nth(1)).toBeFocused();

  // Mouse: the last tile dragged onto the first.
  const tiles = strip.getByRole("listitem");
  const from = (await tiles.nth(2).boundingBox())!;
  const to = (await tiles.nth(0).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
  const dragged = [proposed[2], proposed[1], proposed[0]];
  await expect.poll(order).toEqual(dragged);

  // The selection is a draft that survives a reload.
  await page.reload();
  await expect.poll(order).toEqual(dragged);

  // Photos fetched and faces looked for (none on these) before the preview plays.
  const create = page.getByRole("button", { name: /^Vytvořit video/ });
  await expect(create).toBeEnabled({ timeout: 120_000 });
  await create.click();

  const save = page.getByRole("link", { name: "Stáhnout MP4" });
  await expect(save).toBeVisible({ timeout: 180_000 });
  const [download] = await Promise.all([page.waitForEvent("download"), save.click()]);
  expect(download.suggestedFilename()).toMatch(/-9x16-15s\.mp4$/);
  const bytes = fs.readFileSync((await download.path())!);
  expect(bytes.subarray(4, 8).toString("latin1")).toBe("ftyp");
  expect(bytes.length).toBeGreaterThan(50_000);

  // This Chromium encodes VP9 only, and the gallery takes H.264 only.
  await expect(page.getByText(/umí jen VP9/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Přidat do galerie/ })).toHaveCount(0);
});
