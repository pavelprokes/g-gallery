import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createScreenGate, rowMayFetch } from "./screen-gate";

describe("createScreenGate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  /** Long enough that the row just finished does not count as a quick one. */
  const slowly = () => vi.advanceTimersByTime(1000);

  it("stays shut until opened, then goes a row at a time from the top", () => {
    const gate = createScreenGate();
    const listener = vi.fn();
    gate.subscribe(listener);
    // Registered bottom up on purpose: the turn is the top row, not the first to arrive.
    gate.wait("c", 2);
    gate.wait("a", 0);
    gate.wait("b", 0);
    expect(gate.turn()).toBe(-1);
    gate.open();
    expect(gate.turn()).toBe(0);
    slowly();
    gate.done("a");
    expect(gate.turn()).toBe(0);
    gate.done("b");
    expect(gate.turn()).toBe(2);
    slowly();
    gate.done("c");
    expect(gate.turn()).toBe(Infinity);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("is clear at once with nothing on screen to wait for", () => {
    const gate = createScreenGate();
    gate.open();
    expect(gate.turn()).toBe(Infinity);
  });

  it("starts again at the row a new screen begins with, and tells only on a change", () => {
    const gate = createScreenGate();
    gate.open();
    const listener = vi.fn();
    const unsubscribe = gate.subscribe(listener);
    gate.wait("d", 5);
    gate.wait("d", 5);
    gate.wait("e", 6);
    expect(gate.turn()).toBe(5);
    slowly();
    gate.done("d");
    gate.done("d");
    expect(gate.turn()).toBe(6);
    slowly();
    gate.done("e");
    expect(gate.turn()).toBe(Infinity);
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
    gate.wait("f", 7);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("does not move back for a row coming on screen above: it goes at once beside the rest", () => {
    const gate = createScreenGate();
    gate.wait("g", 6);
    gate.wait("h", 7);
    gate.open();
    expect(gate.turn()).toBe(6);
    gate.wait("above", 4);
    expect(gate.turn()).toBe(6);
    slowly();
    gate.done("g");
    // The row above is still within the turn, so the row below it waits for it too.
    expect(gate.turn()).toBe(6);
    gate.done("above");
    expect(gate.turn()).toBe(7);
  });

  it("starts from the top of a new screen when a jump up leaves the old one entirely", () => {
    const gate = createScreenGate();
    gate.wait("old", 40);
    gate.open();
    slowly();
    gate.done("old");
    gate.wait("new-top", 2);
    gate.wait("new-below", 3);
    expect(gate.turn()).toBe(2);
  });

  it("lets the rest of the screen go together after a row that came back at once", () => {
    const gate = createScreenGate();
    gate.wait("a", 0);
    gate.wait("b", 1);
    gate.wait("c", 2);
    gate.open();
    expect(gate.turn()).toBe(0);
    vi.advanceTimersByTime(999);
    gate.done("a");
    expect(gate.turn()).toBe(2);
  });

  it("does not take a screen's first row for a quick one just because the last screen ended", () => {
    const gate = createScreenGate();
    gate.open();
    gate.wait("a", 0);
    gate.wait("b", 1);
    expect(gate.turn()).toBe(0);
  });

  it("lets the next row go beside a stalled one, and the one after if nothing draws still", () => {
    const gate = createScreenGate();
    gate.wait("stalled", 0);
    gate.wait("b", 1);
    gate.wait("c", 2);
    gate.open();
    vi.advanceTimersByTime(4_999);
    expect(gate.turn()).toBe(0);
    vi.advanceTimersByTime(1);
    expect(gate.turn()).toBe(1);
    vi.advanceTimersByTime(5_000);
    expect(gate.turn()).toBe(2);
    // Off screen stays shut: the stalled tile has not given up yet.
    expect(rowMayFetch(gate.turn(), 9, false)).toBe(false);
  });

  it("counts any tile drawing as progress, not a stall", () => {
    const gate = createScreenGate();
    gate.wait("a", 0);
    gate.wait("b", 0);
    gate.wait("c", 1);
    gate.open();
    vi.advanceTimersByTime(4_000);
    gate.done("a");
    vi.advanceTimersByTime(4_000);
    expect(gate.turn()).toBe(0);
    gate.done("b");
    expect(gate.turn()).toBe(1);
  });
});

describe("rowMayFetch", () => {
  it("lets a row on screen go once its turn has come", () => {
    expect(rowMayFetch(-1, 0, true)).toBe(false);
    expect(rowMayFetch(3, 2, true)).toBe(true);
    expect(rowMayFetch(3, 3, true)).toBe(true);
    expect(rowMayFetch(3, 4, true)).toBe(false);
  });

  it("does not let a row just coming on screen go before its tiles have registered", () => {
    expect(rowMayFetch(Infinity, 3, true)).toBe(false);
  });

  it("lets a row off screen go only with nothing on screen left", () => {
    expect(rowMayFetch(-1, 9, false)).toBe(false);
    expect(rowMayFetch(10, 9, false)).toBe(false);
    expect(rowMayFetch(Infinity, 9, false)).toBe(true);
  });
});
