import { compareTimeline, type TimelinePosition } from "@/lib/gallery-chapters";
import { ORDER_KEY_SELECT, orderKeyOf, positionOf, type PhotoOrder } from "@/lib/photo-order";

/**
 * The highlights — a short "best of the day" at the top of a gallery
 * (docs/HIGHLIGHTS.md). Pure and client-safe: the guest page and the admin
 * both call it, so the admin shows exactly the photos a guest will see.
 *
 * Two sources, in this order:
 *   1. the photographer's hand — a photo pinned in the admin is always in,
 *      a photo excluded there never is;
 *   2. an automatic fill for the remaining seats: the day's parts (chapters,
 *      else long pauses in shooting) each get seats in proportion to their
 *      size, and within a part the best-scored moment of each stretch wins.
 *
 * "Best-scored" uses only what the photographer marked in Lightroom, and only
 * where it tells photos apart: a blanket 4★ on the whole wedding scores
 * nothing, a 5★ among them scores. Without any marks the fill is an even walk
 * through the day — a sensible default the photographer then adjusts.
 */

/** How many photos the highlights show (Pavel, 2026-09-28: five or six, not
 * ten — a taste of the day above the gallery, not a second one). */
export const HIGHLIGHT_COUNT = 6;

/** Pins that can show at once — never more than the pick would. The admin
 * refuses a pin past it; any extra (older data) are thinned evenly over the
 * day rather than cut at its morning. */
export const MAX_PINNED = HIGHLIGHT_COUNT;

/**
 * Below this many of the photographer's own photos there is no automatic fill:
 * a handful out of thirty is the gallery repeated, not a highlight.
 */
export const MIN_PHOTOS_FOR_AUTO = 40;

/** A pause in shooting this long starts a new part of the day (no chapters). */
const PART_GAP_MS = 20 * 60_000;

/** Shots this close together are one moment — a burst yields one photo at most. */
const BURST_GAP_MS = 4_000;

/**
 * …but a moment never lasts longer than this. Without a cap, two shooters
 * interleaving through a half-hour ceremony keep every gap under four seconds
 * and the whole ceremony collapses into one "burst".
 */
const BURST_MAX_SPAN_MS = 15_000;

/** A colour label on more than this share of photos is a habit, not a pick. */
const HABITUAL_LABEL_SHARE = 0.25;

/**
 * A part of the day smaller than this share of the whole gets no seat of its
 * own. ponytail: fixed share; a few stray frames between two pauses would
 * otherwise take a tenth of the highlights.
 */
const MIN_PART_SHARE = 0.03;

export interface HighlightCandidate extends TimelinePosition {
  /** Capture time, ISO — pauses and bursts are measured in it, whatever
   * order the gallery is shown in (src/lib/photo-order.ts). */
  takenAt: string;
  /** Lightroom stars from the export; null when the file carried none. */
  rating: number | null;
  label: string | null;
  /** Carries a highlight keyword (src/lib/xmp-picks.ts). */
  tagged: boolean;
  /** The photographer's decision in the admin: in, out, or left to the fill. */
  pin: boolean | null;
  /** The photographer's own upload. Guests' photos are never filled in
   * automatically — only pinned by hand. */
  own: boolean;
}

export interface HighlightPick {
  id: string;
  /** Pinned by hand, as opposed to filled in automatically. */
  pinned: boolean;
}

interface Moment extends HighlightCandidate {
  score: number;
}

/**
 * Picks the highlights, in timeline order. `chapterStarts` cut the day into
 * parts when there are any; otherwise pauses in shooting do.
 */
export function pickHighlights(
  candidates: readonly HighlightCandidate[],
  chapterStarts: readonly TimelinePosition[] = [],
  count: number = HIGHLIGHT_COUNT,
): HighlightPick[] {
  const timeline = [...candidates].sort(compareTimeline);
  const pinned = spread(
    timeline.filter((c) => c.pin === true),
    Math.min(count, MAX_PINNED),
  );
  const own = timeline.filter((c) => c.own);

  const budget = count - pinned.length;
  if (budget <= 0 || own.length < MIN_PHOTOS_FOR_AUTO) {
    return pinned.map((c) => ({ id: c.id, pinned: true }));
  }

  // Parts are cut over the photos themselves, so a part's share of the seats
  // follows how much of the day it is, not how many bursts it happened to hold.
  const pinnedIds = new Set(pinned.map((c) => c.id));
  const parts = cutIntoParts(
    timeline.filter((c) => c.own || pinnedIds.has(c.id)),
    chapterStarts,
    count,
  );
  const score = scorer(own);
  const moments = parts.map((part) => momentsOf(part, score));
  const seats = seatsPerPart(
    parts.map((part) => part.length),
    parts.map((part) => part.filter((c) => pinnedIds.has(c.id)).length),
    moments.map((m) => m.length),
    count,
    budget,
  );

  const auto = moments.flatMap((m, i) => pickFrom(m, seats[i]!));

  return [
    ...pinned.map((c) => ({ ...c, pinned: true })),
    ...auto.map((c) => ({ ...c, pinned: false })),
  ]
    .sort(compareTimeline)
    .map(({ id, pinned }) => ({ id, pinned }));
}

/**
 * `n` of `items`, evenly spaced from the first to the last — more pins than
 * seats (from before the section held six, or from a race past the admin's
 * limit) show the whole day, not just its morning.
 */
function spread<T>(items: readonly T[], n: number): T[] {
  if (items.length <= n) return [...items];
  if (n <= 1) return items.slice(0, n);
  return Array.from(
    { length: n },
    (_, i) => items[Math.round((i * (items.length - 1)) / (n - 1))]!,
  );
}

/**
 * Scores against the gallery itself: a mark counts only where it sets a photo
 * apart from the rest, so a workflow habit (every photo 4★, every photo red)
 * scores nothing, while a rarer mark on top of it does.
 */
function scorer(own: readonly HighlightCandidate[]): (c: HighlightCandidate) => number {
  const ratingCounts = new Map<number, number>();
  const labelCounts = new Map<string, number>();
  for (const c of own) {
    if (c.rating !== null) ratingCounts.set(c.rating, (ratingCounts.get(c.rating) ?? 0) + 1);
    if (c.label) labelCounts.set(c.label, (labelCounts.get(c.label) ?? 0) + 1);
  }
  // Only photos that carry a rating define the usual one, and only they are
  // compared against it: a photo uploaded before marks were read, or exported
  // without them, is neither above nor below anything.
  const usualRating = [...ratingCounts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
  const rareLabel = (label: string | null) =>
    !!label && (labelCounts.get(label) ?? 0) / own.length <= HABITUAL_LABEL_SHARE;

  return (c) =>
    (c.tagged ? 10 : 0) +
    (rareLabel(c.label) ? 4 : 0) +
    (c.rating !== null && usualRating !== undefined ? (c.rating - usualRating) * 3 : 0);
}

/**
 * Collapses bursts into moments: the best-scored frame of each, the middle one
 * among equals.
 *
 * A burst is a *chain* of frames less than BURST_GAP_MS apart, cut into
 * windows of at most BURST_MAX_SPAN_MS so a long, dense sequence still yields
 * several moments. A window within BURST_MAX_SPAN_MS of a frame the
 * photographer pinned or excluded *on the same chain* yields nothing: that
 * moment is decided, and the frame beside it is the same photo a second later.
 */
function momentsOf(
  part: readonly HighlightCandidate[],
  score: (c: HighlightCandidate) => number,
): Moment[] {
  const moments: Moment[] = [];
  for (const chain of splitWhere(part, (prev, c) => gapBetween(prev, c) > BURST_GAP_MS)) {
    const decided = chain.filter((c) => c.pin !== null);
    const windows = splitWhere(
      chain.filter((c) => c.own),
      (prev, c, first) =>
        gapBetween(prev, c) > BURST_GAP_MS || gapBetween(first, c) > BURST_MAX_SPAN_MS,
    );
    for (const window of windows) {
      // The window's span in time — in file-name order its frames need not
      // run forwards (two bodies a few seconds apart).
      const times = window.map((c) => Date.parse(c.takenAt));
      const [from, to] = [Math.min(...times), Math.max(...times)];
      const settled = decided.some((d) => {
        const at = Date.parse(d.takenAt);
        return at >= from - BURST_MAX_SPAN_MS && at <= to + BURST_MAX_SPAN_MS;
      });
      if (settled) continue;
      const scored = window.map((c) => ({ ...c, score: score(c) }));
      const best = Math.max(...scored.map((c) => c.score));
      const top = scored.filter((c) => c.score === best);
      moments.push(top[Math.floor((top.length - 1) / 2)]!);
    }
  }
  return moments;
}

/** Cuts a timeline wherever `cut(previous, item, firstOfRun)` says so. */
function splitWhere<T>(
  items: readonly T[],
  cut: (previous: T, item: T, first: T) => boolean,
): T[][] {
  const runs: T[][] = [];
  for (const item of items) {
    const run = runs.at(-1);
    if (run && !cut(run.at(-1)!, item, run[0]!)) run.push(item);
    else runs.push([item]);
  }
  return runs;
}

function msBetween(a: { takenAt: string }, b: { takenAt: string }): number {
  return Date.parse(b.takenAt) - Date.parse(a.takenAt);
}

function inClockOrder(timeline: readonly { takenAt: string }[]): boolean {
  return timeline.every((item, i) => i === 0 || msBetween(timeline[i - 1]!, item) >= -PART_GAP_MS);
}

/**
 * How far apart two neighbours were shot. In capture-time order this is
 * `msBetween` itself; in file-name order a camera whose clock was off makes
 * the next photo "earlier", and that is a gap as much as a later one is.
 */
function gapBetween(a: { takenAt: string }, b: { takenAt: string }): number {
  return Math.abs(msBetween(a, b));
}

/**
 * The day's parts: chapters when the photographer set them, else pauses in
 * shooting — else, when the capture times cannot be trusted to show a pause,
 * equal stretches of the gallery.
 *
 * Capture times go backwards only in file-name order (src/lib/photo-order.ts).
 * By seconds, that is two bodies' clocks disagreeing a little and changes
 * nothing. By more than a pause, a camera's clock was off: every switch to or
 * from it would read as a pause, cutting the day into slivers too small to
 * earn a seat. An even walk through the photographer's own order is what the
 * fill does without marks anyway. Judged on the photographer's own photos
 * only — a pinned guest photo sorts by its phone's file name, wherever that
 * lands, and says nothing about the photographer's clocks.
 */
function cutIntoParts<T extends HighlightCandidate>(
  timeline: readonly T[],
  chapterStarts: readonly TimelinePosition[],
  count: number,
): T[][] {
  // A chapter starting past the last photo is hidden from guests; it cuts
  // nothing here either, and must not stand in for "the day has chapters".
  const last = timeline.at(-1);
  chapterStarts = last ? chapterStarts.filter((start) => compareTimeline(start, last) <= 0) : [];
  if (chapterStarts.length === 0 && !inClockOrder(timeline.filter((c) => c.own))) {
    const size = Math.max(1, Math.ceil(timeline.length / count));
    return Array.from({ length: Math.ceil(timeline.length / size) }, (_, i) =>
      timeline.slice(i * size, (i + 1) * size),
    );
  }
  const starts = [...chapterStarts].sort(compareTimeline);
  const parts: T[][] = [];
  let next = 0;
  for (const item of timeline) {
    let cut = parts.length === 0;
    if (starts.length > 0) {
      while (next < starts.length && compareTimeline(starts[next]!, item) <= 0) {
        next += 1;
        cut = true;
      }
    } else {
      const previous = parts.at(-1)?.at(-1);
      if (previous && msBetween(previous, item) > PART_GAP_MS) cut = true;
    }
    if (cut) parts.push([]);
    parts.at(-1)!.push(item);
  }
  return parts;
}

/**
 * Automatic seats per part. The day's `count` seats are shared out in
 * proportion to each part's size in photos (largest remainder), so the
 * ceremony gets more than the stray frames before it; pins already sitting in
 * a part use up its share first. What is left over is then trimmed or topped
 * up to exactly `budget`, never beyond the moments a part actually has.
 */
function seatsPerPart(
  sizes: readonly number[],
  pinnedIn: readonly number[],
  available: readonly number[],
  count: number,
  budget: number,
): number[] {
  const target = shareOut(sizes, count);
  const seats = target.map((t, i) => Math.min(available[i]!, Math.max(0, t - pinnedIn[i]!)));

  let total = seats.reduce((a, b) => a + b, 0);
  while (total > budget) {
    const i = argmax(seats, (s) => s);
    seats[i]! -= 1;
    total -= 1;
  }
  while (total < budget) {
    const open = seats.map((s, i) => (s < available[i]! ? i : -1)).filter((i) => i >= 0);
    if (open.length === 0) break;
    // The part with the most photos per highlight so far.
    const i = open[argmax(open, (j) => sizes[j]! / (seats[j]! + pinnedIn[j]! + 1))]!;
    seats[i]! += 1;
    total += 1;
  }
  return seats;
}

/** Largest-remainder apportionment; a part below MIN_PART_SHARE gets none. */
function shareOut(sizes: readonly number[], count: number): number[] {
  const total = sizes.reduce((a, b) => a + b, 0);
  if (total === 0) return sizes.map(() => 0);
  const eligible = sizes.map((s) => s / total >= MIN_PART_SHARE);
  const eligibleTotal = sizes.reduce((sum, s, i) => sum + (eligible[i] ? s : 0), 0);
  const quota = sizes.map((s, i) => (eligible[i] ? (s / eligibleTotal) * count : 0));
  const seats = quota.map(Math.floor);
  let left = count - seats.reduce((a, b) => a + b, 0);
  const byRemainder = quota
    .map((q, i) => [q - seats[i]!, i] as const)
    .filter(([, i]) => eligible[i])
    .sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; left > 0 && byRemainder.length > 0; k = (k + 1) % byRemainder.length, left--) {
    seats[byRemainder[k]![1]]! += 1;
  }
  return seats;
}

function argmax<T>(items: readonly T[], value: (item: T) => number): number {
  let best = 0;
  for (let i = 1; i < items.length; i++) if (value(items[i]!) > value(items[best]!)) best = i;
  return best;
}

/**
 * `k` moments from one part: the part is cut into `k` equal stretches of time
 * order and each gives its best-scored moment — the one nearest the middle of
 * the stretch among equals, so an unmarked gallery gets an even walk.
 */
function pickFrom(part: readonly Moment[], k: number): Moment[] {
  const chosen: Moment[] = [];
  for (let j = 0; j < k; j++) {
    const stretch = part.slice(
      Math.floor((j * part.length) / k),
      Math.floor(((j + 1) * part.length) / k),
    );
    if (stretch.length === 0) continue;
    const middle = (stretch.length - 1) / 2;
    let best = 0;
    for (let i = 1; i < stretch.length; i++) {
      const a = stretch[i]!;
      const b = stretch[best]!;
      if (
        a.score > b.score ||
        (a.score === b.score && Math.abs(i - middle) < Math.abs(best - middle))
      )
        best = i;
    }
    chosen.push(stretch[best]!);
  }
  return chosen;
}

/** What a viewer's page gets for each highlight — enough to draw its tile. */
export interface GalleryHighlight {
  id: string;
  objectKey: string;
  thumbObjectKey: string | null;
  fileName: string;
  width: number | null;
  height: number | null;
  placeholder: string | null;
}

/** The columns `toHighlightCandidate` reads — for a Prisma `select`. */
export const HIGHLIGHT_CANDIDATE_SELECT = {
  id: true,
  ...ORDER_KEY_SELECT,
  source: true,
  xmpRating: true,
  xmpLabel: true,
  xmpHighlight: true,
  highlightPin: true,
} as const;

/** A photo row as the picker sees it, placed in the gallery's order. */
export function toHighlightCandidate(
  order: PhotoOrder,
  photo: {
    id: string;
    takenAt: Date | null;
    createdAt: Date;
    fileOrderKey: string;
    source: string;
    xmpRating: number | null;
    xmpLabel: string | null;
    xmpHighlight: boolean;
    highlightPin: boolean | null;
  },
): HighlightCandidate {
  return {
    ...positionOf(order, photo),
    takenAt: orderKeyOf("TAKEN_AT", photo),
    rating: photo.xmpRating,
    label: photo.xmpLabel,
    tagged: photo.xmpHighlight,
    pin: photo.highlightPin,
    own: photo.source === "OWNER",
  };
}
