// When each slide of a social video is on screen (docs/SOCIAL-VIDEO.md §5.7).
// A slide starts every `slide` seconds and stays until the next one has faded
// in over it, so both keep moving through the crossfade; the first slide gets
// longer, the last one comes to rest before the end.

export const FPS = 30;

/** The first slide is on alone this long before the second starts. */
export const FIRST_SECONDS = 3;
/** A slide's own time before the next starts, unless the length asks for
 * another (between the bounds below). */
export const SLIDE_SECONDS = 2.5;
const MIN_SLIDE_SECONDS = 1.8;
const MAX_SLIDE_SECONDS = 4;
/** The next slide fades in over this. */
export const FADE_SECONDS = 0.45;
/** The last slide holds still this long at the end. */
export const HOLD_SECONDS = 0.5;

export const LENGTHS = [15, 30] as const;
export type Length = (typeof LENGTHS)[number];

export interface SlideTime {
  /** On screen from. */
  start: number;
  /** Fully covered by the next slide (or the video's end) at. */
  end: number;
  /** The camera moves from `start` to here, then holds. */
  moveEnd: number;
}

export interface Timeline {
  slides: SlideTime[];
  duration: number;
}

/** How many photos a video of `seconds` holds at the usual pace. */
export function photoCountFor(seconds: number): number {
  return Math.max(1, Math.round(1 + (seconds - FIRST_SECONDS) / SLIDE_SECONDS));
}

/**
 * `count` slides fitted to `seconds`: the pace stretches or tightens to fit,
 * within bounds — past them the video is simply longer or shorter.
 */
export function buildTimeline(count: number, seconds: number): Timeline {
  if (count <= 0) return { slides: [], duration: 0 };
  const pace =
    count === 1
      ? SLIDE_SECONDS
      : Math.min(
          MAX_SLIDE_SECONDS,
          Math.max(MIN_SLIDE_SECONDS, (seconds - FIRST_SECONDS) / (count - 1)),
        );
  const duration =
    count === 1 ? Math.max(FIRST_SECONDS, seconds) : FIRST_SECONDS + (count - 1) * pace;
  const slides = Array.from({ length: count }, (_, i): SlideTime => {
    const start = i === 0 ? 0 : FIRST_SECONDS + (i - 1) * pace;
    const isLast = i === count - 1;
    const next = i === 0 ? FIRST_SECONDS : start + pace;
    const end = isLast ? duration : next + FADE_SECONDS;
    return { start, end, moveEnd: isLast ? duration - HOLD_SECONDS : end };
  });
  return { slides, duration };
}

export interface VisibleSlide {
  index: number;
  /** Camera progress, 0–1. */
  progress: number;
  /** 1 for the slide underneath; rising from 0 for one fading in on top. */
  alpha: number;
}

/** The slides on screen at `t`, bottom first — one, or two during a fade. */
export function slidesAt(timeline: Timeline, t: number): VisibleSlide[] {
  const visible: VisibleSlide[] = [];
  timeline.slides.forEach((slide, index) => {
    if (t < slide.start || t >= slide.end) return;
    const span = slide.moveEnd - slide.start;
    visible.push({
      index,
      progress: span > 0 ? Math.min(1, (t - slide.start) / span) : 1,
      alpha: index === 0 ? 1 : Math.min(1, (t - slide.start) / FADE_SECONDS),
    });
  });
  // At the very end `t` equals the duration; keep the last frame drawn.
  if (visible.length === 0 && timeline.slides.length > 0 && t >= timeline.duration) {
    visible.push({ index: timeline.slides.length - 1, progress: 1, alpha: 1 });
  }
  return visible;
}

/** How long each slide's camera moves — what `planShot` caps speeds by. */
export function moveSeconds(timeline: Timeline): number[] {
  return timeline.slides.map((s) => s.moveEnd - s.start);
}
