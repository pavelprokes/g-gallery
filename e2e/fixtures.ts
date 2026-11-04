import { test as base, expect, type Page } from "@playwright/test";

/**
 * Extends the base `test` with CPU/network throttling on the
 * `mobile-chrome-throttled` project only — a low-end-Android stand-in (4x
 * CPU slowdown, ~4Mbps/1Mbps/80ms network) for specs that care how the
 * gallery grid and lightbox behave off a fast dev machine. CDP throttling is
 * chromium-only, so every other project runs unthrottled as before.
 */
export const test = base.extend({
  // Playwright's fixture callback is conventionally named `use`, but that
  // collides with eslint-plugin-react-hooks (which treats any call to an
  // identifier named `use` as React's `use()` hook) — renamed to sidestep it.
  page: async ({ page, browserName }, runTest, testInfo) => {
    if (testInfo.project.name === "mobile-chrome-throttled" && browserName === "chromium") {
      const client = await page.context().newCDPSession(page);
      await client.send("Network.emulateNetworkConditions", {
        offline: false,
        downloadThroughput: (4 * 1024 * 1024) / 8,
        uploadThroughput: (1 * 1024 * 1024) / 8,
        latency: 80,
      });
      await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    }
    await runTest(page);
  },
});

export { expect };

/**
 * Starts the download selection on the first photo the way the viewer's device
 * does: a click on the tile's checkbox with a mouse, a long press on the photo
 * on a touch screen — where the idle checkbox is not drawn at all
 * (`pointer-coarse:hidden`, so a tap on a tile corner opens the photo instead of
 * silently selecting it). Once selection is on, every checkbox is pinned and
 * clickable on both.
 */
export async function selectFirstPhoto(page: Page, isMobile: boolean): Promise<void> {
  if (!isMobile) {
    await page.getByRole("checkbox").first().click();
    return;
  }
  const tile = page
    .getByRole("list", { name: "Fotky v galerii" })
    .locator('button[aria-label^="Otevřít"]')
    .first();
  await tile.dispatchEvent("touchstart");
  // LONG_PRESS_MS is 450 in gallery-view.tsx; the touchend after it only
  // clears the already-fired timer.
  await page.waitForTimeout(600);
  await tile.dispatchEvent("touchend");
  await expect(page.getByRole("checkbox").first()).toHaveAttribute("aria-checked", "true");
}
