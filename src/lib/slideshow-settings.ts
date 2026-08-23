/**
 * How the party projection is paced (`src/components/slideshow.tsx`).
 *
 * One place to change it, because the right number depends on the room: a
 * quiet dinner wants longer, a dance floor wants shorter. Either edit the
 * defaults here, or set `NEXT_PUBLIC_SLIDESHOW_SECONDS` — it is a
 * `NEXT_PUBLIC_` variable, so it is baked in at build time and changing it
 * needs a redeploy either way (docs/VERCEL-ENV.md).
 */

/** Seconds each photo stays on screen. */
export const DEFAULT_SLIDESHOW_SECONDS = 6;

/** Length of the crossfade, as a fraction of the time on screen. */
const FADE_RATIO = 0.2;

/**
 * Guard rails, not preferences. Below a second the projection is a strobe;
 * above a minute it reads as frozen and someone starts looking for a remote.
 */
export const MIN_SLIDESHOW_SECONDS = 1;
export const MAX_SLIDESHOW_SECONDS = 60;

/** Fades never take longer than this, however slowly photos advance. */
const MAX_FADE_MS = 2_000;

export interface SlideshowTiming {
  advanceMs: number;
  fadeMs: number;
}

/**
 * Pure so the clamping is testable: a typo in an env var must not be able to
 * produce a zero interval, which would spin the timer as fast as the browser
 * allows in front of a room full of people.
 */
export function slideshowTiming(
  raw: string | undefined = process.env.NEXT_PUBLIC_SLIDESHOW_SECONDS,
): SlideshowTiming {
  const parsed = Number(raw);
  const seconds =
    raw !== undefined && raw !== "" && Number.isFinite(parsed) && parsed > 0
      ? Math.min(MAX_SLIDESHOW_SECONDS, Math.max(MIN_SLIDESHOW_SECONDS, parsed))
      : DEFAULT_SLIDESHOW_SECONDS;

  return {
    advanceMs: Math.round(seconds * 1000),
    // The fade has to finish well inside the interval, or a photo is still
    // arriving when the next one starts and the screen is never fully anything.
    fadeMs: Math.round(Math.min(MAX_FADE_MS, seconds * 1000 * FADE_RATIO)),
  };
}
