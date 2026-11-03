import { describe, expect, it, vi } from "vitest";
import { createScreenGate } from "./screen-gate";

describe("createScreenGate", () => {
  it("stays shut until opened, then until the screen has drawn", () => {
    const gate = createScreenGate();
    const listener = vi.fn();
    gate.subscribe(listener);
    gate.wait("a");
    gate.wait("b");
    expect(gate.isClear()).toBe(false);
    gate.open();
    expect(gate.isClear()).toBe(false);
    gate.done("a");
    expect(gate.isClear()).toBe(false);
    gate.done("b");
    expect(gate.isClear()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("shuts again when a new screen starts loading, and tells only on a change", () => {
    const gate = createScreenGate();
    gate.open();
    expect(gate.isClear()).toBe(true);
    const listener = vi.fn();
    const unsubscribe = gate.subscribe(listener);
    gate.wait("c");
    gate.wait("c");
    expect(gate.isClear()).toBe(false);
    gate.done("c");
    gate.done("c");
    expect(gate.isClear()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    gate.wait("d");
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
