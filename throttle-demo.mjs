import { chromium, devices } from "@playwright/test";

const URL = "http://localhost:3000/g/27Itoi0Ogj44e0rwGBPB_g/kkk-2026-08-21";

const browser = await chromium.launch({ headless: false, args: ["--window-size=430,932"] });
const context = await browser.newContext({ ...devices["Pixel 7"] });
const page = await context.newPage();

const client = await context.newCDPSession(page);
// Heavier than the "mobile-chrome-throttled" e2e project on purpose: that
// profile (4Mbps/4x CPU) turned out to be fast enough that the lightbox's
// own next/prev preloading almost always won the race. This is closer to a
// real "Slow 3G" — needed to actually observe the >1.2s stale-photo case the
// new indicator targets.
await client.send("Network.emulateNetworkConditions", {
  offline: false,
  downloadThroughput: (500 * 1024) / 8, // 500 Kbps
  uploadThroughput: (500 * 1024) / 8,
  latency: 300, // ms
});
await client.send("Emulation.setCPUThrottlingRate", { rate: 6 }); // 6x slowdown

const t0 = Date.now();
let phase = "boot";
const events = []; // {phase, tOffset, width, key, status, bytes, durationMs}

function parseWidth(url) {
  const m = url.match(/rs:fit:(\d+):/) || url.match(/[?&]w=(\d+)/) || url.match(/width=(\d+)/);
  return m ? Number(m[1]) : null;
}
function shortKey(url) {
  try {
    const u = new URL(url);
    return decodeURIComponent(u.pathname.split("/").slice(-2).join("/"));
  } catch {
    return url;
  }
}

page.on("requestfinished", async (request) => {
  const rt = request.resourceType();
  if (rt !== "image") return;
  const url = request.url();
  let bytes = null;
  let durationMs = null;
  try {
    const res = await request.response();
    const buf = res ? await res.body().catch(() => null) : null;
    bytes = buf ? buf.length : null;
    const timing = request.timing();
    if (timing) durationMs = Math.round(timing.responseEnd - timing.requestStart);
  } catch {
    // response body unavailable (e.g. cached/opaque) — timing/size just stay null
  }
  events.push({
    phase,
    tOffset: Date.now() - t0,
    width: parseWidth(url),
    key: shortKey(url),
    bytes,
    durationMs,
  });
});

console.log("Navigating with throttling on (4x CPU, ~4Mbps/1Mbps/80ms)...");
await page.goto(URL, { waitUntil: "domcontentloaded" });

const grid = page.getByRole("list", { name: "Fotky v galerii" });
await grid.waitFor({ state: "visible" });
console.log(`Grid visible after ${Date.now() - t0}ms`);

const tiles = grid.locator('button[aria-label^="Otevřít"]');
phase = "grid:initial";
await page.waitForTimeout(2500);

console.log("Scrolling through the ~100-photo grid...");
phase = "grid:scroll";
for (let i = 0; i < 8; i++) {
  await page.mouse.wheel(0, 1600);
  await page.waitForTimeout(900);
  console.log(`  scroll ${i + 1}/8, tiles mounted: ${await tiles.count()}`);
}

await page.mouse.wheel(0, -20000);
await page.waitForTimeout(1000);

console.log("Opening lightbox on the first photo...");
phase = "lightbox:open";
await tiles.first().click();
await page.getByRole("dialog").waitFor({ state: "visible" });
await page.waitForTimeout(2000);

console.log("Paging forward through the slideshow, tap-pace, watching for the stale-spinner...");
phase = "lightbox:next";
const dialog = page.getByRole("dialog");
const spinner = dialog.locator(".animate-spin");
for (let i = 0; i < 8; i++) {
  const tClick = Date.now();
  await page.getByRole("button", { name: "Další" }).click();
  let firstSeenAt = null;
  for (let elapsed = 0; elapsed <= 3000; elapsed += 200) {
    await page.waitForTimeout(200);
    if ((await spinner.count()) > 0) {
      firstSeenAt = Date.now() - tClick;
      break;
    }
  }
  console.log(
    firstSeenAt != null
      ? `  next ${i + 1}/8: stale-spinner appeared ${firstSeenAt}ms after click`
      : `  next ${i + 1}/8: stale-spinner never appeared (loaded within 3s, or already cached)`,
  );
}

phase = "done";
await page.waitForTimeout(500);

console.log("\n=== per-image-request log ===");
for (const e of events) {
  console.log(
    `[${e.phase}] +${e.tOffset}ms  w=${e.width ?? "?"}  ${e.bytes ? (e.bytes / 1024).toFixed(0) + "KB" : "?"}  ${e.durationMs ?? "?"}ms  ${e.key}`,
  );
}

console.log("\n=== summary by phase ===");
const byPhase = {};
for (const e of events) {
  byPhase[e.phase] ??= { count: 0, bytes: 0, durations: [] };
  byPhase[e.phase].count++;
  if (e.bytes) byPhase[e.phase].bytes += e.bytes;
  if (e.durationMs != null) byPhase[e.phase].durations.push(e.durationMs);
}
for (const [p, s] of Object.entries(byPhase)) {
  const avg = s.durations.length
    ? Math.round(s.durations.reduce((a, b) => a + b, 0) / s.durations.length)
    : null;
  const max = s.durations.length ? Math.max(...s.durations) : null;
  console.log(
    `${p}: ${s.count} images, ${(s.bytes / 1024).toFixed(0)}KB total, avg ${avg}ms, max ${max}ms`,
  );
}

console.log("\nDemo done. Window stays open for manual poking — close it yourself when ready.");
await new Promise(() => {});
