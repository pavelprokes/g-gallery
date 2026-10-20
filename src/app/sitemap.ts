import type { MetadataRoute } from "next";
import { GUIDE_PATHS } from "@/lib/guide-path";
import { SITE_ORIGIN } from "@/lib/site-url";
import { SLIDESHOW_PATHS } from "@/lib/slideshow-path";

/**
 * `/`, the client guide (`/navod`, `/guide`, `/guide/<code>`) and the slideshow maker
 * (`/video-z-fotek`) are the only pages in this app
 * meant to be found by search — everything else is per-user private content (`/g/*`, `/s/*`), auth-gated (`/admin/*`,
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

/** The same rule for the guide: bump it when its copy really changes. */
const GUIDE_LAST_MODIFIED = "2026-10-20";

/** The same rule for the slideshow maker (docs/SLIDESHOW-MAKER.md). */
const SLIDESHOW_LAST_MODIFIED = "2026-10-20";

const guideLanguages = Object.fromEntries(
  Object.entries(GUIDE_PATHS).map(([locale, path]) => [locale, `${SITE_ORIGIN}${path}`]),
);

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: SITE_ORIGIN,
      lastModified: LANDING_LAST_MODIFIED,
      changeFrequency: "monthly",
      priority: 1,
    },
    ...Object.values(guideLanguages).map((url) => ({
      url,
      lastModified: GUIDE_LAST_MODIFIED,
      changeFrequency: "monthly" as const,
      priority: 0.8,
      alternates: { languages: guideLanguages },
    })),
    ...Object.values(SLIDESHOW_PATHS).map((path) => ({
      url: `${SITE_ORIGIN}${path}`,
      lastModified: SLIDESHOW_LAST_MODIFIED,
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
  ];
}
