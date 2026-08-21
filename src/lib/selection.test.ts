import { describe, expect, it } from "vitest";
import {
  clearSelection,
  EMPTY_SELECTION,
  isAllSelected,
  selectAll,
  selectedInOrder,
  selectRange,
  toggleOne,
  type SelectionState,
} from "./selection";

const IDS = ["a", "b", "c", "d", "e"];
const idAt = (i: number) => IDS[i];
const ids = (state: SelectionState) => [...state.ids].sort();

describe("toggleOne", () => {
  it("adds then removes the same photo", () => {
    const added = toggleOne(EMPTY_SELECTION, 0, "a");
    expect(ids(added)).toEqual(["a"]);
    expect(ids(toggleOne(added, 0, "a"))).toEqual([]);
  });

  it("moves the anchor even when deselecting", () => {
    // The next shift-click reaches from the last tile touched, not the last added.
    const state = toggleOne(toggleOne(EMPTY_SELECTION, 0, "a"), 3, "d");
    expect(toggleOne(state, 3, "d").anchorIndex).toBe(3);
  });
});

describe("selectRange", () => {
  it("takes the run between anchor and target, inclusive", () => {
    const anchored = toggleOne(EMPTY_SELECTION, 1, "b");
    expect(ids(selectRange(anchored, 3, idAt))).toEqual(["b", "c", "d"]);
  });

  it("works backwards", () => {
    const anchored = toggleOne(EMPTY_SELECTION, 3, "d");
    expect(ids(selectRange(anchored, 1, idAt))).toEqual(["b", "c", "d"]);
  });

  it("only ever adds — a range never deselects part of itself", () => {
    // Shift-clicking across a partly selected run must not remove the overlap.
    let state = toggleOne(EMPTY_SELECTION, 2, "c");
    state = toggleOne(state, 0, "a");
    expect(ids(selectRange(state, 3, idAt))).toEqual(["a", "b", "c", "d"]);
  });

  it("keeps the anchor so repeated shift-clicks grow one range", () => {
    const anchored = toggleOne(EMPTY_SELECTION, 1, "b");
    const first = selectRange(anchored, 2, idAt);
    expect(first.anchorIndex).toBe(1);
    expect(ids(selectRange(first, 4, idAt))).toEqual(["b", "c", "d", "e"]);
  });

  it("behaves like a plain click when there is no anchor", () => {
    expect(ids(selectRange(EMPTY_SELECTION, 2, idAt))).toEqual(["c"]);
  });

  it("ignores indexes past the end rather than adding undefined", () => {
    const anchored = toggleOne(EMPTY_SELECTION, 4, "e");
    const state = selectRange(anchored, 99, idAt);
    expect([...state.ids].every(Boolean)).toBe(true);
    expect(ids(state)).toEqual(["e"]);
  });
});

describe("selectedInOrder", () => {
  it("follows gallery order, not click order", () => {
    // The ZIP entries must come out in the order the viewer sees them.
    let state = toggleOne(EMPTY_SELECTION, 4, "e");
    state = toggleOne(state, 0, "a");
    state = toggleOne(state, 2, "c");
    expect(selectedInOrder(state, IDS)).toEqual(["a", "c", "e"]);
  });

  it("is empty for an empty selection", () => {
    expect(selectedInOrder(EMPTY_SELECTION, IDS)).toEqual([]);
  });
});

describe("selectAll / clearSelection", () => {
  it("selects everything and reports it", () => {
    const state = selectAll(IDS);
    expect(state.ids.size).toBe(5);
    expect(isAllSelected(state, IDS)).toBe(true);
  });

  it("clears back to empty", () => {
    expect(clearSelection().ids.size).toBe(0);
  });

  it("does not call an empty gallery fully selected", () => {
    expect(isAllSelected(EMPTY_SELECTION, [])).toBe(false);
  });
});
