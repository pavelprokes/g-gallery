import { describe, expect, it } from "vitest";
import { MAX_PRINT_QUANTITY, clampPrintQuantity } from "./print-selections-shared";

describe("clampPrintQuantity", () => {
  it("passes values already in range through unchanged", () => {
    expect(clampPrintQuantity(0)).toBe(0);
    expect(clampPrintQuantity(1)).toBe(1);
    expect(clampPrintQuantity(50)).toBe(50);
  });

  it("floors at zero", () => {
    expect(clampPrintQuantity(-1)).toBe(0);
  });

  it("caps at the max", () => {
    expect(clampPrintQuantity(MAX_PRINT_QUANTITY + 1)).toBe(MAX_PRINT_QUANTITY);
  });
});
