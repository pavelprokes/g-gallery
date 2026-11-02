import { describe, expect, it } from "vitest";
import { PHOTOS_PAGE_SIZE, decodeCursor, encodeCursor, toPages } from "./photo-cursor";

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

describe("photo cursor", () => {
  it("round-trips a capture-time cursor", () => {
    const key = "2026-08-12T10:30:00.000Z";
    const token = encodeCursor({ order: "TAKEN_AT", key, id: "abc123" });
    expect(decodeCursor(token, "TAKEN_AT")).toEqual({ order: "TAKEN_AT", key, id: "abc123" });
  });

  it("round-trips a file-name cursor", () => {
    const key = "svatba0016p0015d0042738jpg";
    const token = encodeCursor({ order: "FILE_NAME", key, id: "abc123" });
    expect(decodeCursor(token, "FILE_NAME")).toEqual({ order: "FILE_NAME", key, id: "abc123" });
  });

  it("refuses a cursor from the other order", () => {
    const token = encodeCursor({ order: "FILE_NAME", key: "svatba", id: "abc123" });
    expect(decodeCursor(token, "TAKEN_AT")).toBeNull();
  });

  it("still reads a cursor minted before orders existed, as capture time", () => {
    const token = encode({ takenAt: "2026-08-12T10:30:00.000Z", id: "abc123" });
    expect(decodeCursor(token, "TAKEN_AT")).toEqual({
      order: "TAKEN_AT",
      key: "2026-08-12T10:30:00.000Z",
      id: "abc123",
    });
    expect(decodeCursor(token, "FILE_NAME")).toBeNull();
  });

  it("is opaque base64url, not a readable id", () => {
    const token = encodeCursor({ order: "TAKEN_AT", key: new Date().toISOString(), id: "abc123" });
    expect(token).not.toContain("abc123");
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("rejects garbage without throwing", () => {
    for (const bad of ["", "not-base64!!!", "e30=", encode({})]) {
      expect(decodeCursor(bad, "TAKEN_AT")).toBeNull();
    }
  });

  it("rejects a cursor with a missing field", () => {
    expect(
      decodeCursor(encode({ o: "TAKEN_AT", key: new Date().toISOString() }), "TAKEN_AT"),
    ).toBeNull();
  });

  it("rejects a key the order cannot use", () => {
    expect(
      decodeCursor(encode({ o: "TAKEN_AT", key: "not-a-date", id: "x" }), "TAKEN_AT"),
    ).toBeNull();
    expect(
      decodeCursor(encode({ o: "FILE_NAME", key: "Svatba_01", id: "x" }), "FILE_NAME"),
    ).toBeNull();
  });
});

describe("toPages", () => {
  const photos = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `p${i}`,
      orderKey: `k${String(i).padStart(4, "0")}`,
    }));
  const cursorOf = (photo: { id: string; orderKey: string }) =>
    encodeCursor({ order: "FILE_NAME", key: photo.orderKey, id: photo.id });

  it("cuts pages at the page size, each carrying its own last photo's cursor", () => {
    const items = photos(PHOTOS_PAGE_SIZE * 2 + 5);
    const pages = toPages("FILE_NAME", items, true);
    expect(pages.map((page) => page.items.length)).toEqual([PHOTOS_PAGE_SIZE, PHOTOS_PAGE_SIZE, 5]);
    expect(pages[0]!.nextCursor).toBe(cursorOf(items[PHOTOS_PAGE_SIZE - 1]!));
    expect(pages[1]!.nextCursor).toBe(cursorOf(items[PHOTOS_PAGE_SIZE * 2 - 1]!));
    expect(pages[2]!.nextCursor).toBe(cursorOf(items.at(-1)!));
  });

  it("ends without a cursor when nothing follows, also on an exact multiple", () => {
    const pages = toPages("FILE_NAME", photos(PHOTOS_PAGE_SIZE * 2), false);
    expect(pages).toHaveLength(2);
    expect(pages[0]!.nextCursor).not.toBeNull();
    expect(pages[1]!.nextCursor).toBeNull();
  });

  it("gives an empty gallery one empty page, as the first request would", () => {
    expect(toPages("FILE_NAME", [], false)).toEqual([{ items: [], nextCursor: null }]);
  });
});
