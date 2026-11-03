// The devices guests open galleries on, as Playwright can be them
// (docs/DEVICE-TESTING.md). What decides behaviour is the engine: WebKit is
// Safari and every browser on an iPhone, Chromium is Chrome, Edge and Samsung
// Internet, Gecko is Firefox. "Windows" is one of those engines with Windows'
// user agent, window size and pixel ratio; the real thing runs in CI
// (.github/workflows/devices.yml).
import { chromium, devices, firefox, webkit } from "@playwright/test";
import { NETWORKS, startThrottleProxy } from "./throttle-proxy.mjs";

const desktop = (width, height, deviceScaleFactor, userAgent) => ({
  viewport: { width, height },
  deviceScaleFactor,
  userAgent,
});
// A 1920×1080 screen at Windows' default 125 % scaling, minus the browser's own bars.
const WINDOWS_125 = [1536, 730, 1.25];

export const DEVICES = {
  iphone: { engine: "webkit", context: devices["iPhone 14"], label: "iPhone 14 (WebKit)" },
  "iphone-se": { engine: "webkit", context: devices["iPhone SE"], label: "iPhone SE (WebKit)" },
  ipad: { engine: "webkit", context: devices["iPad Pro 11"], label: "iPad Pro 11 (WebKit)" },
  android: {
    engine: "chromium",
    context: devices["Pixel 7"],
    cpu: 4,
    label: "Pixel 7, CPU 4× (Chromium)",
  },
  "android-low": {
    engine: "chromium",
    context: devices["Moto G4"],
    cpu: 6,
    label: "Moto G4, CPU 6× (Chromium)",
  },
  "mac-safari": {
    engine: "webkit",
    context: desktop(1440, 900, 2, devices["Desktop Safari"].userAgent),
    label: "Safari, Mac retina (WebKit)",
  },
  "mac-chrome": {
    engine: "chromium",
    channel: "chrome",
    context: desktop(1440, 900, 2),
    label: "Chrome, Mac retina",
  },
  "mac-firefox": {
    engine: "firefox",
    context: desktop(1440, 900, 2),
    label: "Firefox, Mac retina",
  },
  "win-chrome": {
    engine: "chromium",
    channel: "chrome",
    context: desktop(...WINDOWS_125, devices["Desktop Chrome"].userAgent),
    label: "Chrome, Windows 125 %",
  },
  "win-edge": {
    engine: "chromium",
    channel: "msedge",
    context: desktop(...WINDOWS_125, devices["Desktop Edge"].userAgent),
    label: "Edge, Windows 125 %",
  },
  "win-firefox": {
    engine: "firefox",
    context: desktop(...WINDOWS_125, devices["Desktop Firefox"].userAgent),
    label: "Firefox, Windows 125 %",
  },
  "win-laptop": {
    engine: "chromium",
    context: desktop(1366, 625, 1, devices["Desktop Chrome"].userAgent),
    label: "Chrome, 1366×768 laptop",
  },
};

/** Never counted: analytics and realtime are refused by the proxy (by host),
 * the gallery's own beacons are answered in the page (by path). Page views
 * stay read-only, and no route interception is needed — in Chromium that
 * turns the HTTP cache off, which would falsify every second visit. */
const BLOCKED_HOSTS = /(^|\.)(supabase\.co|analytics\.pavelprokes\.cz)$|umami/;
const BLOCKED_PATHS = String.raw`/_vercel/insights/|/api/g/[^/]+/(activity|identify)`;

/**
 * A fresh browser on `name`, behind its own throttled link.
 * @param {keyof typeof DEVICES} name
 * @param {{ net?: keyof typeof NETWORKS, cpu?: number, ect?: string }} [options]
 *   `ect` overrides `navigator.connection.effectiveType` (Chromium's own
 *   estimate is what the gallery's slow mode reads first).
 */
export async function openDevice(name, { net = "none", cpu, ect } = {}) {
  const device = DEVICES[name];
  if (!device) throw new Error(`unknown device ${name}: ${Object.keys(DEVICES).join(", ")}`);
  const proxy = await startThrottleProxy(NETWORKS[net], { block: BLOCKED_HOSTS });
  const engine = { chromium, firefox, webkit }[device.engine];
  const launch = {
    proxy: { server: `http://127.0.0.1:${proxy.port}`, bypass: "<-loopback>" },
    // Firefox leaves localhost off a proxy unless told otherwise.
    firefoxUserPrefs: { "network.proxy.allow_hijacking_localhost": true },
  };
  let browser;
  let channel = device.channel;
  try {
    browser = await engine.launch({ ...launch, channel });
  } catch (error) {
    if (!channel) throw error;
    // The branded build is missing here (Edge on a Mac): its engine still is.
    console.error(`${name}: ${channel} not installed, using Playwright's Chromium`);
    channel = undefined;
    browser = await engine.launch(launch);
  }
  const context = { ...device.context };
  delete context.defaultBrowserType;
  if (device.engine === "firefox") delete context.isMobile;
  const browserContext = await browser.newContext(context);
  await browserContext.addInitScript((pattern) => {
    const blocked = (target) => new RegExp(pattern).test(String(target?.url ?? target));
    const realFetch = window.fetch;
    window.fetch = (input, init) =>
      blocked(input)
        ? Promise.resolve(new Response(null, { status: 204 }))
        : realFetch(input, init);
    const realBeacon = navigator.sendBeacon?.bind(navigator);
    if (realBeacon) navigator.sendBeacon = (url, data) => blocked(url) || realBeacon(url, data);
  }, BLOCKED_PATHS);
  if (ect) {
    await browserContext.addInitScript((type) => {
      Object.defineProperty(navigator, "connection", {
        value: { effectiveType: type, saveData: false, addEventListener() {} },
        configurable: true,
      });
    }, ect);
  }
  const page = await browserContext.newPage();
  const rate = cpu ?? device.cpu ?? 1;
  // CPU throttling exists only in Chromium; WebKit and Firefox run at this Mac's speed.
  if (rate > 1 && device.engine === "chromium") {
    const cdp = await browserContext.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  }
  return {
    browser,
    page,
    device: { ...device, name, channel, cpu: device.engine === "chromium" ? rate : 1 },
    close: async () => {
      await browser.close();
      await proxy.close();
    },
  };
}
