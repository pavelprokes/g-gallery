/**
 * The little an upload needs from an MP4's `moov` box (docs/VIDEO.md §3):
 * when it was recorded, and where — so the "where" can be removed before the
 * bytes leave the browser, as it is for a photo's EXIF GPS (invariant 2).
 *
 * Only box headers and the `moov` box itself are read, never the media data:
 * a film is up to 2 GB and the metadata is a few hundred kilobytes at one end
 * of it. Pure and DOM-free so it is unit-tested against crafted bytes.
 */

/** Seconds between the QuickTime epoch (1904-01-01) and the Unix one. */
const QUICKTIME_EPOCH_OFFSET_S = 2_082_844_800;

/** A `moov` larger than this is not read — metadata is never this big. */
export const MAX_MOOV_BYTES = 64 * 1024 * 1024;

export interface Mp4Location {
  /** Byte offset of the `moov` box in the file. */
  offset: number;
  size: number;
}

/** Reads `size` bytes at `offset`. Abstracted so tests need no Blob. */
export type ReadRange = (offset: number, size: number) => Promise<Uint8Array>;

export function blobReader(blob: Blob): ReadRange {
  return async (offset, size) =>
    new Uint8Array(await blob.slice(offset, offset + size).arrayBuffer());
}

function fourcc(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);
}

function u32(bytes: Uint8Array, at: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + at, 4).getUint32(0);
}

function u64(bytes: Uint8Array, at: number): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset + at, 8);
  return view.getUint32(0) * 2 ** 32 + view.getUint32(4);
}

/**
 * Walks the top-level boxes until `moov`. Returns null for anything that is
 * not a well-formed ISO BMFF file — the caller treats that as "no metadata",
 * never as a reason to refuse the upload.
 */
export async function findMoov(read: ReadRange, fileSize: number): Promise<Mp4Location | null> {
  let offset = 0;
  // Top-level boxes are few (ftyp, free, mdat, moov, udta); the cap only
  // stops a corrupt file from walking forever.
  for (let boxes = 0; boxes < 64 && offset + 8 <= fileSize; boxes++) {
    const header = await read(offset, 16);
    if (header.length < 8) return null;
    let size = u32(header, 0);
    const type = fourcc(header, 4);
    if (size === 1) {
      if (header.length < 16) return null;
      size = u64(header, 8);
    } else if (size === 0) {
      size = fileSize - offset;
    }
    if (size < 8 || offset + size > fileSize) return null;
    if (type === "moov") return { offset, size };
    offset += size;
  }
  return null;
}

/**
 * `mvhd` creation time as a Date, or null when absent, zero, or not a time
 * anyone could have recorded at. QuickTime defines it as UTC; some cameras
 * write their local clock into it (docs/VIDEO.md §3, a known ceiling).
 */
export function readCreationTime(moov: Uint8Array): Date | null {
  const at = indexOfFourcc(moov, "mvhd");
  if (at < 4) return null;
  const body = at + 4;
  const version = moov[body];
  if (version === undefined) return null;
  const seconds =
    version === 1
      ? body + 12 <= moov.length
        ? u64(moov, body + 4)
        : 0
      : body + 8 <= moov.length
        ? u32(moov, body + 4)
        : 0;
  if (seconds <= QUICKTIME_EPOCH_OFFSET_S) return null;
  return new Date((seconds - QUICKTIME_EPOCH_OFFSET_S) * 1000);
}

function indexOfFourcc(bytes: Uint8Array, name: string): number {
  const [a, b, c, d] = [0, 1, 2, 3].map((i) => name.charCodeAt(i));
  for (let i = 0; i + 4 <= bytes.length; i++) {
    if (bytes[i] === a && bytes[i + 1] === b && bytes[i + 2] === c && bytes[i + 3] === d) return i;
  }
  return -1;
}

/**
 * An ISO 6709 point as phones and cameras write it: `+50.0755+014.4378/`,
 * optionally with altitude (`+235.120`) and a `CRS…` suffix. Signed decimal
 * numbers back to back ending in `/` do not occur by chance in the binary
 * tables around them, which is what makes a byte scan safe here.
 */
const ISO6709 =
  /[+-]\d{1,3}(?:\.\d+)?[+-]\d{1,3}(?:\.\d+)?(?:[+-]\d+(?:\.\d+)?)?(?:CRS[^/]{0,32})?\//g;

/**
 * Overwrites every ISO 6709 location in `moov` with zeros of the same length
 * — `©xyz` and `com.apple.quicktime.location.ISO6709` alike — and returns the
 * patched copy, or null when there was nothing to remove. Same length means
 * no box size changes and no offset table needs rewriting: the file stays
 * byte-for-byte the same shape.
 */
export function zeroLocations(moov: Uint8Array): Uint8Array | null {
  // latin1 maps every byte to one char, so string indices are byte offsets.
  let text = "";
  for (let i = 0; i < moov.length; i += 0x8000) {
    text += String.fromCharCode(...moov.subarray(i, i + 0x8000));
  }
  let patched: Uint8Array | null = null;
  for (const match of text.matchAll(ISO6709)) {
    patched ??= moov.slice();
    const start = match.index;
    for (let i = 0; i < match[0].length; i++) {
      const char = match[0][i]!;
      if (char >= "0" && char <= "9") patched[start + i] = 0x30;
    }
  }
  return patched;
}

export interface Mp4Meta {
  takenAt: Date | null;
  /** The file with its location removed, or the same blob when there was none. */
  body: Blob;
  /** True when a location was found and removed. */
  strippedLocation: boolean;
}

/** Reads the `moov`, never the media data. Any failure: the file as it was. */
export async function readMp4Meta(file: Blob): Promise<Mp4Meta> {
  const untouched = { takenAt: null, body: file, strippedLocation: false };
  try {
    const read = blobReader(file);
    const moov = await findMoov(read, file.size);
    if (!moov || moov.size > MAX_MOOV_BYTES) return untouched;
    const bytes = await read(moov.offset, moov.size);
    const takenAt = readCreationTime(bytes);
    const patched = zeroLocations(bytes);
    if (!patched) return { ...untouched, takenAt };
    // Slices are views onto the original file: no bytes are copied, however
    // large the video.
    const body = new Blob(
      [file.slice(0, moov.offset), patched as BlobPart, file.slice(moov.offset + moov.size)],
      { type: file.type },
    );
    return { takenAt, body, strippedLocation: true };
  } catch {
    return untouched;
  }
}
