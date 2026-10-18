import { describe, expect, it } from "vitest";
import { moveItem, slotAt } from "@/lib/reorder";

describe("moveItem", () => {
  it("moves forward and backward, keeping the rest in order", () => {
    expect(moveItem(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
  });

  it("clamps the target and ignores a source out of range", () => {
    expect(moveItem(["a", "b", "c"], 0, 99)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b"], 5, 0)).toEqual(["a", "b"]);
  });
});

describe("slotAt", () => {
  // Two rows of three 100×100 cells, 10 px apart.
  const cell = (col: number, row: number) => ({
    left: col * 110,
    top: row * 110,
    width: 100,
    height: 100,
  });
  const grid = [cell(0, 0), cell(1, 0), cell(2, 0), cell(0, 1), cell(1, 1), cell(2, 1)];

  it("finds the cell under the pointer", () => {
    expect(slotAt(150, 50, grid)).toBe(1);
    expect(slotAt(250, 170, grid)).toBe(5);
  });

  it("picks the row first, so the end of one row is not taken for the next", () => {
    // Past the right edge of the first row, level with it.
    expect(slotAt(400, 40, grid)).toBe(2);
    // Below the grid, under the second column.
    expect(slotAt(150, 400, grid)).toBe(4);
  });

  it("is -1 with nothing to drop on", () => {
    expect(slotAt(0, 0, [])).toBe(-1);
  });
});
