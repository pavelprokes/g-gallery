import type { PartPlan, SourceRef } from "./zip-chunk-layout";

/**
 * Assembles one multipart-upload part into a **single** buffer.
 *
 * ## Why this exists as its own module
 *
 * The builder Worker used to do this inline, and did it by buffering every
 * part twice: `Promise.all` over the pieces produced a fully-materialised
 * `Uint8Array` per piece (each source range concatenated out of its stream),
 * and those were then copied a second time into the part buffer. Measured peak
 * for a 6 MiB part: **12 MB live, against 6.1 MB now** — and with
 * `max_batch_size = 10`, ten parts' worth of that per invocation.
 *
 * That is what broke the background archive on 2026-09-01: a 377-photo gallery
 * enqueues 315 part messages at once, Cloudflare scales the consumer to many
 * concurrent invocations *inside one 128 MB isolate*, and the isolate died
 * with `exceededResources` on 718 of 1013 invocations — while burning **less**
 * CPU than the invocations that succeeded, which is what rules CPU out and
 * names memory as the cause. Parts were retried, killed again, dropped after
 * `max_retries`, and the build could never reach `expectedParts`.
 *
 * So the contract here is memory, not convenience: exactly one buffer the size
 * of the part, plus whatever single chunk a source stream is handing over right
 * now. Source ranges are read one at a time on purpose — a `Promise.all` here
 * would hold every piece's chunks simultaneously and hand the isolate back the
 * same problem in a smaller package.
 */

/** Opens one source range for reading. The Worker passes R2; tests pass memory. */
export type RangeReader = (ref: SourceRef) => Promise<ReadableStream<Uint8Array>>;

export async function assemblePart(plan: PartPlan, read: RangeReader): Promise<Uint8Array> {
  const part = new Uint8Array(plan.rangeLength);
  let at = 0;

  for (const piece of plan.pieces) {
    if ("bytes" in piece) {
      // Headers, the central directory and the EOCD are already bytes and are
      // small; they are the one thing that costs nothing to copy.
      if (at + piece.bytes.length > part.length) {
        throw new Error(`part ${plan.partIndex} overflowed at inline piece (offset ${at})`);
      }
      part.set(piece.bytes, at);
      at += piece.bytes.length;
      continue;
    }

    at += await readInto(await read(piece), part, at, piece.rangeLength);
  }

  if (at !== plan.rangeLength) {
    throw new Error(`part ${plan.partIndex} assembled ${at} of ${plan.rangeLength} bytes`);
  }
  return part;
}

/**
 * Drains `stream` straight into `target` at `offset`, never allocating a
 * buffer of its own. Returns how many bytes landed.
 *
 * A source object that hands over more bytes than the range asked for is a
 * hard error rather than a silent truncation: a part that is the right length
 * but the wrong bytes produces an archive that unzips to corrupt photos, which
 * is far worse to discover than a failed build.
 */
async function readInto(
  stream: ReadableStream<Uint8Array>,
  target: Uint8Array,
  offset: number,
  expected: number,
): Promise<number> {
  const reader = stream.getReader();
  let written = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (written + value.length > expected) {
        throw new Error(`source range yielded more than ${expected} bytes`);
      }
      target.set(value, offset + written);
      written += value.length;
    }
  } finally {
    reader.releaseLock();
  }

  if (written !== expected) {
    throw new Error(`source range yielded ${written} of ${expected} bytes`);
  }
  return written;
}
