import { afterEach, describe, expect, it, vi } from "vitest";
import { randomId } from "./random-id";

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("randomId", () => {
  it("uses randomUUID when the origin is secure enough to have it", () => {
    const randomUUID = vi.fn(() => "11111111-2222-4333-8444-555555555555");
    vi.stubGlobal("crypto", { randomUUID, getRandomValues: () => undefined });

    expect(randomId()).toBe("11111111-2222-4333-8444-555555555555");
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it("falls back to getRandomValues on an insecure origin", () => {
    // This is the case that broke a real upload: a phone on the LAN over plain
    // http has getRandomValues but not randomUUID.
    vi.stubGlobal("crypto", {
      getRandomValues: (array: Uint8Array) => {
        array.fill(0xab);
        return array;
      },
    });

    const id = randomId();
    expect(id).toMatch(UUID_SHAPE);
    // Version and variant bits are still set, so it is a well-formed v4.
    expect(id[14]).toBe("4");
    expect(["8", "9", "a", "b"]).toContain(id[19]);
  });

  it("still returns something usable with no crypto at all", () => {
    vi.stubGlobal("crypto", undefined);

    const id = randomId();
    expect(id.length).toBeGreaterThan(20);
    expect(randomId()).not.toBe(id);
  });

  it("does not collide across many calls", () => {
    const ids = new Set(Array.from({ length: 2000 }, () => randomId()));
    expect(ids.size).toBe(2000);
  });
});
