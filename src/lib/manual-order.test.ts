import { describe, expect, it } from "vitest";
import { isManualKey, keyBetween, placeBetween, spreadKeys } from "@/lib/manual-order";

const VALID = /^[0-9a-z]*[1-9a-z]$/;

describe("keyBetween", () => {
  it("finds a short key on either side and between", () => {
    expect(keyBetween(null, null)).toBe("i");
    const first = keyBetween(null, "i")!;
    const last = keyBetween("i", null)!;
    expect(first < "i" && "i" < last).toBe(true);
    const mid = keyBetween("a", "c")!;
    expect(mid).toBe("b");
  });

  it("goes a digit deeper when the neighbours are adjacent", () => {
    const key = keyBetween("a", "b")!;
    expect("a" < key && key < "b").toBe(true);
    expect(key).toMatch(VALID);
  });

  it("fits below a key that starts with zeros", () => {
    const key = keyBetween(null, "001")!;
    expect(key < "001").toBe(true);
    expect(key).toMatch(VALID);
  });

  it("has no room between equal keys, or before a key padded with zeros", () => {
    expect(keyBetween("z0019", "z0019")).toBeNull();
    expect(keyBetween("b", "a")).toBeNull();
    expect(keyBetween("a", "a0")).toBeNull();
  });

  it("works between the provisional keys photos get before they are placed", () => {
    // "z" + the file-name key: may end in "0", may be a prefix of another.
    const key = keyBetween("z0019", "z00210")!;
    expect("z0019" < key && key < "z00210").toBe(true);
  });

  it("keeps the order through hundreds of random inserts", () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const keys: string[] = [];
    for (let n = 0; n < 600; n++) {
      const at = Math.floor(random() * (keys.length + 1));
      const key = keyBetween(keys[at - 1] ?? null, keys[at] ?? null)!;
      expect(key).toMatch(VALID);
      keys.splice(at, 0, key);
    }
    expect([...keys].sort()).toEqual(keys);
    expect(new Set(keys).size).toBe(keys.length);
    // Random inserts keep keys short; it is repeated inserts in one gap that grow them.
    expect(Math.max(...keys.map((k) => k.length))).toBeLessThan(12);
  });
});

describe("spreadKeys", () => {
  it("spreads keys of one length in order, with room around each", () => {
    const keys = spreadKeys(600);
    expect(keys).toHaveLength(600);
    expect([...keys].sort()).toEqual(keys);
    expect(new Set(keys).size).toBe(600);
    for (const key of keys) expect(key).toMatch(VALID);
    for (let i = 1; i < keys.length; i++) expect(keyBetween(keys[i - 1]!, keys[i]!)).not.toBeNull();
  });

  it("stays below the provisional keys of photos uploaded later", () => {
    for (const n of [1, 5, 36, 600, 5000]) expect(spreadKeys(n).at(-1)! < "z").toBe(true);
  });

  it("is empty for no photos", () => {
    expect(spreadKeys(0)).toEqual([]);
  });
});

describe("placeBetween", () => {
  it("keeps a photo dropped last below the provisional keys", () => {
    const key = placeBetween("yz", null)!;
    expect(key > "yz" && key < "z").toBe(true);
  });

  it("goes past provisional keys when dropped after one", () => {
    const key = placeBetween("z0019", null)!;
    expect(key > "z0019").toBe(true);
  });
});

describe("isManualKey", () => {
  it("accepts the key alphabet only", () => {
    expect(isManualKey("a0b")).toBe(true);
    expect(isManualKey("A")).toBe(false);
    expect(isManualKey("")).toBe(false);
  });
});
