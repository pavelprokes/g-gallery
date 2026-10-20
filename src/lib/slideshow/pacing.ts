// The two rhythms of the public slideshow maker and the lengths each allows
// (docs/SLIDESHOW-MAKER.md §4). Every photo is always in the video, so the
// length is not a photo count: it is how fast they pass, and only lengths the
// rhythm can reach with this many photos are offered.

import { FORMATS, type Aspect, type VideoFormat } from "@/lib/social-video/camera";
import { NORMAL_PACING, type Pacing } from "@/lib/social-video/timeline";

export type Mode = "normal" | "dynamic";

export const PACINGS: Record<Mode, Pacing> = {
  normal: NORMAL_PACING,
  dynamic: { first: 1.6, slide: 1.2, minSlide: 0.9, maxSlide: 1.8, fade: 0.2, hold: 0.4 },
};

/** The lengths offered, in seconds, where the rhythm reaches them. */
export const LENGTH_STEPS = [10, 15, 20, 30, 45, 60, 90, 120, 150, 180] as const;

function span(count: number, pacing: Pacing) {
  if (count <= 1) return { min: pacing.first, max: pacing.first, natural: pacing.first };
  const at = (pace: number) => pacing.first + (count - 1) * pace;
  return { min: at(pacing.minSlide), max: at(pacing.maxSlide), natural: at(pacing.slide) };
}

/** The lengths `count` photos can fill at this rhythm, shortest first — never empty. */
export function lengthOptions(count: number, mode: Mode): number[] {
  const { min, max, natural } = span(count, PACINGS[mode]);
  const steps = LENGTH_STEPS.filter((s) => s >= min && s <= max);
  return steps.length > 0 ? steps : [Math.round(natural)];
}

/** The offered length nearest the rhythm's own pace. */
export function defaultLength(count: number, mode: Mode): number {
  const { natural } = span(count, PACINGS[mode]);
  return lengthOptions(count, mode).reduce((best, s) =>
    Math.abs(s - natural) < Math.abs(best - natural) ? s : best,
  );
}

/** `wanted` when still offered, else the default — after photos come or go. */
export function keptLength(wanted: number, count: number, mode: Mode): number {
  return lengthOptions(count, mode).includes(wanted) ? wanted : defaultLength(count, mode);
}

/** The dynamic rhythm also pushes in further — short slides need a visible move. */
export function formatFor(aspect: Aspect, mode: Mode): VideoFormat {
  const format = FORMATS[aspect];
  return mode === "dynamic" ? { ...format, maxZoom: format.maxZoom + 0.15 } : format;
}
