import { test, expect, type Page } from "@playwright/test";

/**
 * The public slideshow maker (/video-z-fotek, docs/SLIDESHOW-MAKER.md): photos
 * checked and kept in the browser, an MP4 made from them. Playwright's
 * Chromium has no H.264 encoder, so the file here is VP9 — which is also the
 * path a visitor's browser without H.264 takes.
 */

/** Noisy JPEGs made in the page, so they are big enough to pass the size check. */
async function jpegs(page: Page, count: number, width: number, height: number) {
  const encoded = await page.evaluate(
    async ({ count, width, height }) => {
      const out: string[] = [];
      for (let i = 0; i < count; i++) {
        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext("2d")!;
        const pixels = ctx.createImageData(width, height);
        for (let p = 0; p < pixels.data.length; p += 4) {
          pixels.data[p] = (p * 7 + i * 40) % 256;
          pixels.data[p + 1] = Math.random() * 255;
          pixels.data[p + 2] = (i * 60) % 256;
          pixels.data[p + 3] = 255;
        }
        ctx.putImageData(pixels, 0, 0);
        const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = "";
        for (const b of bytes) binary += String.fromCharCode(b);
        out.push(btoa(binary));
      }
      return out;
    },
    { count, width, height },
  );
  return encoded.map((base64, i) => ({
    name: `foto-${String(i + 1).padStart(2, "0")}-${width}.jpg`,
    mimeType: "image/jpeg",
    buffer: Buffer.from(base64, "base64"),
  }));
}

test.describe("slideshow maker", () => {
  test("is an indexable page with its structured data", async ({ page }) => {
    await page.goto("/video-z-fotek");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Video ze svatebních fotek",
    );
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/video-z-fotek$/);
    const graph = JSON.parse(
      (await page.locator('script[type="application/ld+json"]').textContent()) ?? "{}",
    ) as { "@graph": { "@type": string }[] };
    expect(graph["@graph"].map((n) => n["@type"])).toEqual(["FAQPage", "WebApplication"]);

    const sitemap = await (await page.request.get("/sitemap.xml")).text();
    expect(sitemap).toContain("/video-z-fotek");
  });

  test("refuses small photos, then makes a video from the rest", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/video-z-fotek");
    const input = page.locator('input[type="file"]');

    await input.setInputFiles(await jpegs(page, 1, 900, 700));
    await expect(page.getByText("kratší strana má méně než 1000 px")).toBeVisible();

    await input.setInputFiles(await jpegs(page, 4, 1600, 1200));
    await expect(page.getByText("4 fotky", { exact: true })).toBeVisible({ timeout: 60_000 });
    const create = page.getByRole("button", { name: "Vytvořit video" });
    await expect(create).toBeEnabled({ timeout: 90_000 });

    await page.getByRole("button", { name: /16:9 na šířku/ }).click();
    await page.getByRole("button", { name: /Dynamické/ }).click();
    await create.click();

    const download = page.getByRole("link", { name: "Stáhnout video (MP4)" });
    await expect(download).toBeVisible({ timeout: 150_000 });
    await expect(download).toHaveAttribute("download", /^video-z-fotek-16x9-\d+s\.mp4$/);
    await expect(page.getByText(/formátu VP9/)).toBeVisible();

    await page.getByRole("button", { name: /Odebrat foto-01/ }).click();
    await expect(page.getByText("3 fotky", { exact: true })).toBeVisible();
    await expect(download).toBeHidden();
  });

  test("fits a phone without sideways scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/video-z-fotek");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
