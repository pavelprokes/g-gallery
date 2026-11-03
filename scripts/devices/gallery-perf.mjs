// How a live gallery loads on the devices guests use (docs/DEVICE-TESTING.md).
//
//   node scripts/devices/gallery-perf.mjs <gallery link> [<link>…]
//     --devices=iphone,android,mac-safari,mac-firefox,win-chrome   (scripts/devices/devices.mjs)
//     --net=slow4g          none | 4g | slow4g | 3g — the same link for every engine
//     --runs=1              median of this many cold runs
//     --scroll=0            then scroll a screen down this many times, timing each screen
//     --browse=0            on a ?foto= link: then press "next" this many times …
//     --interval=3000       … this many ms apart (400 = a hurried viewer)
//     --ect=3g              tell the page this effective type (what a real slow phone reports)
//     --cap=60000           give up on a page after this long
//     --json=file.jsonl     append every run, unaggregated
//     --md                  print a Markdown table (CI step summary) instead of console.table
//
// Per link and device: first content paint, the first tile and the whole
// first screen of tiles drawn, the lightbox's preview and full photo, how many
// images and kB went out and how many before the photo or the screen was
// complete, and the `/photos` requests. Read-only page views: analytics,
// beacons and presence never leave the browser (devices.mjs).
import fs from "node:fs";
import { DEVICES, openDevice } from "./devices.mjs";
import { NETWORKS } from "./throttle-proxy.mjs";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((arg) => arg.startsWith("--"))
    .map((arg) => {
      const [key, ...value] = arg.slice(2).split("=");
      return [key, value.length ? value.join("=") : "1"];
    }),
);
const links = process.argv.slice(2).filter((arg) => !arg.startsWith("--") && URL.canParse(arg));
const names = (args.devices ?? "iphone,android,mac-safari,mac-firefox,win-chrome").split(",");
if (links.length === 0 || names.some((name) => !DEVICES[name])) {
  console.error(
    `usage: node scripts/devices/gallery-perf.mjs <link>… [--devices=${Object.keys(DEVICES).join(",")}]`,
  );
  process.exit(1);
}
const net = args.net ?? "slow4g";
// A typo would otherwise measure an unthrottled link under the typed name.
if (!(net in NETWORKS)) {
  console.error(`--net must be one of: ${Object.keys(NETWORKS).join(", ")}`);
  process.exit(1);
}
const runs = Number(args.runs ?? 1);
const cap = Number(args.cap ?? 60_000);
const scrolls = Number(args.scroll ?? 0);
const browse = Number(args.browse ?? 0);
const interval = Number(args.interval ?? 3000);
const PHOTOS_API = /\/api\/g\/[^/]+\/photos/;

/** What is on screen right now, read in the page. */
function screenState() {
  const drawn = (img) => img.complete && img.naturalWidth > 0;
  // A photo's full size, not the thumbnail under it: a width variant of 1080 up.
  const full = (src) =>
    !src.includes(".thumb.") && Number(src.match(/width=(\d+)/)?.[1] ?? 1e4) >= 1080;
  const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
  // The page's server-drawn placeholder counts too: it is what the viewer sees.
  const layer = [...document.querySelectorAll('body div[aria-hidden="true"].fixed img')];
  const photoImgs = [...(dialog ? dialog.querySelectorAll("img") : []), ...layer];
  const tiles = dialog
    ? []
    : [...document.querySelectorAll("main ul li button")].filter((button) => {
        if (button.closest("nav")) return false;
        const rect = button.getBoundingClientRect();
        return rect.width >= 48 && rect.height >= 48 && rect.bottom > 0 && rect.top < innerHeight;
      });
  const tilesDrawn = tiles.filter((tile) => [...tile.querySelectorAll("img")].some(drawn)).length;
  const top = photoImgs.find((img) => img.classList.contains("z-10")) ?? photoImgs.at(-1);
  // A film shows its poster on the <video>, no <img>.
  const video = dialog?.querySelector("video");
  return {
    fcp: performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null,
    dialog: !!dialog,
    foto: new URLSearchParams(location.search).get("foto"),
    preview: photoImgs.some(drawn),
    full: photoImgs.find((img) => drawn(img) && full(img.currentSrc))?.currentSrc ?? null,
    topSrc: video ? video.poster : top && drawn(top) ? top.currentSrc : null,
    tiles: tiles.length,
    tilesDrawn,
    tileSrcs: tiles.flatMap((tile) =>
      [...tile.querySelectorAll("img")].map((img) => img.currentSrc),
    ),
    // Every grid or highlight tile's image, on screen or not (the logo, the
    // cover and the lightbox are not tiles).
    allTileSrcs: [...document.querySelectorAll("main ul li button img")].map(
      (img) => img.currentSrc || img.src,
    ),
    effectiveType: navigator.connection?.effectiveType ?? null,
  };
}

/** Photo id → the file name its images carry, to tell which photo is drawn. */
async function photoKeys(link) {
  const url = new URL(link);
  const token = url.pathname.split("/")[2];
  const keys = new Map();
  // Without the photos, every step would count as wrong.
  if (!url.pathname.startsWith("/g/")) throw new Error(`--browse needs a /g/ link: ${link}`);
  let cursor = null;
  do {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    const response = await fetch(`${url.origin}/api/g/${token}/photos${query}`);
    if (!response.ok) throw new Error(`photos API ${response.status} for ${link}`);
    const page = await response.json();
    for (const item of page.items ?? [])
      keys.set(
        item.id,
        item.objectKey
          .split("/")
          .pop()
          .replace(/\.\w+$/, ""),
      );
    cursor = page.nextCursor;
  } while (cursor);
  return keys;
}

async function measure(link, name, keys) {
  const { page, device, close } = await openDevice(name, {
    net,
    ect: args.ect,
  });
  try {
    return await run(page, device, link, keys);
  } finally {
    await close();
  }
}

async function run(page, device, link, keys) {
  const t0 = Date.now();
  const since = () => Date.now() - t0;
  const images = [];
  const records = new Map();
  let pages = 0;
  page.on("request", (request) => {
    if (request.resourceType() === "image") {
      const record = { url: request.url(), start: since(), end: null, bytes: 0 };
      records.set(request, record);
      images.push(record);
    } else if (PHOTOS_API.test(request.url())) pages += 1;
  });
  page.on("requestfinished", async (request) => {
    const record = records.get(request);
    if (!record) return;
    record.end = since();
    record.bytes = await request
      .sizes()
      .then((sizes) => sizes.responseBodySize)
      .catch(() => 0);
  });
  // A tile unmounted mid-flight, or an image that failed, is done too.
  page.on("requestfailed", (request) => {
    const record = records.get(request);
    if (record) record.end = since();
  });
  const read = () => page.evaluate(screenState).catch(() => null);
  const isPhoto = new URL(link).searchParams.has("foto");
  const result = { device: device.label, link, net, cpu: device.cpu };

  page.goto(link, { waitUntil: "domcontentloaded", timeout: cap }).catch(() => {});
  let state = null;
  while (since() < cap) {
    await page.waitForTimeout(150);
    state = (await read()) ?? state;
    if (!state) continue;
    result.fcp ??= state.fcp && Math.round(state.fcp);
    if (state.tilesDrawn > 0) result.firstTile ??= since();
    if (state.tiles > 0 && state.tilesDrawn === state.tiles && !result.screen) {
      result.screen = since();
      result.screenTiles = state.tiles;
      // What shared the link with the screen: images off it requested before
      // the screen's last image had arrived.
      const onScreen = new Set(state.tileSrcs);
      const offScreen = new Set(state.allTileSrcs.filter((src) => !onScreen.has(src)));
      const ends = images
        .filter((image) => onScreen.has(image.url))
        .map((image) => image.end ?? since());
      const screenEnd = ends.length > 0 ? Math.max(...ends) : null;
      // Unknown, not 0, when the screen's own images were not seen going out.
      result.offscreenBefore =
        screenEnd === null
          ? null
          : images.filter((image) => offScreen.has(image.url) && image.start < screenEnd).length;
    }
    if (state.preview) result.preview ??= since();
    if (state.full && !result.full) {
      result.full = since();
      const index = images.findIndex((image) => image.url === state.full);
      result.imagesBeforePhoto = index >= 0 ? index : null;
    }
    const done = isPhoto ? result.full : result.screen;
    // Then until every image asked for so far has arrived, for the totals.
    if (done && since() > done + 2000 && images.every((image) => image.end !== null)) break;
  }
  result.effectiveType = state?.effectiveType;
  result.images = images.length;
  result.kB = Math.round(images.reduce((sum, image) => sum + image.bytes, 0) / 1024);
  result.pages = pages;

  if (scrolls > 0 && !isPhoto) {
    // A screen down at a time, the next once this one is complete (or 15 s).
    result.scrollScreens = [];
    for (let step = 0; step < scrolls; step += 1) {
      const before = images.length;
      // Not the mouse wheel: mobile WebKit has none.
      await page.evaluate(() => scrollBy(0, innerHeight));
      const start = Date.now();
      let complete = null;
      while (Date.now() - start < 15_000) {
        await page.waitForTimeout(100);
        const now = await read();
        if (now && now.tiles > 0 && now.tilesDrawn === now.tiles) {
          complete = Date.now() - start;
          break;
        }
      }
      result.scrollScreens.push({ ms: complete, images: images.length - before });
    }
  }

  if (browse > 0 && isPhoto && result.full) {
    // "Next" every `interval` ms. Per step: how soon the photo the counter is
    // on was drawn on top, and whether it still was not by the next press.
    await page.waitForTimeout(2500);
    result.steps = [];
    let wrong = 0;
    for (let step = 0; step < browse; step += 1) {
      const start = Date.now();
      await page.keyboard.press("ArrowRight");
      let shown = null;
      let now = null;
      while (Date.now() - start < interval) {
        await page.waitForTimeout(50);
        now = (await read()) ?? now;
        const want = now && keys.get(now.foto);
        if (shown === null && want && now.topSrc?.includes(want)) shown = Date.now() - start;
      }
      const want = now && keys.get(now.foto);
      if (!(want && now.topSrc?.includes(want))) wrong += 1;
      result.steps.push(shown);
    }
    result.wrong = wrong;
    result.wrongSteps = `${wrong}/${browse}`;
  }
  return result;
}

const median = (values) => {
  const numbers = values.filter((value) => typeof value === "number").sort((a, b) => a - b);
  return numbers.length ? numbers[Math.floor((numbers.length - 1) / 2)] : null;
};
const SUMMARY = ["fcp", "firstTile", "screen", "screenTiles", "offscreenBefore", "preview", "full"];
const COUNTS = ["imagesBeforePhoto", "images", "kB", "pages"];

const rows = [];
for (const link of links) {
  const keys = browse > 0 ? await photoKeys(link) : new Map();
  for (const name of names) {
    const results = [];
    for (let run = 0; run < runs; run += 1) {
      try {
        const result = await measure(link, name, keys);
        results.push(result);
        if (args.json) fs.appendFileSync(args.json, `${JSON.stringify(result)}\n`);
      } catch (error) {
        console.error(`${name} ${link}: ${String(error).split("\n")[0]}`);
      }
    }
    if (results.length === 0) continue;
    const row = {
      device: results[0].device,
      link: new URL(link).search + new URL(link).hash || "/",
    };
    for (const key of [...SUMMARY, ...COUNTS]) {
      const value = median(results.map((result) => result[key]));
      if (value !== null) row[key] = value;
    }
    // Across every run, like the columns above: each screen's median, and the
    // steps of all runs together — one never shown counts as the whole interval.
    const screens = results.map((result) => result.scrollScreens ?? []);
    if (screens[0].length > 0) {
      row.scroll = screens[0]
        .map((_, step) => median(screens.map((list) => list[step]?.ms ?? 15_000)))
        .join(" / ");
    }
    const steps = results.flatMap((result) => result.steps ?? []);
    if (steps.length > 0) {
      row.steps = median(steps.map((ms) => ms ?? interval));
      row.wrongSteps = `${results.reduce((sum, result) => sum + result.wrong, 0)}/${steps.length}`;
    }
    const effectiveType = results.at(-1).effectiveType;
    if (effectiveType) row.ect = effectiveType;
    rows.push(row);
    console.error(JSON.stringify(row));
  }
}

if (args.md) {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  console.log(
    `Network: ${net}${args.ect ? `, effectiveType ${args.ect}` : ""}; ms unless noted.\n`,
  );
  console.log(`| ${columns.join(" | ")} |\n| ${columns.map(() => "---").join(" | ")} |`);
  for (const row of rows)
    console.log(`| ${columns.map((column) => row[column] ?? "").join(" | ")} |`);
} else console.table(rows);
