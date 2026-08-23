import { describe, expect, it } from "vitest";
import {
  buildZipLayout,
  DEFAULT_PART_SIZE,
  partCount,
  planPart,
  verifyLayoutSize,
  type ChunkEntry,
} from "./zip-chunk-layout";
import { crc32 } from "./crc32";
import { archiveSize, zipStream } from "./zip64";

function fakeFile(byte: number, size: number): Uint8Array {
  return new Uint8Array(size).fill(byte);
}

/** Reference bytes: what the live streaming Worker would actually send. */
async function referenceArchive(
  entries: readonly ChunkEntry[],
  files: ReadonlyMap<string, Uint8Array>,
): Promise<Uint8Array> {
  const stream = zipStream(entries, async (index) => {
    const bytes = files.get(entries[index]!.key)!;
    return new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
  });
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** Assembles every part via `planPart`, resolving R2-range pieces from `files` — exactly what the Worker's Queue consumer does per part, just without R2 in between. */
function assembleViaPlan(
  entries: readonly ChunkEntry[],
  files: ReadonlyMap<string, Uint8Array>,
  partSize: number,
): Uint8Array {
  const layout = buildZipLayout(entries);
  const count = partCount(layout.totalSize, partSize);
  const out = new Uint8Array(layout.totalSize);
  let at = 0;

  for (let i = 0; i < count; i += 1) {
    const plan = planPart(layout, i, partSize);
    expect(plan.rangeStart).toBe(at);
    for (const piece of plan.pieces) {
      if ("bytes" in piece) {
        out.set(piece.bytes, at);
        at += piece.bytes.length;
      } else {
        const full = files.get(piece.key)!;
        out.set(full.subarray(piece.rangeStart, piece.rangeStart + piece.rangeLength), at);
        at += piece.rangeLength;
      }
    }
  }
  expect(at).toBe(layout.totalSize);
  return out;
}

describe("buildZipLayout", () => {
  it("agrees with zip64's own archiveSize", () => {
    const entries: ChunkEntry[] = [
      { key: "a", name: "a.jpg", size: 1234, crc32: crc32(fakeFile(1, 1234)) },
      { key: "b", name: "b.jpg", size: 5678, crc32: crc32(fakeFile(2, 5678)) },
    ];
    const layout = buildZipLayout(entries);
    expect(layout.totalSize).toBe(archiveSize(entries));
    expect(verifyLayoutSize(entries, layout)).toBe(true);
  });
});

describe("partCount", () => {
  it("rounds up, and is never less than 1", () => {
    expect(partCount(0, 100)).toBe(1);
    expect(partCount(1, 100)).toBe(1);
    expect(partCount(100, 100)).toBe(1);
    expect(partCount(101, 100)).toBe(2);
    expect(partCount(250, 100)).toBe(3);
  });
});

describe("planPart", () => {
  it("reconstructs byte-for-byte what the live streaming Worker would send, across an entry boundary mid-part", async () => {
    // Part size deliberately not a multiple of either entry's size, so at
    // least one part boundary falls in the middle of a photo's data.
    const files = new Map([
      ["a", fakeFile(0xaa, 1_000)],
      ["b", fakeFile(0xbb, 1_500)],
      ["c", fakeFile(0xcc, 300)],
    ]);
    const entries: ChunkEntry[] = [...files].map(([key, bytes]) => ({
      key,
      name: `${key}.jpg`,
      size: bytes.length,
      crc32: crc32(bytes),
    }));

    const expected = await referenceArchive(entries, files);
    const partSize = 777; // deliberately awkward relative to the file sizes
    const actual = assembleViaPlan(entries, files, partSize);

    expect(actual).toEqual(expected);
  });

  it("every part except the last is exactly partSize", () => {
    const files = new Map([
      ["a", fakeFile(1, 10_000)],
      ["b", fakeFile(2, 10_000)],
    ]);
    const entries: ChunkEntry[] = [...files].map(([key, bytes]) => ({
      key,
      name: `${key}.jpg`,
      size: bytes.length,
      crc32: crc32(bytes),
    }));
    const partSize = 3_000;
    const layout = buildZipLayout(entries);
    const count = partCount(layout.totalSize, partSize);

    for (let i = 0; i < count; i += 1) {
      const plan = planPart(layout, i, partSize);
      if (i < count - 1) {
        expect(plan.rangeLength).toBe(partSize);
      } else {
        expect(plan.rangeLength).toBeLessThanOrEqual(partSize);
        expect(plan.rangeLength).toBeGreaterThan(0);
      }
    }
  });

  it("handles a single small archive as one (undersized) part", async () => {
    const files = new Map([["a", fakeFile(9, 200)]]);
    const entries: ChunkEntry[] = [
      { key: "a", name: "a.jpg", size: 200, crc32: crc32(files.get("a")!) },
    ];
    const layout = buildZipLayout(entries);
    expect(partCount(layout.totalSize, DEFAULT_PART_SIZE)).toBe(1);

    const expected = await referenceArchive(entries, files);
    const actual = assembleViaPlan(entries, files, DEFAULT_PART_SIZE);
    expect(actual).toEqual(expected);
  });

  it("throws for a part index past the end", () => {
    const entries: ChunkEntry[] = [{ key: "a", name: "a.jpg", size: 10, crc32: 0 }];
    const layout = buildZipLayout(entries);
    expect(() => planPart(layout, 5, 100)).toThrow();
  });
});
