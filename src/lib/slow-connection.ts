/**
 * Whether the viewer's connection is slow enough for the lightbox to ask for
 * less (docs/GALLERY-LOADING.md): a 1080 px photo instead of 1920/2560, and
 * one neighbour warmed instead of three.
 *
 * Chromium says so itself (`navigator.connection`: Save-Data, or an effective
 * type of 3G or worse). Safari and Firefox have no such API — and an iPhone is
 * most of the guests — so there the photos already fetched answer instead: the
 * median time of the first few images from the photo host.
 *
 * ponytail: a heuristic. Durations include queueing, so a page that asked for
 * many images at once reads slower than its link is; with the on-screen
 * images fetched first (docs/GALLERY-LOADING.md) that is mostly the link.
 */

export interface ConnectionSignals {
  saveData?: boolean;
  effectiveType?: string;
  /** Durations (ms) of the first images fetched from the photo host. */
  imageDurations: number[];
}

const SLOW_TYPES = new Set(["slow-2g", "2g", "3g"]);
/** How many images the median is taken over, and how many it needs. */
const SAMPLES = 6;
const MIN_SAMPLES = 4;
/** A ~50 kB grid thumbnail taking longer than this is a slow link. */
const SLOW_IMAGE_MS = 1500;

export function isSlowConnection(signals: ConnectionSignals): boolean {
  if (signals.saveData) return true;
  // The browser's own estimate, from the round trips it measured, beats ours.
  if (signals.effectiveType !== undefined) return SLOW_TYPES.has(signals.effectiveType);
  const durations = signals.imageDurations.slice(0, SAMPLES).toSorted((a, b) => a - b);
  if (durations.length < MIN_SAMPLES) return false;
  return durations[Math.floor(durations.length / 2)]! > SLOW_IMAGE_MS;
}

/** What this browser can tell about its connection right now. */
export function connectionSignals(photosBase: string | undefined): ConnectionSignals {
  const connection = (
    navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }
  ).connection;
  const imageDurations = photosBase
    ? performance
        .getEntriesByType("resource")
        .filter(
          (entry) =>
            (entry as PerformanceResourceTiming).initiatorType === "img" &&
            entry.name.startsWith(photosBase),
        )
        .map((entry) => entry.duration)
    : [];
  return {
    saveData: connection?.saveData,
    effectiveType: connection?.effectiveType,
    imageDurations,
  };
}

/**
 * The lightbox's `sizes` that makes the browser pick the 1080 px candidate on
 * any screen: the candidate chosen is the smallest at least `sizes` × the
 * device pixel ratio wide, so `1080 / dpr` lands on 1080 exactly — a width
 * already in the variant list, so no new billed transformation.
 */
export function slowLightboxSizes(devicePixelRatio: number): string {
  return `${Math.floor(1080 / Math.max(devicePixelRatio, 1))}px`;
}
