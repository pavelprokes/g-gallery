import { describe, expect, it } from "vitest";
import { assemblePart, type RangeReader } from "./zip-part-assembly";
import { buildZipLayout, partCount, planPart, type ChunkEntry } from "./zip-chunk-layout";

/** Deterministic per-key bytes, so a mis-ordered or mis-ranged read is visible. */
function sourceBytes(key: string, size: number): Uint8Array {
  const seed = [...key].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) out[i] = (seed + i * 97) & 0xff;
  return out;
}

/**
 * Hands bytes over in small chunks, the way R2 does — a reader that only works
 * when the whole range arrives in one `read()` would pass a single-chunk fake
 * and then corrupt every real archive.
 */
function chunkedStream(bytes: Uint8Array, chunkSize = 1024): ReadableStream<Uint8Array> {
  let at = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (at >= bytes.length) {
        controller.close();
        return;
      }
      const end = Math.min(at + chunkSize, bytes.length);
      controller.enqueue(bytes.slice(at, end));
      at = end;
    },
  });
}

function readerFor(entries: readonly ChunkEntry[], onAllocate?: (n: number) => void): RangeReader {
  const objects = new Map(entries.map((e) => [e.key, sourceBytes(e.key, e.size)]));
  return async (ref) => {
    const object = objects.get(ref.key);
    if (!object) throw new Error(`missing ${ref.key}`);
    onAllocate?.(ref.rangeLength);
    return chunkedStream(object.subarray(ref.rangeStart, ref.rangeStart + ref.rangeLength));
  };
}

const entries: ChunkEntry[] = [
  { key: "a.jpg", name: "a.jpg", size: 4000, crc32: 0x11111111 },
  { key: "b.jpg", name: "b.jpg", size: 9000, crc32: 0x22222222 },
  { key: "c.jpg", name: "c.jpg", size: 1500, crc32: 0x33333333 },
];

describe("assemblePart", () => {
  it("reassembles into exactly the archive's own bytes across every part", async () => {
    const layout = buildZipLayout(entries);
    const partSize = 2048;
    const parts = partCount(layout.totalSize, partSize);

    const whole = new Uint8Array(layout.totalSize);
    for (let i = 0; i < parts; i += 1) {
      const plan = planPart(layout, i, partSize);
      const part = await assemblePart(plan, readerFor(entries));
      expect(part.length).toBe(plan.rangeLength);
      whole.set(part, plan.rangeStart);
    }

    // Independently rebuilt reference: every segment laid down at its offset.
    const reference = new Uint8Array(layout.totalSize);
    for (const segment of layout.segments) {
      if (segment.bytes) reference.set(segment.bytes, segment.offset);
      else if (segment.ref) {
        const object = sourceBytes(
          segment.ref.key,
          entries.find((e) => e.key === segment.ref!.key)!.size,
        );
        reference.set(
          object.subarray(segment.ref.rangeStart, segment.ref.rangeStart + segment.ref.rangeLength),
          segment.offset,
        );
      }
    }
    expect(whole).toEqual(reference);
  });

  it("splits a photo across a part boundary without losing or repeating a byte", async () => {
    // 9000-byte "b.jpg" is larger than the 2048-byte part, so it necessarily
    // spans four parts — the case the old double-buffering path got right by
    // accident and the streaming path has to get right on purpose.
    const layout = buildZipLayout(entries);
    const partSize = 2048;
    const plans = Array.from({ length: partCount(layout.totalSize, partSize) }, (_, i) =>
      planPart(layout, i, partSize),
    );
    const spanning = plans.filter((p) =>
      p.pieces.some((piece) => "key" in piece && piece.key === "b.jpg"),
    );
    expect(spanning.length).toBeGreaterThan(1);

    const source = sourceBytes("b.jpg", 9000);
    const collected: number[] = [];
    for (const plan of spanning) {
      for (const piece of plan.pieces) {
        if ("key" in piece && piece.key === "b.jpg") {
          collected.push(
            ...source.subarray(piece.rangeStart, piece.rangeStart + piece.rangeLength),
          );
        }
      }
    }
    expect(new Uint8Array(collected)).toEqual(source);
  });

  it("allocates one part-sized buffer, not one per piece", async () => {
    // The regression that broke production: peak memory scaled with the number
    // of pieces, so many concurrent invocations blew the 128 MB isolate limit.
    // `assemblePart` must never ask the reader for a materialised buffer — it
    // only ever gets a stream and writes through it.
    const layout = buildZipLayout(entries);
    const plan = planPart(layout, 0, 4096);

    let handedOut = 0;
    const part = await assemblePart(
      plan,
      readerFor(entries, (n) => (handedOut += n)),
    );

    expect(part.byteLength).toBe(plan.rangeLength);
    // The only bytes the reader was ever asked for are the ones that end up in
    // this part — no read-ahead, no whole-object reads.
    const fromSources = plan.pieces.reduce(
      (sum, piece) => sum + ("key" in piece ? piece.rangeLength : 0),
      0,
    );
    expect(handedOut).toBe(fromSources);
  });

  it("rejects a source range that comes back short", async () => {
    const layout = buildZipLayout(entries);
    const plan = planPart(layout, 1, 2048);
    const truncating: RangeReader = async (ref) =>
      chunkedStream(sourceBytes(ref.key, ref.rangeLength).subarray(0, ref.rangeLength - 1));

    await expect(assemblePart(plan, truncating)).rejects.toThrow(/yielded \d+ of \d+ bytes/);
  });

  it("rejects a source range that comes back long", async () => {
    const layout = buildZipLayout(entries);
    const plan = planPart(layout, 1, 2048);
    const overrunning: RangeReader = async (ref) =>
      chunkedStream(sourceBytes(ref.key, ref.rangeLength + 64));

    await expect(assemblePart(plan, overrunning)).rejects.toThrow(/more than \d+ bytes/);
  });

  it("handles a single-part archive whose last part is short", async () => {
    const layout = buildZipLayout(entries);
    const plan = planPart(layout, 0, 1024 * 1024);
    const part = await assemblePart(plan, readerFor(entries));
    expect(part.length).toBe(layout.totalSize);
  });
});
