import type { MetadataRoute } from "next";
import { SITE_ORIGIN } from "@/lib/site-url";

/**
 * Deliberately no `Disallow` for anything — not `/admin`, not `/g`, not `/s`
 * (docs/GUEST-GALLERIES.md §10). A disallowed path can never be fetched, so a
 * crawler that finds it linked somewhere can still list the bare URL; it just
 * never sees the per-page `noindex` that would keep it out entirely.
 * Crawlable-but-noindex is what actually keeps a page out of the index —
 * every non-public route in this app (`/admin/*`, `/sign-in`, `/g/*`, `/s/*`)
 * sets that itself, so `robots.txt` has nothing to add on top.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
  };
}
