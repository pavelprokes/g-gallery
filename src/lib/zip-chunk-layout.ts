/**
 * Splits a store-only ZIP64 archive (`zip64.ts`) into fixed-size, independent
 * parts for R2 multipart upload — the piece that makes background ZIP
 * building possible on Cloudflare's **free** Workers tier (docs/TODO.md §7).
 *
 * The key property this relies on: `localHeader`/`centralHeader`/
 * `endOfCentralDirectory` are pure functions of entry metadata (name, size,
 * crc32) — none of it needs a single byte of file data. That means the exact
 * byte layout of the whole archive is known before anything is read from R2,
 * so every part can be computed **independently**, in any order, by any
 * Worker invocation: no rolling buffer, no state carried between calls, no
 * ordering requirement. Each part-build message is self-contained.
 *
 * R2 multipart upload requires every part except the last to be the *same*
 * size (not just independently ≥5 MiB) — `planPart` produces exactly that by
 * cutting fixed-size windows out of the logical byte stream, regardless of
 * where photo boundaries fall inside them.
 */

import {
  archiveSize,
  centralHeader,
  endOfCentralDirectory,
  localHeader,
  type ZipEntry,
} from "./zip64";

/** R2's multipart minimum — every part except the last must be at least this. */
export const MIN_PART_SIZE = 5 * 1024 * 1024;

/** Default part size: comfortably above the R2 minimum, small enough that
 * building one part (a couple of R2 range reads + one upload) stays well
 * inside the Workers Free 10 ms CPU budget — this is bulk byte-copying, not
 * the many-small-chunks pattern that made the live streaming Worker need
 * Workers Paid. */
export const DEFAULT_PART_SIZE = 6 * 1024 * 1024;

export interface ChunkEntry extends ZipEntry {
  /** R2 object key to read this entry's bytes from. */
  key: string;
}

/** One R2 range read backing (part of) a segment's bytes. */
export interface SourceRef {
  key: string;
  rangeStart: number;
  rangeLength: number;
}

interface Segment {
  /** Byte offset in the *final archive*, not in any source object. */
  offset: number;
  length: number;
  /** Fully materialised bytes (a header, the central directory, or the EOCD) — mutually exclusive with `ref`. */
  bytes?: Uint8Array;
  /** Bytes must be read from R2 — mutually exclusive with `bytes`. */
  ref?: SourceRef;
}

export interface ZipLayout {
  totalSize: number;
  segments: readonly Segment[];
}

/** One piece of a part's content: either inline bytes or an R2 range to fetch. */
export type PartPiece = { bytes: Uint8Array } | SourceRef;

export interface PartPlan {
  partIndex: number;
  /** 1-indexed, as R2's `uploadPart` expects. */
  partNumber: number;
  rangeStart: number;
  rangeLength: number;
  pieces: readonly PartPiece[];
}

/**
 * Computes the whole archive's byte layout without reading any file data —
 * mirrors `archiveSize`'s walk exactly, but keeps every segment (not just the
 * total) so a part can be sliced out of it later.
 */
export function buildZipLayout(entries: readonly ChunkEntry[]): ZipLayout {
  const segments: Segment[] = [];
  const headerOffsets: number[] = [];
  let offset = 0;

  for (const entry of entries) {
    headerOffsets.push(offset);
    const header = localHeader(entry);
    segments.push({ offset, length: header.length, bytes: header });
    offset += header.length;

    if (entry.size > 0) {
      segments.push({
        offset,
        length: entry.size,
        ref: { key: entry.key, rangeStart: 0, rangeLength: entry.size },
      });
      offset += entry.size;
    }
  }

  const centralOffset = offset;
  entries.forEach((entry, index) => {
    const central = centralHeader(entry, headerOffsets[index]!);
    segments.push({ offset, length: central.length, bytes: central });
    offset += central.length;
  });
  const centralSize = offset - centralOffset;

  const eocd = endOfCentralDirectory(entries.length, centralSize, centralOffset);
  segments.push({ offset, length: eocd.length, bytes: eocd });
  offset += eocd.length;

  return { totalSize: offset, segments };
}

/** How many parts a `partSize`-chunked upload of `totalSize` bytes needs. Always ≥1 — a single small archive is still one (undersized, and that's allowed) part. */
export function partCount(totalSize: number, partSize: number = DEFAULT_PART_SIZE): number {
  return Math.max(1, Math.ceil(totalSize / partSize));
}

/**
 * The exact byte content of part `partIndex` (0-indexed), expressed as an
 * ordered list of pieces to concatenate — inline bytes for headers/central
 * directory/EOCD, R2 range reads for file data. Pure: does no I/O itself, so
 * it's cheap to call from any invocation without re-deriving state.
 */
export function planPart(
  layout: ZipLayout,
  partIndex: number,
  partSize: number = DEFAULT_PART_SIZE,
): PartPlan {
  const rangeStart = partIndex * partSize;
  const rangeEnd = Math.min(rangeStart + partSize, layout.totalSize);
  if (rangeStart >= rangeEnd) {
    throw new Error(`part ${partIndex} is out of range for a ${layout.totalSize}-byte archive`);
  }

  const pieces: PartPiece[] = [];
  for (const segment of layout.segments) {
    const segmentEnd = segment.offset + segment.length;
    const overlapStart = Math.max(segment.offset, rangeStart);
    const overlapEnd = Math.min(segmentEnd, rangeEnd);
    if (overlapStart >= overlapEnd) continue;

    const localStart = overlapStart - segment.offset;
    const localLength = overlapEnd - overlapStart;

    if (segment.bytes) {
      pieces.push({ bytes: segment.bytes.subarray(localStart, localStart + localLength) });
    } else if (segment.ref) {
      pieces.push({
        key: segment.ref.key,
        rangeStart: segment.ref.rangeStart + localStart,
        rangeLength: localLength,
      });
    }
  }

  return {
    partIndex,
    partNumber: partIndex + 1,
    rangeStart,
    rangeLength: rangeEnd - rangeStart,
    pieces,
  };
}

/** Cross-check against `zip64.ts`'s own total — the two must always agree. */
export function verifyLayoutSize(entries: readonly ChunkEntry[], layout: ZipLayout): boolean {
  return layout.totalSize === archiveSize(entries);
}
