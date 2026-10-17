import fs from "node:fs";
import path from "node:path";
import { test, expect } from "./fixtures";

/**
 * The photographer's video, end to end (docs/VIDEO.md): admin upload → MP4
 * and browser-made poster straight into MinIO → the guest grid's badge → the
 * lightbox's native player streaming with Range → the ZIP manifest naming the
 * MP4, not its poster.
 *
 * `E2E_SAMPLE_VIDEO` swaps in a real export for a local run; the committed
 * clip keeps the suite small.
 */
const seed = JSON.parse(fs.readFileSync(path.join(__dirname, ".seed.json"), "utf8")) as {
  adminCookie: { name: string; value: string };
  videoGalleries: Record<string, { galleryId: string; token: string; slug: string }>;
};

const CLIP = process.env.E2E_SAMPLE_VIDEO || path.join(__dirname, "media/svatba_0002_tanec.mp4");
const CLIP_NAME = path.basename(CLIP);
const WITH_LOCATION = path.join(__dirname, "media/s-polohou.mp4");

function galleryFor(project: string) {
  const gallery = seed.videoGalleries[project];
  if (!gallery) throw new Error(`no video gallery seeded for project ${project}`);
  return gallery;
}

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ ...seed.adminCookie, url: baseURL! }]);
});

test("a video with a location in it is refused before anything is uploaded", async ({ page }) => {
  // Read from the file's header, so this holds on every engine — no decoder involved.
  await page.goto(`/admin/g/${galleryFor(test.info().project.name).galleryId}`);
  await page.locator('input[type="file"][accept*="video/mp4"]').setInputFiles(WITH_LOCATION);
  await expect(page.getByText(/video obsahuje polohu/).first()).toBeVisible();
  await expect(page.getByText("0/1 nahráno")).toBeVisible();
});

test("a video above 4K is refused by resolution, whatever its size", async ({ page }) => {
  // 5120 × 2880 in 5 kB: the limit is the picture, never the file (docs/VIDEO.md).
  await page.goto(`/admin/g/${galleryFor(test.info().project.name).galleryId}`);
  await page
    .locator('input[type="file"][accept*="video/mp4"]')
    .setInputFiles(path.join(__dirname, "media/nad-4k.mp4"));
  await expect(page.getByText(/vyšší rozlišení než 4K/).first()).toBeVisible();
});

test.describe("upload and playback", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(({ browserName }) => {
    // Playwright's Chromium is built without the proprietary H.264 decoder
    // (real Chrome has it), so it cannot draw the poster. WebKit can.
    test.skip(browserName === "chromium", "Playwright's Chromium has no H.264 decoder");
  });

  test("the photographer uploads an MP4 and sees it marked in the admin", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(`/admin/g/${galleryFor(test.info().project.name).galleryId}`);
    await page.locator('input[type="file"][accept*="video/mp4"]').setInputFiles(CLIP);
    await expect(page.getByText("1/1 nahráno")).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText(/▶ Video · \d+:\d{2}/)).toBeVisible();
  });

  test("a guest sees a play badge, plays it in the lightbox, and downloads the MP4", async ({
    page,
    request,
  }) => {
    const { token, slug } = galleryFor(test.info().project.name);
    await page.goto(`/g/${token}/${slug}`);

    const tile = page.getByRole("button", {
      name: new RegExp(`Přehrát video ${CLIP_NAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
    });
    await expect(tile).toBeVisible();
    // Placed by its file name between svatba_0001 and svatba_0003 (docs/PHOTO-ORDER.md).
    const order = await page
      .getByRole("button", { name: /^(Otevřít|Přehrát video) / })
      .evaluateAll((tiles) => tiles.map((el) => el.getAttribute("aria-label")));
    if (!process.env.E2E_SAMPLE_VIDEO) {
      expect(order.map((label) => label?.match(/svatba_\d{4}/)?.[0])).toEqual([
        "svatba_0001",
        "svatba_0002",
        "svatba_0003",
      ]);
    }

    await tile.click();
    const dialog = page.getByRole("dialog");
    const video = dialog.locator("video");
    await expect(video).toBeVisible();
    // A film cannot be printed.
    await expect(dialog.getByRole("button", { name: /tisk/i })).toHaveCount(0);

    const src = await video.getAttribute("src");
    expect(src).toMatch(/\.mp4$/);
    expect(await video.getAttribute("poster")).toBeTruthy();

    // Seeking needs Range; Safari will not play without a 206.
    const ranged = await request.get(src!, { headers: { Range: "bytes=0-99" } });
    expect(ranged.status()).toBe(206);
    expect(ranged.headers()["content-type"]).toBe("video/mp4");

    await dialog.getByRole("button", { name: "Přehrát video" }).click();
    await expect
      .poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime), { timeout: 15_000 })
      .toBeGreaterThan(0);

    // Leaving the video stops it: the element is gone, not merely hidden.
    await page.keyboard.press("Escape");
    await expect(page.locator("video")).toHaveCount(0);

    // The archive manifest names the MP4 — never its poster.
    const photos = (await (await request.get(`/api/g/${token}/photos`)).json()) as {
      items: { id: string; video: { key: string } | null }[];
    };
    const item = photos.items.find((photo) => photo.video);
    expect(item).toBeTruthy();
    const zip = await request.post(`/api/g/${token}/zip`, { data: { photoIds: [item!.id] } });
    expect(zip.ok()).toBe(true);
    const { manifest } = (await zip.json()) as { manifest: string };
    const payload = JSON.parse(
      Buffer.from(manifest.split(".")[0]!, "base64url").toString("utf8"),
    ) as { entries: { key: string; name: string }[] };
    expect(payload.entries).toHaveLength(1);
    expect(payload.entries[0]!.key).toBe(item!.video!.key);
    expect(payload.entries[0]!.name).toBe(CLIP_NAME);
  });
});
