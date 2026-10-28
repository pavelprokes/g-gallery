// The photos of a reel, from one gallery or several (docs/REELS.md §4), and
// the variants the page offers side by side. The social video's suggestion
// picks within each gallery — pins, stars, the guests' favourites, every part
// of the day, the format's shape — and this only shares the count out and
// puts the galleries together.

import type { TimelinePosition } from "@/lib/gallery-chapters";
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

export function pickReelPhotos(
  sources: readonly ReelSource[],
  format: VideoFormat,
  count: number,
  { avoid = new Set(), exclude = new Set(), mix = false }: PickOptions = {},
): string[] {
  const usable = sources.map((s) => ({
    ...s,
    candidates: s.candidates.filter((c) => c.own && !exclude.has(c.id)),
  }));
  const quotas = shareOut(
    usable.map((s) => s.candidates.length),
    count,
  );
  const lists = usable.map((s, i) =>
    quotas[i]! > 0
      ? suggestPhotos(s.candidates, s.chapterStarts, format, quotas[i]!, { avoid })
      : [],
  );
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
}): ReelVariant[] {
  const available = sources.reduce(
    (n, s) => n + s.candidates.filter((c) => c.own && !exclude.has(c.id)).length,
    0,
  );
  const starts = sections(analysis, settings.seconds, RECIPES.length + round);
  const avoid = new Set(shown);
  return RECIPES.map((recipe, i) => {
    const key = `${round}-${i}`;
    const startBeat =
      startBeats?.[key] ?? starts[(recipe.section + round) % starts.length] ?? starts[0] ?? 0;
    const options = {
      startBeat,
      seconds: settings.seconds,
      pace: settings.pace,
      accents: recipe.accents,
    };
    // The slots first, then as many photos; a gallery with fewer gets a plan for what it has.
    let plan = planReel(analysis, { ...options, maxPhotos: available });
    const photoIds = pickReelPhotos(sources, format, plan.timeline.slides.length, {
      avoid: recipe.fresh || round > 0 ? avoid : undefined,
      exclude,
      mix: recipe.mix && sources.length > 1,
    });
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
