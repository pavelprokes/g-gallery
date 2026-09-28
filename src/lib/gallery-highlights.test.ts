import { describe, expect, it } from "vitest";
import {
  HIGHLIGHT_COUNT,
  MIN_PHOTOS_FOR_AUTO,
  pickHighlights,
  type HighlightCandidate,
} from "@/lib/gallery-highlights";

const DAY = Date.UTC(2026, 8, 12, 10, 0);

/** A photo `minutes` (+ `seconds`) into the day, id sortable by time. */
function photo(
  minutes: number,
  seconds = 0,
  extra: Partial<HighlightCandidate> = {},
): HighlightCandidate {
  const at = DAY + minutes * 60_000 + seconds * 1000;
  return {
    id: `p${String(at).padStart(16, "0")}`,
    key: new Date(at).toISOString(),
    takenAt: new Date(at).toISOString(),
    rating: 4,
    label: null,
    tagged: false,
    pin: null,
    own: true,
    ...extra,
  };
}

/** Getting ready 0–60, ceremony 120–160, party 240–400: pauses over 20 min. */
function wedding(): HighlightCandidate[] {
  const photos: HighlightCandidate[] = [];
  for (let m = 0; m < 60; m += 2) photos.push(photo(m));
  for (let m = 120; m < 160; m += 1) photos.push(photo(m));
  for (let m = 240; m < 400; m += 2) photos.push(photo(m));
  return photos;
}

const minutesOf = (id: string) => (Number(id.slice(1)) - DAY) / 60_000;

describe("pickHighlights", () => {
  it("walks the whole day when nothing is marked", () => {
    const picks = pickHighlights(wedding());
    expect(picks).toHaveLength(HIGHLIGHT_COUNT);
    const minutes = picks.map((p) => minutesOf(p.id));
    // Every part of the day is represented…
    expect(minutes.some((m) => m < 60)).toBe(true);
    expect(minutes.some((m) => m >= 120 && m < 160)).toBe(true);
    expect(minutes.some((m) => m >= 240)).toBe(true);
    // …in the order the day ran.
    expect(minutes).toEqual([...minutes].sort((a, b) => a - b));
    expect(picks.every((p) => !p.pinned)).toBe(true);
  });

  it("ignores a mark every photo carries, and follows one that sets a photo apart", () => {
    const blanket = wedding().map((p) => ({ ...p, label: "Red" }));
    expect(pickHighlights(blanket)).toEqual(pickHighlights(wedding()));

    const photos = wedding();
    const star = photos.find((p) => minutesOf(p.id) === 131)!;
    star.rating = 5;
    const tagged = photos.find((p) => minutesOf(p.id) === 302)!;
    tagged.tagged = true;
    const green = photos.find((p) => minutesOf(p.id) === 10)!;
    green.label = "Green";

    const ids = pickHighlights(photos).map((p) => p.id);
    expect(ids).toContain(star.id);
    expect(ids).toContain(tagged.id);
    expect(ids).toContain(green.id);
  });

  it("takes one frame of a burst — its best one", () => {
    const photos = wedding().filter((p) => minutesOf(p.id) < 60);
    // Pad past the auto threshold with a second, unmarked part of the day.
    for (let m = 200; photos.length < MIN_PHOTOS_FOR_AUTO + 10; m += 3) photos.push(photo(m));
    const burst = [photo(30, 1), photo(30, 2, { rating: 5 }), photo(30, 3)];
    const ids = pickHighlights([...photos, ...burst]).map((p) => p.id);
    expect(ids).toContain(burst[1]!.id);
    expect(ids).not.toContain(burst[0]!.id);
    expect(ids).not.toContain(burst[2]!.id);
  });

  it("always includes a pinned photo and never an excluded one", () => {
    const photos = wedding();
    const auto = pickHighlights(photos);
    const excluded = auto[3]!.id;
    const pinnedGuest = photo(150, 30, { own: false, pin: true });

    const picks = pickHighlights([
      ...photos.map((p) => (p.id === excluded ? { ...p, pin: false } : p)),
      pinnedGuest,
    ]);
    expect(picks).toHaveLength(HIGHLIGHT_COUNT);
    expect(picks.find((p) => p.id === pinnedGuest.id)?.pinned).toBe(true);
    expect(picks.map((p) => p.id)).not.toContain(excluded);
  });

  it("never fills in a guest's photo on its own", () => {
    const photos = wedding().map((p, i) => (i % 2 ? { ...p, own: false, rating: 5 } : p));
    const guestIds = new Set(photos.filter((p) => !p.own).map((p) => p.id));
    expect(pickHighlights(photos).some((p) => guestIds.has(p.id))).toBe(false);
  });

  it("uses chapters instead of pauses when there are some", () => {
    const photos = wedding();
    // One chapter start at the very end: nearly everything is one part, the
    // last few minutes another — so the split follows the chapter, not the
    // pauses, and the final part still gets its seat.
    const lastPart = photos.filter((p) => minutesOf(p.id) >= 380);
    const start = lastPart[0]!;
    const picks = pickHighlights(photos, [{ key: start.key, id: start.id }]);
    expect(picks.filter((p) => minutesOf(p.id) >= 380)).toHaveLength(1);
  });

  it("does not merge a second camera an hour off into one burst (file-name order)", () => {
    // In file-name order the photos sit where the photographer numbered them,
    // but one camera's clock reads an hour early: going back in time is a gap
    // like going forward is, not a four-second burst.
    const photos = wedding().map((p, i) =>
      i % 3 === 1
        ? { ...p, takenAt: new Date(Date.parse(p.takenAt) - 3_600_000).toISOString() }
        : p,
    );
    const picks = pickHighlights(photos);
    expect(picks).toHaveLength(HIGHLIGHT_COUNT);
    // Spread over the whole day, not collapsed into its first stretch.
    expect(Math.max(...picks.map((p) => minutesOf(p.id)))).toBeGreaterThan(240);
  });

  it("shows only the pins in a small gallery", () => {
    const small = wedding().slice(0, MIN_PHOTOS_FOR_AUTO - 1);
    expect(pickHighlights(small)).toEqual([]);
    const pinned = { ...small[5]!, pin: true };
    expect(pickHighlights([...small.slice(0, 5), pinned, ...small.slice(6)])).toEqual([
      { id: pinned.id, pinned: true },
    ]);
  });

  it("lets pins fill every seat", () => {
    const photos = wedding().map((p, i) => (i < 12 ? { ...p, pin: true } : p));
    const picks = pickHighlights(photos);
    expect(picks).toHaveLength(12);
    expect(picks.every((p) => p.pinned)).toBe(true);
  });

  it("gives a densely shot ceremony its seats — two shooters never make one endless burst", () => {
    const photos: HighlightCandidate[] = [];
    for (let m = 0; m < 60; m += 2) photos.push(photo(m)); // getting ready, sparse
    // 30-minute ceremony, a frame every 3 s from two interleaved cameras.
    for (let t = 0; t < 30 * 60; t += 3) photos.push(photo(120, t));
    for (let m = 240; m < 300; m += 2) photos.push(photo(m)); // party, sparse
    const ceremony = pickHighlights(photos)
      .map((p) => minutesOf(p.id))
      .filter((m) => m >= 120 && m < 150);
    // 600 of the day's 660 photos: the ceremony takes most of the seats.
    expect(ceremony.length).toBeGreaterThanOrEqual(6);
  });

  it("compares a rating only with other ratings, not with photos that carry none", () => {
    // Older uploads without marks, newer ones exported at a blanket 4★.
    const photos = wedding().map((p, i) => ({ ...p, rating: i % 2 ? 4 : null }));
    const withoutMarks = pickHighlights(photos.map((p) => ({ ...p, rating: null })));
    expect(pickHighlights(photos)).toEqual(withoutMarks);
  });

  it("does not put the frame beside a pinned or excluded one into the pick", () => {
    const photos = wedding().filter((p) => minutesOf(p.id) >= 60);
    for (let m = 0; m < 60; m += 3) photos.push(photo(m));
    // A 25-second, 1-fps sequence, all 5★ — two burst windows, the pin in the first.
    const sequence = Array.from({ length: 25 }, (_, t) => photo(30, t + 1, { rating: 5 }));
    const pinned = { ...sequence[14]!, pin: true };
    const ids = pickHighlights([...photos, ...sequence.map((p, i) => (i === 14 ? pinned : p))]).map(
      (p) => p.id,
    );
    expect(ids).toContain(pinned.id);
    // The second window is the same moment a few seconds on: nothing from it.
    const rest = sequence.filter((_, i) => i !== 14).map((p) => p.id);
    expect(ids.filter((id) => rest.includes(id))).toEqual([]);
  });

  it("scores 5★ above the unrated when only the best shots are starred", () => {
    // Lightroom writes no rating for 0★; the upload stores those as 0.
    const photos = wedding().map((p) => ({ ...p, rating: 0 }));
    const star = photos.find((p) => minutesOf(p.id) === 131)!;
    star.rating = 5;
    expect(pickHighlights(photos).map((p) => p.id)).toContain(star.id);
  });
});
