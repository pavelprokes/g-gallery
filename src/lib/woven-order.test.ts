import { describe, expect, it } from "vitest";
import { isotonicMedian, weaveTimes, type WeaveInput } from "@/lib/woven-order";

const base = Date.UTC(2026, 8, 5, 10, 0);
const min = (n: number) => new Date(base + n * 60_000);

/** Owner photo `svatba_NNNN`, shot at minute `at`. */
const owner = (n: number, at: number): WeaveInput => ({
  id: `o${n}`,
  source: "OWNER",
  fileOrderKey: `svatba${String(n).padStart(4, "0")}`,
  capturedAt: min(at),
});
const guest = (id: string, at: number): WeaveInput => ({
  id,
  source: "GUEST",
  fileOrderKey: `img0044821${id}`,
  capturedAt: min(at),
});

/** Ids in woven order, the way the grid would show them. */
function order(photos: WeaveInput[]): string[] {
  const woven = weaveTimes(photos);
  return photos
    .map((p) => ({ id: p.id, at: woven.get(p.id)!.getTime() }))
    .sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1))
    .map((p) => p.id);
}

describe("weaveTimes", () => {
  it("leaves a genuine pause in the day alone", () => {
    // Ceremony photos, then three hours later the dinner.
    const photos = [owner(0, 0), owner(1, 5), owner(2, 10), owner(3, 190), owner(4, 195)];
    const woven = weaveTimes(photos);
    for (const photo of photos) expect(woven.get(photo.id)).toEqual(photo.capturedAt);
  });

  it("leaves every time alone when the clocks agree with the export", () => {
    const photos = [0, 1, 2, 3, 4, 5].map((n) => owner(n, n * 10));
    const woven = weaveTimes(photos);
    for (const photo of photos) expect(woven.get(photo.id)).toEqual(photo.capturedAt);
  });

  it("keeps the photographer's photos in file-name order when a body's clock ran behind", () => {
    // Export order 0..5; photos 2 and 3 came from a body an hour behind.
    const photos = [
      owner(0, 60),
      owner(1, 70),
      owner(2, 20),
      owner(3, 25),
      owner(4, 90),
      owner(5, 100),
    ];
    expect(order(photos)).toEqual(["o0", "o1", "o2", "o3", "o4", "o5"]);
  });

  it("places a guest's photo among the photographer's by its capture time", () => {
    const photos = [0, 1, 2, 3, 4].map((n) => owner(n, n * 10));
    expect(order([...photos, guest("g", 25)])).toEqual(["o0", "o1", "o2", "g", "o3", "o4"]);
  });

  it("does not let one stray timestamp drag every later photo past the guests", () => {
    // Photo 3's clock says late evening; the rest of the export is 10:00–10:80.
    const photos = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => owner(n, n === 3 ? 700 : n * 10));
    expect(order([...photos, guest("g", 55)])).toEqual([
      "o0",
      "o1",
      "o2",
      "o3",
      "o4",
      "o5",
      "g",
      "o6",
      "o7",
      "o8",
    ]);
  });

  it("keeps a body whose clock ran ahead from carrying the rest of the day along", () => {
    // Photos 3 and 4 came from a body an hour ahead (a run, not a single
    // stray). The guest at 75 belongs between photos 7 and 8 — not before
    // photo 3, where it would land if the early jump lifted everything after.
    const photos = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) =>
      owner(n, n === 3 || n === 4 ? n * 10 + 60 : n * 10),
    );
    const woven = order([...photos, guest("g", 75)]);
    expect(woven.indexOf("g")).toBe(woven.indexOf("o7") + 1);
    expect(woven.filter((id) => id !== "g")).toEqual(photos.map((p) => p.id));
  });

  it("does not let the very first photo's early-running clock hold the gallery back", () => {
    const photos = [owner(0, 300), owner(1, 10), owner(2, 20), owner(3, 30)];
    expect(order([...photos, guest("g", 25)])).toEqual(["o0", "o1", "o2", "g", "o3"]);
  });

  it("keeps guests' own capture times", () => {
    const woven = weaveTimes([owner(0, 0), guest("g", 42)]);
    expect(woven.get("g")).toEqual(min(42));
  });

  it("rises strictly in file-name order, whatever the clocks say", () => {
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const photos = Array.from({ length: 200 }, (_, n) => owner(n, Math.floor(random() * 600)));
    const woven = weaveTimes(photos);
    const inFileOrder = photos.map((p) => woven.get(p.id)!.getTime());
    for (let i = 1; i < inFileOrder.length; i += 1) {
      expect(inFileOrder[i]!).toBeGreaterThan(inFileOrder[i - 1]!);
    }
  });
});

describe("isotonicMedian", () => {
  it("is the identity on values already in order", () => {
    expect(isotonicMedian([1, 2, 2, 5])).toEqual([1, 2, 2, 5]);
  });

  it("pools a violation at its median, not its mean", () => {
    // A mean would drag the pool to 250; the median keeps it with the majority.
    expect(isotonicMedian([10, 1000, 20, 30, 40])).toEqual([10, 20, 20, 30, 40]);
  });
});
