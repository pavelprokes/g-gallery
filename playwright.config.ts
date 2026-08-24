import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

const PORT = 3000;
const baseURL = `http://127.0.0.1:${PORT}`;

/**
 * `next build`/`next start` run with NODE_ENV=production, under which
 * Next.js loads `.env.production.local` ahead of `.env` — and this repo's
 * `.env.production.local` holds the *real* production Supabase credentials
 * (docs/VERCEL-ENV.md), not the local Docker stack's. Left alone, `pnpm
 * test:e2e` would build a server that talks to production the moment it
 * starts, before a single test runs.
 *
 * Next.js does not let a `.env*` file override a variable the process
 * already had set before it started (documented precedence), so parsing
 * `.env` here and passing the result as `webServer.env` pins every var this
 * repo's `.env` defines to the local stack for the whole E2E run,
 * regardless of what `.env.production.local` contains.
 */
const localEnv = loadEnv({ path: ".env" }).parsed ?? {};

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  // Pins the default browser locale to Czech (Accept-Language + Intl), so
  // existing specs asserting on Czech UI text keep passing under the
  // Accept-Language-based locale autodetection (src/i18n/request.ts) — only
  // e2e/locale-switch.spec.ts overrides this per-test to exercise English.
  use: { baseURL, trace: "on-first-retry", locale: "cs-CZ" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-safari", use: { ...devices["iPhone 14"] } },
    // Low-end-Android stand-in: CPU/network throttling (see e2e/fixtures.ts)
    // applied only within the gallery/lightbox spec, since that's the flow
    // this is meant to stress (justified-grid layout, lazy-loaded tiles,
    // lightbox navigation). CDP throttling is chromium-only, so this needs
    // its own Chromium-based device rather than reusing mobile-safari.
    {
      name: "mobile-chrome-throttled",
      testMatch: /gallery-view\.spec\.ts/,
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: {
    command: "pnpm build && pnpm start",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: localEnv,
  },
});
