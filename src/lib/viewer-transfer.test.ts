import { describe, expect, it } from "vitest";
import {
  TRANSFER_CODE_LENGTH,
  TRANSFER_CODE_TTL_MS,
  formatTransferCode,
  generateTransferCode,
  normalizeTransferCode,
  transferCodeMaterial,
} from "@/lib/viewer-transfer";

/** Deterministic stand-in for `crypto.getRandomValues`. */
const bytesFrom = (values: number[]) => {
  let i = 0;
  return (n: number) => Uint8Array.from({ length: n }, () => values[i++ % values.length]!);
};

describe("generateTransferCode", () => {
  it("produces a code of the documented length", () => {
    const code = generateTransferCode(bytesFrom([0, 1, 2, 3, 4, 5, 6, 7]));
    expect(code).toHaveLength(TRANSFER_CODE_LENGTH);
  });

  it("only ever emits alphabet characters", () => {
    // Walk every byte value, including the ones rejection sampling must drop.
    const code = generateTransferCode(bytesFrom(Array.from({ length: 256 }, (_, i) => i)));
    expect(code).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]+$/);
  });

  it("never emits a character a person would misread", () => {
    const code = generateTransferCode(bytesFrom(Array.from({ length: 256 }, (_, i) => i)));
    for (const confusable of ["I", "L", "O", "U"]) {
      expect(code).not.toContain(confusable);
    }
  });

  it("keeps drawing when the source hands back only rejected bytes at first", () => {
    // 248..255 are outside the unbiased range and must all be skipped.
    let call = 0;
    const source = (n: number) => {
      call += 1;
      return call === 1
        ? Uint8Array.from({ length: n }, (_, i) => 248 + (i % 8))
        : Uint8Array.from({ length: n }, () => 5);
    };
    expect(generateTransferCode(source)).toHaveLength(TRANSFER_CODE_LENGTH);
  });
});

describe("normalizeTransferCode", () => {
  it("accepts the code exactly as displayed", () => {
    expect(normalizeTransferCode("K7P2-M9XQ")).toBe("K7P2M9XQ");
  });

  it("accepts it without the cosmetic dash, and in any case", () => {
    expect(normalizeTransferCode("k7p2m9xq")).toBe("K7P2M9XQ");
    expect(normalizeTransferCode(" K7P2 M9XQ ")).toBe("K7P2M9XQ");
  });

  it("folds the characters people substitute when reading a code aloud", () => {
    // Somebody says "oh" for zero and the other person types the letter.
    expect(normalizeTransferCode("O7P2M9XQ")).toBe("07P2M9XQ");
    expect(normalizeTransferCode("I7P2M9XQ")).toBe("17P2M9XQ");
    expect(normalizeTransferCode("L7P2M9XQ")).toBe("17P2M9XQ");
    expect(normalizeTransferCode("U7P2M9XQ")).toBe("V7P2M9XQ");
  });

  it("rejects anything that is not a well-formed code", () => {
    expect(normalizeTransferCode("K7P2M9X")).toBeNull(); // too short
    expect(normalizeTransferCode("K7P2M9XQR")).toBeNull(); // too long
    expect(normalizeTransferCode("")).toBeNull();
    expect(normalizeTransferCode("K7P2M9X!")).toBeNull();
    expect(normalizeTransferCode("K7P2M9Xě")).toBeNull();
  });

  it("round-trips whatever generateTransferCode produces", () => {
    for (let seed = 0; seed < 32; seed += 1) {
      const code = generateTransferCode(bytesFrom([seed, seed + 7, seed + 13, seed + 29]));
      expect(normalizeTransferCode(formatTransferCode(code))).toBe(code);
    }
  });
});

describe("formatTransferCode", () => {
  it("groups a full-length code into two blocks of four", () => {
    expect(formatTransferCode("K7P2M9XQ")).toBe("K7P2-M9XQ");
  });

  it("leaves anything else alone rather than mangling it", () => {
    expect(formatTransferCode("SHORT")).toBe("SHORT");
  });
});

describe("transferCodeMaterial", () => {
  it("salts with the gallery id, so the same code cannot resolve elsewhere", () => {
    expect(transferCodeMaterial("gal_a", "K7P2M9XQ")).not.toBe(
      transferCodeMaterial("gal_b", "K7P2M9XQ"),
    );
  });

  it("is stable for the same pair", () => {
    expect(transferCodeMaterial("gal_a", "K7P2M9XQ")).toBe(
      transferCodeMaterial("gal_a", "K7P2M9XQ"),
    );
  });
});

describe("TRANSFER_CODE_TTL_MS", () => {
  it("is long enough to walk to another room and short enough to be worthless later", () => {
    expect(TRANSFER_CODE_TTL_MS).toBeGreaterThanOrEqual(5 * 60 * 1000);
    expect(TRANSFER_CODE_TTL_MS).toBeLessThanOrEqual(60 * 60 * 1000);
  });
});
