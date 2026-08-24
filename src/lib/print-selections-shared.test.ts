import { describe, expect, it } from "vitest";
import { MAX_PRINT_QUANTITY, nextPrintQuantity } from "./print-selections-shared";

describe("nextPrintQuantity", () => {
  it("increments by one", () => {
    expect(nextPrintQuantity(0)).toBe(1);
    expect(nextPrintQuantity(1)).toBe(2);
    expect(nextPrintQuantity(98)).toBe(MAX_PRINT_QUANTITY);
  });

  it("wraps back to zero at the max", () => {
    expect(nextPrintQuantity(MAX_PRINT_QUANTITY)).toBe(0);
  });
});
