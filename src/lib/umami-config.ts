// Umami (self-hosted, cookieless) configuration. Everything comes from env —
// nothing about the instance is hard-coded. Public values only: the website ID
// and tracker URL are visible in the page source by design.
export const UMAMI_URL = process.env.NEXT_PUBLIC_UMAMI_URL?.replace(/\/+$/, "") ?? "";
export const UMAMI_WEBSITE_ID = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID ?? "";
export const UMAMI_SCRIPT = process.env.NEXT_PUBLIC_UMAMI_SCRIPT || "stats.js";

/** Production deployment only, so dev and preview builds never pollute the stats. */
export function umamiEnabled(): boolean {
  return process.env.VERCEL_ENV === "production" && Boolean(UMAMI_URL && UMAMI_WEBSITE_ID);
}
