import type { MetadataRoute } from "next";
import { SITE_ORIGIN } from "@/lib/site-url";

/**
 * `/` is the only page in this app meant to be found by search — everything
 * else is per-user private content (`/g/*`, `/s/*`), auth-gated (`/admin/*`,
 * `/sign-in`), or an API route, and each of those sets its own `noindex`
 * rather than appearing here.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: SITE_ORIGIN,
      changeFrequency: "monthly",
      priority: 1,
    },
  ];
}
