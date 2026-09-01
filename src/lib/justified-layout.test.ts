import { describe, expect, it } from "vitest";
import { justifyRows } from "./justified-layout";

const GAP = 8;
const TARGET = 200;

function items(aspects: number[]) {
  return aspects.map((aspect, i) => ({ item: `p${i}`, aspect }));
}

describe("justifyRows", () => {
  it("returns nothing for an empty list", () => {
    expect(justifyRows([], 1200, TARGET, GAP)).toEqual([]);
  });

  it("returns nothing for a non-positive container width", () => {
    expect(justifyRows(items([1.5]), 0, TARGET, GAP)).toEqual([]);
  });

  it("packs square photos exactly filling one row", () => {
    // 6 squares at 200px height fill exactly 6*200 + 5*8 = 1240px.
    const rows = justifyRows(items(Array(6).fill(1)), 1240, TARGET, GAP);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.partial).toBe(false);
    expect(rows[0]!.items).toHaveLength(6);
    // Filled exactly: scale factor is 1, height stays at target.
    expect(rows[0]!.height).toBeCloseTo(TARGET, 5);
  });

  it("every completed row's rendered width sums to exactly the container width", () => {
    const rows = justifyRows(items([1.5, 0.8, 1.2, 2.0, 1.0, 0.9, 1.3, 1.7]), 1200, TARGET, GAP);
    for (const row of rows.filter((r) => !r.partial)) {
      const total = row.items.reduce((sum, i) => sum + i.width, 0) + GAP * (row.items.length - 1);
      expect(total).toBeCloseTo(1200, 3);
    }
  });

  it("never crops: every item's rendered aspect ratio matches its source aspect ratio", () => {
    const aspects = [1.5, 0.8, 1.2, 2.0, 1.0, 0.9, 1.3, 1.7, 0.6, 2.4];
    const rows = justifyRows(items(aspects), 1200, TARGET, GAP);
    for (const row of rows) {
      for (const rendered of row.items) {
        const source = aspects[Number(String(rendered.item).slice(1))]!;
        expect(rendered.width / rendered.height).toBeCloseTo(source, 5);
      }
    }
  });

  it("marks a leftover row as partial and does not stretch it", () => {
    // One narrow photo alone in 1200px never reaches the fill threshold.
    const rows = justifyRows(items([0.5]), 1200, TARGET, GAP);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.partial).toBe(true);
    expect(rows[0]!.height).toBe(TARGET);
    expect(rows[0]!.items[0]!.width).toBeCloseTo(0.5 * TARGET, 5);
  });

  it("preserves item order within and across rows", () => {
    const aspects = [1.5, 0.8, 1.2, 2.0, 1.0, 0.9, 1.3, 1.7];
    const rows = justifyRows(items(aspects), 1200, TARGET, GAP);
    const flat = rows.flatMap((r) => r.items.map((i) => i.item));
    expect(flat).toEqual(aspects.map((_, i) => `p${i}`));
  });

  it("handles a large gallery without pathological row counts", () => {
    const aspects = Array.from({ length: 500 }, (_, i) => 0.6 + (i % 5) * 0.4);
    const rows = justifyRows(items(aspects), 1200, TARGET, GAP);
    const totalItems = rows.reduce((sum, r) => sum + r.items.length, 0);
    expect(totalItems).toBe(500);
    // Sanity bound: a 1200px row at ~200px target height fits roughly 4-6
    // items, so 500 items should land well under 200 rows.
    expect(rows.length).toBeLessThan(200);
  });

  describe("with a fixed itemsPerRow (mobile 2-column grid)", () => {
    it("groups every full row to exactly itemsPerRow items regardless of aspect ratio", () => {
      const aspects = [1.5, 0.8, 1.2, 2.0, 1.0, 0.9];
      const rows = justifyRows(items(aspects), 400, TARGET, GAP, 2);
      expect(rows).toHaveLength(3);
      for (const row of rows) expect(row.items).toHaveLength(2);
    });

    it("still never crops: rendered aspect ratio matches source", () => {
      const aspects = [1.5, 0.8, 1.2, 2.0, 1.0, 0.9, 1.3];
      const rows = justifyRows(items(aspects), 400, TARGET, GAP, 2);
      for (const row of rows) {
        for (const rendered of row.items) {
          const source = aspects[Number(String(rendered.item).slice(1))]!;
          expect(rendered.width / rendered.height).toBeCloseTo(source, 5);
        }
      }
    });

    it("scales every full row's width to exactly fill the container", () => {
      const aspects = [1.5, 0.8, 1.2, 2.0];
      const rows = justifyRows(items(aspects), 400, TARGET, GAP, 2);
      for (const row of rows.filter((r) => !r.partial)) {
        const total = row.items.reduce((sum, i) => sum + i.width, 0) + GAP * (row.items.length - 1);
        expect(total).toBeCloseTo(400, 3);
      }
    });

    it("marks a leftover row shorter than itemsPerRow as partial, at target height", () => {
      const rows = justifyRows(items([1.5, 0.8, 1.2]), 400, TARGET, GAP, 2);
      expect(rows).toHaveLength(2);
      expect(rows[1]!.partial).toBe(true);
      expect(rows[1]!.height).toBe(TARGET);
      expect(rows[1]!.items).toHaveLength(1);
    });

    // The bug this guards: a *partial* row kept the target height with no width
    // clamp, so a trailing panorama rendered `aspect * targetRowHeight` wide —
    // 600 px inside a 390 px phone — and the page scrolled sideways, because
    // the row is `flex w-full` with `shrink-0` tiles.
    it("never renders a partial row wider than the container", () => {
      const rows = justifyRows(items([1.5, 1.5, 5]), 390, 120, 4, 2);
      const last = rows.at(-1)!;
      expect(last.partial).toBe(true);
      expect(last.items[0]!.width).toBeLessThanOrEqual(390);
    });

    it("holds that for every aspect ratio a camera or phone can produce", () => {
      // 1:3 vertical panorama through 5:1 horizontal, at a phone width.
      for (const aspect of [0.33, 0.5, 0.667, 0.75, 1, 1.33, 1.5, 1.78, 2, 3, 5]) {
        const rows = justifyRows(items([1.5, 1.5, aspect]), 390, 120, 4, 2);
        const last = rows.at(-1)!;
        const total = last.items.reduce((sum, i) => sum + i.width, 0) + 4 * (last.items.length - 1);
        expect(total, `aspect ${aspect} overflows`).toBeLessThanOrEqual(390 + 0.001);
      }
    });

    it("still never crops a clamped partial row", () => {
      // Clamping must scale the whole tile, not letterbox it.
      const rows = justifyRows(items([1.5, 1.5, 5]), 390, 120, 4, 2);
      const tile = rows.at(-1)!.items[0]!;
      expect(tile.width / tile.height).toBeCloseTo(5, 5);
    });

    it("leaves a partial row that already fits at the target height", () => {
      // The clamp is a ceiling, not a resize — a portrait tile is unaffected.
      const rows = justifyRows(items([1.5, 1.5, 0.667]), 390, 120, 4, 2);
      expect(rows.at(-1)!.height).toBe(120);
    });
  });

  // The adaptive branch cannot overflow by construction — its loop only emits a
  // full row once the accumulated width reaches the container, so whatever is
  // left over is narrower than the container by definition. Asserted rather
  // than assumed, since the fixed-column branch above proves the assumption is
  // easy to get wrong.
  it("never renders any row wider than the container, adaptive branch", () => {
    const aspects = [5, 0.33, 1.5, 3, 0.5, 1.78, 2.4, 1, 0.667, 4];
    for (const width of [320, 390, 768, 1440]) {
      const rows = justifyRows(items(aspects), width, TARGET, GAP, undefined);
      for (const row of rows) {
        const total = row.items.reduce((sum, i) => sum + i.width, 0) + GAP * (row.items.length - 1);
        expect(total, `width ${width}`).toBeLessThanOrEqual(width + 0.001);
      }
    }
  });
});
