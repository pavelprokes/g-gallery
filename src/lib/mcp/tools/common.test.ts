import { describe, expect, it } from "vitest";
import { dayInput } from "./common";

describe("dayInput", () => {
  it("accepts real calendar days", () => {
    for (const day of ["2026-08-12", "2028-02-29", "2026-12-31"]) {
      expect(dayInput.safeParse(day).success).toBe(true);
    }
  });

  it("refuses days that would roll over into the next month", () => {
    for (const day of ["2026-02-30", "2027-02-29", "2026-04-31", "2026-13-01", "12. 8. 2026"]) {
      expect(dayInput.safeParse(day).success).toBe(false);
    }
  });
});
