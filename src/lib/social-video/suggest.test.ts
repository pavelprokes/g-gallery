import { describe, expect, it } from "vitest";
import { FORMATS } from "@/lib/social-video/camera";
import { FACES_MODEL, type Face } from "@/lib/social-video/faces";
import { fitFor, likedScore, suggestPhotos, type VideoCandidate } from "@/lib/social-video/suggest";

const DAY = Date.UTC(2026, 8, 12, 10, 0);
const VERTICAL = FORMATS["9:16"];

const someone = (blink: number | null = 0.05): Face => ({
  x: 0.45,
  y: 0.3,
  w: 0.08,
  h: 0.12,
  score: 0.9,
  le: [0.47, 0.34],
  re: [0.51, 0.34],
  blink,
});

/** A photo `minutes` into the day. */
function photo(minutes: number, extra: Partial<VideoCandidate> = {}): VideoCandidate {
  const at = DAY + minutes * 60_000;
  return {
    id: `p${String(at).padStart(16, "0")}`,
    key: new Date(at).toISOString(),
    takenAt: new Date(at).toISOString(),
    rating: 0,
    label: null,
    tagged: false,
    pin: null,
    own: true,
    width: 3000,
    height: 2000,
    faces: null,
    ...extra,
  };
}

const withFaces = (...faces: Face[]) => ({ v: 1 as const, model: FACES_MODEL, faces });

describe("fitFor", () => {
  it("prefers a portrait photo for 9:16 and a landscape one for 16:9", () => {
    const tall = photo(0, { width: 2000, height: 3000 });
    const wide = photo(0);
    expect(fitFor(tall, VERTICAL)).toBeGreaterThan(fitFor(wide, VERTICAL));
    expect(fitFor(wide, FORMATS["16:9"])).toBeGreaterThan(fitFor(tall, FORMATS["16:9"]));
  });

  it("holds back a group photo where someone blinked, not a couple with eyes closed", () => {
    const at = (x: number, blink: number | null = 0.05) => ({
      ...someone(blink),
      x,
      le: [x + 0.02, 0.34] as [number, number],
      re: [x + 0.06, 0.34] as [number, number],
    });
    const group = (blink: number) =>
      photo(0, { faces: withFaces(at(0.3), at(0.45, blink), at(0.6)) });
    expect(fitFor(group(0.9), FORMATS["16:9"])).toBeLessThan(fitFor(group(0.05), FORMATS["16:9"]));
    // A kiss: closed eyes are the moment, not a mistake.
    const couple = (blink: number) =>
      photo(0, { faces: withFaces(at(0.4, blink), at(0.5, blink)) });
    expect(fitFor(couple(0.9), FORMATS["16:9"])).toBe(fitFor(couple(0.05), FORMATS["16:9"]));
  });

  it("steers a 9:16 video away from a landscape photo known to show no face", () => {
    const faceless = photo(0, { faces: withFaces() });
    const unknown = photo(0);
    expect(fitFor(faceless, VERTICAL)).toBeLessThan(fitFor(unknown, VERTICAL));
    // A portrait without faces still fits 9:16 — a detail, the rings.
    const detail = photo(0, { width: 2000, height: 3000, faces: withFaces() });
    expect(fitFor(detail, VERTICAL)).toBeGreaterThan(fitFor(faceless, VERTICAL));
  });

  it("counts as someone only a face the camera would frame", () => {
    const weak = photo(0, { faces: withFaces({ ...someone(), score: 0.65 }) });
    const faceless = photo(0, { faces: withFaces() });
    expect(fitFor(weak, VERTICAL)).toBe(fitFor(faceless, VERTICAL));
  });

  it("prefers the couple, as named, and frames a group on them", () => {
    const row = [0.1, 0.3, 0.5, 0.7, 0.9].map((x) => ({
      ...someone(),
      x,
      le: [x + 0.02, 0.34] as [number, number],
      re: [x + 0.06, 0.34] as [number, number],
    }));
    const group = photo(0, { faces: withFaces(...row) });
    const named = photo(0, {
      faces: withFaces(...row),
      coupleTags: [row[2]!, row[3]!].map(({ x, y, w, h }) => ({ x, y, w, h })),
    });
    // Shown whole no more, and theirs: ahead of a portrait of a guest.
    const guest = photo(0, { width: 2000, height: 3000, faces: withFaces(someone()) });
    expect(fitFor(named, VERTICAL)).toBeGreaterThan(fitFor(group, VERTICAL));
    expect(fitFor(named, VERTICAL)).toBeGreaterThanOrEqual(fitFor(guest, VERTICAL));
  });

  it("holds back a group that 9:16 can only show whole", () => {
    const open = photo(0, { faces: withFaces(someone()) });

    const row = [0.1, 0.3, 0.5, 0.7, 0.9].map((x) => ({
      ...someone(),
      x,
      le: [x + 0.02, 0.34] as [number, number],
      re: [x + 0.06, 0.34] as [number, number],
    }));
    const group = photo(0, { faces: withFaces(...row) });
    expect(fitFor(group, VERTICAL)).toBeLessThan(fitFor(open, VERTICAL));
  });
});

describe("suggestPhotos", () => {
  const day = Array.from({ length: 60 }, (_, i) => photo(i * 5));

  it("proposes the number asked for, each photo once", () => {
    const ids = suggestPhotos(day, [], VERTICAL, 6);
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
  });

  it("always takes a pinned photo, and opens with the strongest", () => {
    const pinned = photo(17, { pin: true });
    const ids = suggestPhotos([...day, pinned], [], VERTICAL, 6);
    expect(ids[0]).toBe(pinned.id);
  });

  it("takes more pins than the highlights strip holds", () => {
    const pins = Array.from({ length: 10 }, (_, i) => photo(i * 30 + 1, { pin: true }));
    const ids = suggestPhotos([...day, ...pins], [], VERTICAL, 12);
    for (const p of pins) expect(ids).toContain(p.id);
  });

  it("proposes from a small gallery too — all of it when it has fewer than asked", () => {
    expect(suggestPhotos(day.slice(0, 10), [], VERTICAL, 6)).toHaveLength(6);
    expect(new Set(suggestPhotos(day.slice(0, 3), [], VERTICAL, 6))).toEqual(
      new Set(day.slice(0, 3).map((p) => p.id)),
    );
  });

  it("tops up a pick that bursts left short — photos taken seconds apart", () => {
    const burst = Array.from({ length: 8 }, (_, i) => {
      const p = photo(0);
      const at = DAY + i * 1000;
      return {
        ...p,
        id: `b${i}`,
        key: new Date(at).toISOString(),
        takenAt: new Date(at).toISOString(),
      };
    });
    expect(suggestPhotos(burst, [], VERTICAL, 6)).toHaveLength(6);
  });

  it("still chooses by fit when the pick was topped up", () => {
    // Twelve photos uploaded a second apart — one burst to the highlights —
    // four of them landscape photos known to show no face.
    const burst = Array.from({ length: 12 }, (_, i) => {
      const at = DAY + i * 1000;
      return photo(0, {
        id: `b${i}`,
        key: new Date(at).toISOString(),
        takenAt: new Date(at).toISOString(),
        ...(i % 3 === 0 ? { faces: withFaces() } : { width: 2000, height: 3000 }),
      });
    });
    const ids = suggestPhotos(burst, [], VERTICAL, 6);
    expect(ids.filter((id) => Number(id.slice(1)) % 3 === 0)).toEqual([]);
  });

  it("prefers the highlights' pick over the top-up when they fit as well", () => {
    // Three rated photos an hour apart and one burst, seconds apart, between
    // them: the pick holds the three and one frame of the burst, the top-up
    // fills the pool from the rest of the burst — earlier in the day than two
    // of the three.
    const rated = Array.from({ length: 3 }, (_, i) => photo(i * 60, { rating: 5 }));
    const burst = Array.from({ length: 20 }, (_, i) => {
      const at = DAY + 30 * 60_000 + i * 1000;
      return photo(0, {
        id: `b${String(i).padStart(2, "0")}`,
        key: new Date(at).toISOString(),
        takenAt: new Date(at).toISOString(),
      });
    });
    const ids = suggestPhotos([...rated, ...burst], [], FORMATS["16:9"], 6);
    for (const p of rated) expect(ids).toContain(p.id);
  });

  it("steers a 9:16 video towards portrait photos", () => {
    const mixed = day.map((p, i) => (i % 2 ? { ...p, width: 2000, height: 3000 } : p));
    const ids = new Set(suggestPhotos(mixed, [], VERTICAL, 6));
    const portraits = mixed.filter((p) => ids.has(p.id) && p.height! > p.width!);
    expect(portraits.length).toBeGreaterThanOrEqual(5);
  });

  it("breaks a run of three photos without people when one with people is spare", () => {
    // Portraits of the venue outscore landscape photos of people for 9:16, so
    // on fit alone the video would hold no one.
    const mixed = day.map((p, i) =>
      i % 2
        ? { ...p, faces: withFaces(someone()) }
        : { ...p, width: 2000, height: 3000, faces: withFaces() },
    );
    const hasPeople = new Set(mixed.filter((_, i) => i % 2).map((p) => p.id));
    const ids = suggestPhotos(mixed, [], VERTICAL, 6);
    expect(ids.some((id) => hasPeople.has(id))).toBe(true);
    for (let i = 2; i < ids.length; i++) {
      expect([ids[i - 2], ids[i - 1], ids[i]].some((id) => hasPeople.has(id!))).toBe(true);
    }
  });

  it("brings in the photos the guests loved, even with no mark of the photographer's", () => {
    // Every photo the same to the highlights; one the guests loved, mid-burst.
    const loved = photo(151, {
      liked: likedScore({ favorites: 9, reactions: 4, printCopies: 3, uniqueViewers: 20 }),
    });
    const ids = suggestPhotos([...day, loved], [], VERTICAL, 6);
    expect(ids).toContain(loved.id);
  });

  it("offers another selection, keeping what is pinned", () => {
    const pinned = photo(2, { pin: true });
    const all = [...day, pinned];
    const first = suggestPhotos(all, [], VERTICAL, 6);
    const second = suggestPhotos(all, [], VERTICAL, 6, { avoid: new Set(first) });
    expect(second).toHaveLength(6);
    expect(second).toContain(pinned.id);
    const repeated = second.filter((id) => id !== pinned.id && first.includes(id));
    expect(repeated).toEqual([]);
  });

  it("visits every chapter of the day it can", () => {
    // Four chapters; the morning's photos the best shape by far.
    const morning = Array.from({ length: 30 }, (_, i) =>
      photo(i * 5, { width: 2000, height: 3000 }),
    );
    const rest = Array.from({ length: 30 }, (_, i) => photo(200 + i * 5));
    const starts = [rest[0]!, rest[10]!, rest[20]!].map(({ key, id }) => ({ key, id }));
    const ids = new Set(suggestPhotos([...morning, ...rest], starts, VERTICAL, 6));
    const chapterOf = (id: string) => {
      const i = rest.findIndex((p) => p.id === id);
      return i < 0 ? 0 : 1 + Math.floor(i / 10);
    };
    expect(new Set([...ids].map(chapterOf))).toEqual(new Set([0, 1, 2, 3]));
  });
});
