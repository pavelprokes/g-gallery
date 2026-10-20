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
  /** How long a slide takes to fade in over the one before. */
  fade: number;
}

/** The rhythm of a video: how long slides stay and how they cross. */
export interface Pacing {
  first: number;
  slide: number;
  minSlide: number;
  maxSlide: number;
  fade: number;
  hold: number;
}

/** The studio's rhythm — and the public maker's "klidné" one (docs/SLIDESHOW-MAKER.md). */
export const NORMAL_PACING: Pacing = {
  first: FIRST_SECONDS,
  slide: SLIDE_SECONDS,
  minSlide: MIN_SLIDE_SECONDS,
  maxSlide: MAX_SLIDE_SECONDS,
  fade: FADE_SECONDS,
  hold: HOLD_SECONDS,
};

/** How many photos a video of `seconds` holds at the usual pace. */
export function photoCountFor(seconds: number): number {
  return Math.max(1, Math.round(1 + (seconds - FIRST_SECONDS) / SLIDE_SECONDS));
}

/**
 * `count` slides fitted to `seconds`: the pace stretches or tightens to fit,
 * within bounds — past them the video is simply longer or shorter.
 */
export function buildTimeline(
  count: number,
  seconds: number,
  pacing: Pacing = NORMAL_PACING,
): Timeline {
  const { first, fade, hold } = pacing;
  if (count <= 0) return { slides: [], duration: 0, fade };
  const pace =
    count === 1
      ? pacing.slide
      : Math.min(pacing.maxSlide, Math.max(pacing.minSlide, (seconds - first) / (count - 1)));
  const duration = count === 1 ? Math.max(first, seconds) : first + (count - 1) * pace;
  const slides = Array.from({ length: count }, (_, i): SlideTime => {
    const start = i === 0 ? 0 : first + (i - 1) * pace;
    const isLast = i === count - 1;
    const next = i === 0 ? first : start + pace;
    const end = isLast ? duration : next + fade;
    return { start, end, moveEnd: isLast ? duration - hold : end };
  });
  return { slides, duration, fade };
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
      alpha: index === 0 ? 1 : Math.min(1, (t - slide.start) / timeline.fade),
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
