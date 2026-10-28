// The photos of a reel, from one gallery or several (docs/REELS.md §4), and
// the variants the page offers side by side. The social video's suggestion
// picks within each gallery — pins, stars, the guests' favourites, every part
// of the day, the format's shape — and this only shares the count out and
// puts the galleries together.

import { compareTimeline, type TimelinePosition } from "@/lib/gallery-chapters";
import type { BeatAnalysis } from "@/lib/reels/beats";
import { planReel, sections, type Pace, type ReelPlan } from "@/lib/reels/cuts";
import type { VideoFormat } from "@/lib/social-video/camera";
import { suggestPhotos, type VideoCandidate } from "@/lib/social-video/suggest";

export interface ReelSource {
  /** The gallery's id. */
  id: string;
  candidates: readonly VideoCandidate[];
  chapterStarts: readonly TimelinePosition[];
}

export interface PickOptions {
  /** Photos shown before: passed over where there is anything else. */
  avoid?: ReadonlySet<string>;
  /** Photos the photographer took out: never. */
  exclude?: ReadonlySet<string>;
  /** Galleries taken in turn rather than one after another. */
  mix?: boolean;
  /** Choose among what the guests took to most (docs/REELS.md §4). */
  byGuests?: boolean;
  /** The photos the photographer picked by hand: only these, when there are any. */
  only?: ReadonlySet<string>;
}

/** With guests deciding, the suggestion picks from this many times the
 * photos it needs — room for its spread over the day and the format's shape. */
const GUEST_POOL = 3;

/**
 * The photos the guests looked at, printed, loved and reacted to most
 * (`likedScore`), `size` of them — or every photo, while too few have been
 * noticed at all to fill it: the photographer's own marks decide then.
 */
export function guestPool(candidates: readonly VideoCandidate[], size: number): VideoCandidate[] {
  const noticed = candidates.filter((c) => (c.liked ?? 0) > 0);
  if (noticed.length < size) return [...candidates];
  const kept = new Set(
    noticed
      .toSorted((a, b) => b.liked! - a.liked! || compareTimeline(a, b))
      .slice(0, size)
      .map((c) => c.id),
  );
  return candidates.filter((c) => kept.has(c.id));
}

/**
 * The same photos in another order, the same for the same `seed`: the first
 * and last stay — the suggestion chose them as the strong ends — the rest
 * are shuffled.
 */
export function reordered(ids: readonly string[], seed: number): string[] {
  if (ids.length < 4) return [...ids];
  let state = (seed * 2654435761 + 1) >>> 0;
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  const middle = ids.slice(1, -1);
  for (let i = middle.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [middle[i], middle[j]] = [middle[j]!, middle[i]!];
  }
  return [ids[0]!, ...middle, ids.at(-1)!];
}

/** `count` split as evenly as the galleries allow — a small one gives its spare to the rest. */
export function shareOut(sizes: readonly number[], count: number): number[] {
  const out = sizes.map(() => 0);
  let left = Math.min(
    count,
    sizes.reduce((a, b) => a + b, 0),
  );
  while (left > 0) {
    const open = sizes.map((size, i) => i).filter((i) => out[i]! < sizes[i]!);
    if (open.length === 0) break;
    const each = Math.max(1, Math.floor(left / open.length));
    for (const i of open) {
      if (left === 0) break;
      const add = Math.min(each, sizes[i]! - out[i]!, left);
      out[i]! += add;
      left -= add;
    }
  }
  return out;
}

/** A photo a reel may show: the photographer's own, not taken out, and — when
 * photos were picked by hand — one of them. */
function usableFor(
  c: { id: string; own?: boolean },
  exclude: ReadonlySet<string>,
  only: ReadonlySet<string> | undefined,
): boolean {
  return Boolean(c.own) && !exclude.has(c.id) && (!only || only.size === 0 || only.has(c.id));
}

export function pickReelPhotos(
  sources: readonly ReelSource[],
  format: VideoFormat,
  count: number,
  { avoid = new Set(), exclude = new Set(), mix = false, byGuests = false, only }: PickOptions = {},
): string[] {
  const usable = sources.map((s) => ({
    ...s,
    candidates: s.candidates.filter((c) => usableFor(c, exclude, only)),
  }));
  const quotas = shareOut(
    usable.map((s) => s.candidates.length),
    count,
  );
  const lists = usable.map((s, i) => {
    const quota = quotas[i]!;
    if (quota === 0) return [];
    // Photos already shown count towards the pool: "Další varianty" still
    // has the guests' next favourites to reach for.
    // Photos picked by hand are all wanted: the guests do not narrow them.
    const pool =
      byGuests && !only?.size
        ? guestPool(s.candidates, quota * GUEST_POOL + avoid.size)
        : s.candidates;
    return suggestPhotos(pool, s.chapterStarts, format, quota, { avoid });
  });
  if (!mix) return lists.flat();
  const total = lists.reduce((n, list) => n + list.length, 0);
  const out: string[] = [];
  for (let k = 0; out.length < total; k++) {
    for (const list of lists) if (k < list.length) out.push(list[k]!);
  }
  return out;
}

export interface ReelSettings {
  seconds: number;
  pace: Pace;
}

export interface ReelVariant {
  key: string;
  label: string;
  photoIds: string[];
  plan: ReelPlan;
  accents: boolean;
}

interface Recipe {
  label: string;
  accents: boolean;
  /** Which of the song's loud stretches. */
  section: number;
  /** Reach past the earlier variants' photos. */
  fresh: boolean;
  mix: boolean;
}

/** A: the best photos on the loudest part. B: other photos, another part.
 * C: the fills cut double time, the galleries taken in turn. */
const RECIPES: Recipe[] = [
  { label: "Nejlepší výběr", accents: false, section: 0, fresh: false, mix: false },
  { label: "Jiné fotky", accents: false, section: 1, fresh: true, mix: false },
  { label: "Se zrychlením", accents: true, section: 0, fresh: true, mix: true },
];

/**
 * The variants of a round. Round 0 is the suggestion as it stands; each later
 * round ("Další varianty") passes over every photo already shown and moves on
 * through the song's loud stretches.
 */
export function reelVariants({
  sources,
  format,
  analysis,
  settings,
  exclude,
  shown,
  round,
  startBeats,
  songStart = null,
  byGuests = false,
  mixGalleries = true,
  only,
}: {
  sources: readonly ReelSource[];
  format: VideoFormat;
  analysis: BeatAnalysis;
  settings: ReelSettings;
  exclude: ReadonlySet<string>;
  /** Photos earlier rounds showed. */
  shown: ReadonlySet<string>;
  round: number;
  /** A start the photographer moved a variant's music to, by key. */
  startBeats?: Readonly<Record<string, number>>;
  /** The part of the song the photographer chose for every variant; null
   * leaves each recipe its own loud stretch. */
  songStart?: number | null;
  byGuests?: boolean;
  /** Every variant takes the galleries in turn — their photos mixed — rather than one after another. */
  mixGalleries?: boolean;
  /** The photos picked by hand; empty or missing — the suggestion picks. */
  only?: ReadonlySet<string>;
}): ReelVariant[] {
  const available = sources.reduce(
    (n, s) => n + s.candidates.filter((c) => usableFor(c, exclude, only)).length,
    0,
  );
  const starts = sections(analysis, settings.seconds, RECIPES.length + round);
  const avoid = new Set(shown);
  return RECIPES.map((recipe, i) => {
    const key = `${round}-${i}`;
    const startBeat =
      startBeats?.[key] ??
      songStart ??
      starts[(recipe.section + round) % starts.length] ??
      starts[0] ??
      0;
    const options = {
      startBeat,
      seconds: settings.seconds,
      pace: settings.pace,
      accents: recipe.accents,
    };
    // The slots first, then as many photos; a gallery with fewer gets a plan for what it has.
    let plan = planReel(analysis, { ...options, maxPhotos: available });
    const slots = plan.timeline.slides.length;
    // Photos picked by hand are the whole choice: a variant passes over the
    // ones shown only where there are enough others — otherwise it shows the
    // same photos in another order.
    const handPicked = Boolean(only?.size);
    const roomToAvoid = !handPicked || available >= 2 * slots;
    let photoIds = pickReelPhotos(sources, format, slots, {
      avoid: (recipe.fresh || round > 0) && roomToAvoid ? avoid : undefined,
      exclude,
      mix: (mixGalleries || recipe.mix) && sources.length > 1,
      byGuests,
      only,
    });
    if (handPicked && !roomToAvoid && (i > 0 || round > 0)) {
      photoIds = reordered(photoIds, round * RECIPES.length + i);
    }
    if (photoIds.length < plan.timeline.slides.length) {
      plan = planReel(analysis, { ...options, maxPhotos: photoIds.length });
    }
    for (const id of photoIds) avoid.add(id);
    return {
      key,
      label: recipe.label,
      photoIds: photoIds.slice(0, plan.timeline.slides.length),
      plan,
      accents: recipe.accents,
    };
  });
}
