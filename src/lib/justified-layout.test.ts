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
});
