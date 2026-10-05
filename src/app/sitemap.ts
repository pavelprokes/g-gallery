import type { MetadataRoute } from "next";
import { SITE_ORIGIN } from "@/lib/site-url";

/**
 * `/` is the only page in this app meant to be found by search — everything
 * else is per-user private content (`/g/*`, `/s/*`), auth-gated (`/admin/*`,
 * `/sign-in`), or an API route, and each of those sets its own `noindex`
 * rather than appearing here.
 */
/**
 * When the content of `/` last really changed — its catalog copy or its
 * structured data. Bump it with such a change, never per deploy: Google only
 * trusts a `lastmod` that is consistently accurate, and one that moves on
 * every build gets ignored (docs/AI-VISIBILITY.md).
 */
const LANDING_LAST_MODIFIED = "2026-10-05";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: SITE_ORIGIN,
      lastModified: LANDING_LAST_MODIFIED,
      changeFrequency: "monthly",
      priority: 1,
    },
  ];
}
