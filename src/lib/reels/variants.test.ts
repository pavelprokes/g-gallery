import { describe, expect, it } from "vitest";
import type { BeatAnalysis } from "@/lib/reels/beats";
import {
  guestPool,
  pickReelPhotos,
  reelVariants,
  shareOut,
  type ReelSource,
} from "@/lib/reels/variants";
import { FORMATS } from "@/lib/social-video/camera";
import type { VideoCandidate } from "@/lib/social-video/suggest";

const VERTICAL = FORMATS["9:16"];
const DAY = Date.UTC(2026, 8, 12, 10, 0);

function gallery(id: string, count: number): ReelSource {
  const candidates = Array.from({ length: count }, (_, i): VideoCandidate => {
    const at = DAY + i * 5 * 60_000;
    return {
      id: `${id}-${String(i).padStart(4, "0")}`,
      key: new Date(at).toISOString(),
      takenAt: new Date(at).toISOString(),
      rating: 0,
      label: null,
      tagged: false,
      pin: null,
      own: true,
      width: i % 2 ? 2000 : 3000,
      height: i % 2 ? 3000 : 2000,
      faces: null,
    };
  });
  return { id, candidates, chapterStarts: [] };
}

const song: BeatAnalysis = (() => {
  const beats = Array.from({ length: 400 }, (_, i) => (i * 60) / 128);
  return {
    v: 1,
    duration: 190,
    bpm: 128,
    beats,
    downbeat: 0,
    energy: beats.map((t) => (t > 90 ? 1 : 0.4)),
  };
})();

describe("shareOut", () => {
  it("splits evenly and hands a small gallery's spare to the rest", () => {
    expect(shareOut([100, 100, 100], 30)).toEqual([10, 10, 10]);
    expect(shareOut([3, 100], 20)).toEqual([3, 17]);
    expect(shareOut([2, 3], 20)).toEqual([2, 3]);
    expect(shareOut([10, 10, 10], 31).reduce((a, b) => a + b)).toBe(30);
  });
});

describe("pickReelPhotos", () => {
  const a = gallery("a", 120);
  const b = gallery("b", 120);

  it("takes from every gallery, never an excluded photo", () => {
    const exclude = new Set(a.candidates.slice(0, 60).map((c) => c.id));
    const ids = pickReelPhotos([a, b], VERTICAL, 20, { exclude });
    expect(ids).toHaveLength(20);
    expect(new Set(ids).size).toBe(20);
    expect(ids.filter((id) => id.startsWith("a-"))).toHaveLength(10);
    expect(ids.some((id) => exclude.has(id))).toBe(false);
  });

  it("takes the galleries in turn when mixed", () => {
    const ids = pickReelPhotos([a, b], VERTICAL, 10, { mix: true });
    expect(ids.map((id) => id[0]).join("")).toBe("ababababab");
  });

  it("never shows a guest's photo", () => {
    const guests: ReelSource = {
      ...a,
      candidates: a.candidates.map((c, i) => ({ ...c, own: i % 2 === 0 })),
    };
    const ids = pickReelPhotos([guests], VERTICAL, 30);
    const own = new Set(guests.candidates.filter((c) => c.own).map((c) => c.id));
    expect(ids.every((id) => own.has(id))).toBe(true);
  });
});

describe("reelVariants", () => {
  const sources = [gallery("a", 200), gallery("b", 200)];
  const base = {
    sources,
    format: VERTICAL,
    analysis: song,
    settings: { seconds: 15, pace: "beat" as const },
    exclude: new Set<string>(),
    shown: new Set<string>(),
  };

  it("offers three variants, one photo per cut, the later ones with other photos", () => {
    const variants = reelVariants({ ...base, round: 0 });
    expect(variants).toHaveLength(3);
    for (const v of variants) expect(v.photoIds).toHaveLength(v.plan.timeline.slides.length);
    const [first, second] = variants;
    const overlap = second!.photoIds.filter((id) => first!.photoIds.includes(id));
    expect(overlap.length).toBeLessThan(first!.photoIds.length / 2);
    expect(variants[2]!.plan.timeline.slides.length).toBeGreaterThan(
      first!.plan.timeline.slides.length,
    );
  });

  it("starts the first variant's music on the loud part", () => {
    const [first] = reelVariants({ ...base, round: 0 });
    expect(first!.plan.offset).toBeGreaterThan(90);
  });

  it("keeps a start the photographer moved", () => {
    const [first] = reelVariants({ ...base, round: 0, startBeats: { "0-0": 64 } });
    expect(first!.plan.startBeat).toBe(64);
  });

  it("fits the cuts to a gallery too small for them", () => {
    const variants = reelVariants({ ...base, sources: [gallery("s", 6)], round: 0 });
    for (const v of variants) {
      expect(v.photoIds.length).toBeLessThanOrEqual(6);
      expect(v.photoIds).toHaveLength(v.plan.timeline.slides.length);
    }
  });
});

describe("by the guests", () => {
  const liked = (source: ReelSource, ids: number[]): ReelSource => ({
    ...source,
    candidates: source.candidates.map((c, i) => ({ ...c, liked: ids.includes(i) ? 10 + i : 0 })),
  });

  it("keeps the guests' favourites, most noticed first", () => {
    const source = liked(gallery("g", 50), [3, 7, 20, 30, 41]);
    expect(guestPool(source.candidates, 3).map((c) => c.id)).toEqual([
      "g-0020",
      "g-0030",
      "g-0041",
    ]);
  });

  it("leaves the choice to the photographer while too few were noticed", () => {
    const source = liked(gallery("g", 50), [3]);
    expect(guestPool(source.candidates, 3)).toHaveLength(50);
  });

  it("takes the reel's photos from among them", () => {
    const favourites = Array.from({ length: 30 }, (_, i) => i * 3);
    const source = liked(gallery("g", 100), favourites);
    const ids = pickReelPhotos([source], VERTICAL, 10, { byGuests: true });
    expect(ids).toHaveLength(10);
    const noticed = new Set(favourites.map((i) => `g-${String(i).padStart(4, "0")}`));
    expect(ids.every((id) => noticed.has(id))).toBe(true);
  });
});
