// Load budget of a live gallery on a slow phone (docs/GALLERY-LOADING.md).
//
//   node scripts/perf-gallery.mjs <gallery url> [--hash=ceremony] [--photo=<id>] [--runs=3]
//
// Opens the gallery as Chromium on an emulated phone (Slow 4G, CPU 4×) and
// reports, per scenario, the median of `--runs`: when the first tile and the
// lightbox photo appear, how many images and `/photos` pages were requested,
// and how many other images went out before the linked photo. Read-only page
// views: analytics, activity beacons and presence are aborted, so the
// gallery's view counts do not move. Without `--photo` it links the photo at
// 60 % of the gallery, which is past the first page in any real wedding.
import { chromium } from "@playwright/test";

const args = Object.fromEntries(
  process.argv.slice(3).map((arg) => {
    const [key, value] = arg.replace(/^--/, "").split("=");
    return [key, value ?? "1"];
  }),
);
const galleryUrl = URL.canParse(process.argv[2] ?? "") ? new URL(process.argv[2]) : null;
const token = galleryUrl?.pathname.split("/")[2];
// A /g/ link only: its token is the one the photos API takes.
if (!galleryUrl?.pathname.startsWith("/g/") || !token) {
  console.error(
    "usage: node scripts/perf-gallery.mjs <https://…/g/{token}/{slug}> [--hash=] [--photo=] [--runs=]",
  );
  process.exit(1);
}
const runs = Number(args.runs ?? 3);
const base = `${galleryUrl.origin}${galleryUrl.pathname}`;
const PHOTOS_API = /\/api\/g\/[^/]+\/photos/;
const BLOCK = /umami|_vercel\/insights|\/api\/g\/[^/]+\/(activity|identify)|supabase\.co/;
const SLOW_4G = {
  latency: 562.5,
  downloadThroughput: (1.6e6 / 8) * 0.9,
  uploadThroughput: (750e3 / 8) * 0.9,
};
const CAP_MS = 45_000;

async function pickPhoto() {
  const ids = [];
  let cursor = null;
  do {
    const query = cursor ? `?cursor=${cursor}` : "";
    const page = await (await fetch(`${galleryUrl.origin}/api/g/${token}/photos${query}`)).json();
    ids.push(...page.items.map((item) => item.id));
    cursor = page.nextCursor;
  } while (cursor);
  return ids[Math.floor(ids.length * 0.6)];
}

async function measure(url, isPhoto) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.route(BLOCK, (route) => route.abort());
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, ...SLOW_4G });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

  const t0 = Date.now();
  const images = new Map();
  const order = [];
  let pages = 0;
  cdp.on("Network.requestWillBeSent", (event) => {
    if (event.type === "Image") {
      const record = { url: event.request.url, end: null, bytes: 0 };
      images.set(event.requestId, record);
      order.push(record);
    } else if (PHOTOS_API.test(event.request.url)) {
      pages += 1;
    }
  });
  cdp.on("Network.loadingFinished", (event) => {
    const record = images.get(event.requestId);
    if (record) Object.assign(record, { end: Date.now() - t0, bytes: event.encodedDataLength });
  });
  // A tile the grid unmounted mid-flight, or an image that failed, is done
  // too — otherwise a grid run waits out the whole cap for it.
  cdp.on("Network.loadingFailed", (event) => {
    const record = images.get(event.requestId);
    if (record) record.end = Date.now() - t0;
  });

  page.goto(url, { timeout: CAP_MS }).catch(() => {});
  let firstTile = null;
  let preview = null;
  let full = null;
  let fullSrc = null;
  while (Date.now() - t0 < CAP_MS) {
    await page.waitForTimeout(150);
    const now = Date.now() - t0;
    const state = await page
      .evaluate(() => {
        const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
        const shown = (img) => img.complete && img.naturalWidth > 0;
        const inDialog = dialog ? [...dialog.querySelectorAll("img")] : [];
        const fullImg = inDialog.find((img) => img.sizes === "100vw");
        const tiles = [...document.querySelectorAll("main ul img")].filter((img) => {
          const rect = img.getBoundingClientRect();
          return rect.bottom > 0 && rect.top < innerHeight && rect.width > 0;
        });
        return {
          preview: inDialog.some(shown),
          full: fullImg && shown(fullImg) ? fullImg.currentSrc : null,
          tile: tiles.some(shown),
        };
      })
      .catch(() => null);
    if (!state) continue;
    if (state.tile && firstTile === null) firstTile = now;
    if (state.preview && preview === null) preview = now;
    if (isPhoto && state.full) {
      full = now;
      fullSrc = state.full;
      break;
    }
    if (!isPhoto && now > 6000 && order.length > 0 && order.every((record) => record.end !== null))
      break;
  }
  await browser.close();

  const before = fullSrc ? order.findIndex((record) => record.url === fullSrc) : -1;
  return {
    firstTile,
    preview,
    full,
    imagesBeforePhoto: before >= 0 ? before : null,
    images: order.length,
    kB: Math.round(order.reduce((sum, record) => sum + record.bytes, 0) / 1024),
    pages,
  };
}

const median = (values) => {
  const numbers = values.filter((value) => typeof value === "number").sort((a, b) => a - b);
  return numbers.length ? numbers[Math.floor(numbers.length / 2)] : null;
};

const photo = args.photo ?? (await pickPhoto());
const scenarios = [
  ["grid", base, false],
  ...(args.hash ? [[`#${args.hash}`, `${base}#${args.hash}`, false]] : []),
  [`?foto=${photo}`, `${base}?foto=${photo}`, true],
];
const rows = [];
for (const [name, url, isPhoto] of scenarios) {
  const results = [];
  for (let run = 0; run < runs; run += 1) results.push(await measure(url, isPhoto));
  const row = { scenario: name };
  for (const key of Object.keys(results[0]))
    row[key] = median(results.map((result) => result[key]));
  rows.push(row);
  console.error(JSON.stringify({ scenario: name, results }));
}
console.table(rows);
