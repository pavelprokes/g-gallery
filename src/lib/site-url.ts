/**
 * The production origin (docs/VERCEL-ENV.md). Not env-driven: there is exactly
 * one deployed origin for this app, unlike `NEXT_PUBLIC_PHOTOS_BASE_URL` (the
 * CDN), which legitimately differs between local/preview/production. Shared by
 * `app/layout.tsx` (canonical/OG URLs) and printed-signage generation
 * (docs/GUEST-GALLERIES.md F7) — both need one fixed absolute origin, not the
 * request's own host, since a printed QR code has no "current request" to read.
 */
export const SITE_ORIGIN = "https://photos.svatebni-fotograf-cechy.cz";

/** The photographer's main site — portfolio, prices, booking. One place, so every link to it agrees. */
export const MAIN_SITE_URL = "https://svatebni-fotograf-cechy.cz/";
