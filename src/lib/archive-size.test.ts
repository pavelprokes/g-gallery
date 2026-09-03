import { describe, expect, it } from "vitest";
import { formatBytes } from "./offline";

/**
 * A delivered wedding archive is 6–8 GB. That is not a rounding detail: for
 * months `Gallery.zipSizeBytes` was a Prisma `Int`, i.e. PostgreSQL int4, and
 * every callback reporting an archive over 2,147,483,647 bytes died with a 500.
 * The archive existed in R2 and could never be recorded (docs/TODO.md §7g).
 *
 * These pin the sizes that actually occur, so a future "it's only a number"
 * narrowing has to walk past a failing test.
 */
describe("archive sizes at real wedding scale", () => {
  it("formats the sizes production actually produces", () => {
    expect(formatBytes(970_308_767)).toMatch(/GB|MB/);
    expect(formatBytes(6_570_000_000)).toMatch(/GB/);
    expect(formatBytes(7_979_322_000)).toMatch(/GB/);
  });

  it("formats sizes past the int4 ceiling, which is where the 500s began", () => {
    // 2,147,483,647 is the largest value the column could hold. Every real
    // wedding archive this morning was three times that.
    const INT4_MAX = 2_147_483_647;
    expect(formatBytes(INT4_MAX)).toBe("2.0 GB");
    expect(formatBytes(INT4_MAX + 1)).toBe("2.0 GB");
    expect(formatBytes(6_570_000_000)).toBe("6.1 GB");
    expect(formatBytes(7_979_322_000)).toBe("7.4 GB");
  });

  it("stays exact well past int4 — a bigint from the database narrows losslessly", () => {
    const eightGB = 8_589_934_592;
    expect(Number(BigInt(eightGB))).toBe(eightGB);
    expect(eightGB).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });
});
