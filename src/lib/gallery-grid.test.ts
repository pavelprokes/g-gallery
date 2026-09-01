import { describe, expect, it } from "vitest";
import {
  buildGridEntries,
  buildGridNavigation,
  gridEntryKey,
  photoInAdjacentRow,
  type GridEntry,
} from "@/lib/gallery-grid";
import type { GalleryPromo } from "@/lib/promo-card";

type Photo = { id: string };

const photos = (n: number): Photo[] => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));

function promo(overrides: Partial<GalleryPromo> = {}): GalleryPromo {
  return {
    id: "promo-1",
    slot: 5,
    eyebrow: null,
    headline: "Fotil Pavel Prokeš",
    body: null,
    ctaLabel: null,
    ctaUrl: "https://example.com",
    theme: "LIGHT",
    ...overrides,
  };
}

/** The shape `justifyRows` produces, reduced to what the nav builder reads. */
function rowsOf<P>(...rows: GridEntry<P>[][]) {
  return rows.map((items) => ({ items: items.map((item) => ({ item })) }));
}

describe("buildGridEntries", () => {
  it("returns plain photo entries when there are no promos", () => {
    const entries = buildGridEntries(photos(3), []);
    expect(entries).toHaveLength(3);
    expect(entries.every((e) => e.kind === "photo")).toBe(true);
    expect(entries.map((e) => (e.kind === "photo" ? e.photoIndex : -1))).toEqual([0, 1, 2]);
  });

  it("places a slot-5 promo as the 5th tile", () => {
    const entries = buildGridEntries(photos(10), [promo({ slot: 5 })]);
    expect(entries).toHaveLength(11);
    expect(entries[4]!.kind).toBe("promo");
    // The photo that was 5th is now 6th, but keeps photoIndex 4.
    const fifthPhoto = entries[5]!;
    expect(fifthPhoto.kind).toBe("photo");
    expect(fifthPhoto.kind === "photo" && fifthPhoto.photoIndex).toBe(4);
  });

  it("leaves photo indices contiguous and promo-free", () => {
    const entries = buildGridEntries(photos(10), [promo({ slot: 3 }), promo({ id: "b", slot: 8 })]);
    const indices = entries.flatMap((e) => (e.kind === "photo" ? [e.photoIndex] : []));
    expect(indices).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("appends a promo whose slot is past the end of a still-filling gallery", () => {
    const entries = buildGridEntries(photos(2), [promo({ slot: 5 })]);
    expect(entries).toHaveLength(3);
    expect(entries[2]!.kind).toBe("promo");
  });

  it("renders a promo even when the gallery is empty", () => {
    const entries = buildGridEntries([], [promo({ slot: 5 })]);
    expect(entries).toEqual([{ kind: "promo", promo: promo({ slot: 5 }) }]);
  });

  it("orders two promos sharing an index deterministically", () => {
    const a = promo({ id: "a", slot: 2 });
    const b = promo({ id: "b", slot: 2 });
    const forward = buildGridEntries(photos(5), [a, b]);
    const reversed = buildGridEntries(photos(5), [b, a]);
    expect(forward).toEqual(reversed);
    expect(forward[1]!.kind === "promo" && forward[1]!.promo.id).toBe("a");
  });

  it("does not mutate the promos it is given", () => {
    const input = [promo({ slot: 9 }), promo({ id: "b", slot: 2 })];
    const snapshot = JSON.parse(JSON.stringify(input));
    buildGridEntries(photos(20), input);
    expect(input).toEqual(snapshot);
  });
});

describe("gridEntryKey", () => {
  it("namespaces promo keys so they cannot collide with a photo id", () => {
    const entries = buildGridEntries([{ id: "promo-1" }], [promo({ id: "promo-1", slot: 1 })]);
    const keys = entries.map((e) => gridEntryKey(e, (p) => p.id));
    expect(new Set(keys).size).toBe(2);
    expect(keys).toEqual(["promo:promo-1", "photo:promo-1"]);
  });
});

describe("buildGridNavigation", () => {
  it("maps photo indices to rows, ignoring promos", () => {
    const entries = buildGridEntries(photos(4), [promo({ slot: 2 })]);
    // [p0][promo] / [p1][p2] / [p3]
    const nav = buildGridNavigation(
      rowsOf(entries.slice(0, 2), entries.slice(2, 4), entries.slice(4)),
    );
    expect(nav.photoIndicesByRow).toEqual([[0], [1, 2], [3]]);
    expect(nav.rowIndexForPhoto.get(0)).toBe(0);
    expect(nav.rowIndexForPhoto.get(2)).toBe(1);
    expect(nav.rowIndexForPhoto.has(-1)).toBe(false);
  });

  it("yields an empty row for a row that is only a promo", () => {
    const entries = buildGridEntries(photos(2), [promo({ slot: 2 })]);
    const nav = buildGridNavigation(rowsOf([entries[0]!], [entries[1]!], [entries[2]!]));
    expect(nav.photoIndicesByRow).toEqual([[0], [], [1]]);
  });
});

describe("photoInAdjacentRow", () => {
  const nav = buildGridNavigation(
    rowsOf<Photo>(
      [
        { kind: "photo", photo: { id: "p0" }, photoIndex: 0 },
        { kind: "photo", photo: { id: "p1" }, photoIndex: 1 },
        { kind: "photo", photo: { id: "p2" }, photoIndex: 2 },
      ],
      [{ kind: "promo", promo: promo() }],
      [
        { kind: "photo", photo: { id: "p3" }, photoIndex: 3 },
        { kind: "photo", photo: { id: "p4" }, photoIndex: 4 },
      ],
    ),
  );

  it("skips a promo-only row instead of dead-ending on it", () => {
    // Without the skip, ArrowDown from the first row would land nowhere and
    // everything below the card would be unreachable by keyboard.
    expect(photoInAdjacentRow(nav, 0, 1)).toBe(3);
    expect(photoInAdjacentRow(nav, 3, -1)).toBe(0);
  });

  it("clamps to the last column when the next row is shorter", () => {
    expect(photoInAdjacentRow(nav, 2, 1)).toBe(4);
  });

  it("returns null at the edges of the grid", () => {
    expect(photoInAdjacentRow(nav, 0, -1)).toBeNull();
    expect(photoInAdjacentRow(nav, 4, 1)).toBeNull();
  });

  it("returns null for a photo index that is not in the grid", () => {
    expect(photoInAdjacentRow(nav, 99, 1)).toBeNull();
  });
});
