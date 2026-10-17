/**
 * What the uploader needs to know about an MP4 before it leaves the browser
 * (docs/VIDEO.md): when it was made, and whether it carries a location.
 *
 * Only the `moov` box is read — box headers are walked with `Blob.slice`, so a
 * 400 MB file costs a few small reads plus `moov` itself (tens to hundreds of
 * kB), wherever in the file the encoder put it. Location metadata lives in
 * `moov` (`udta/©xyz`, or Apple's `meta/keys` entry), never in the media data.
 */

export interface Mp4Facts {
  /** `mvhd` creation time; null when the encoder left it at zero. */
  createdAt: Date | null;
  /**
   * The file says where it was recorded — invariant 2 forbids storing that.
   * Refused rather than rewritten: an export from an editor never has it, a
   * clip straight off a phone does, and re-exporting is the honest fix.
   */
  hasLocation: boolean;
  /**
   * The video track's sample-entry type: `avc1`/`avc3` for H.264, `hvc1`/`hev1`
   * for HEVC, `av01`, `vp09`… Null when no video track was found. Only H.264
   * plays in every browser; HEVC is what an iPhone records by default and
   * what Safari would happily decode at upload while Chrome and Firefox on
   * Windows cannot play it for the couple afterwards.
   */
  videoCodec: string | null;
}

/** Sample-entry types that mean "this track is video". */
const VIDEO_SAMPLE_ENTRIES = new Set([
  "avc1",
  "avc3",
  "hvc1",
  "hev1",
  "dvh1",
  "dvhe",
  "av01",
  "vp08",
  "vp09",
  "mp4v",
]);

/** H.264 — the one codec the gallery accepts (docs/VIDEO.md). */
export function isH264(codec: string | null): boolean {
  return codec === "avc1" || codec === "avc3";
}

/** Boxes that hold only other boxes, on the way down to `stsd`. */
const CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl"]);

/** Seconds between the MP4 epoch (1904-01-01) and the Unix one. */
const MP4_EPOCH_OFFSET_S = 2_082_844_800;

/** A `moov` larger than this is not something a short video produces. */
const MAX_MOOV_BYTES = 64 * 1024 * 1024;

const MAX_TOP_LEVEL_BOXES = 1_000;

/** `©xyz` — ISO 6709 location in a QuickTime/MP4 user-data box. */
const XYZ_BOX = [0xa9, 0x78, 0x79, 0x7a] as const;

/**
 * An ISO 6709 point as every writer spells it — `+50.0755+014.4378/`, with or
 * without altitude. Matched on the value rather than on a key name, because
 * the key differs by writer: `©xyz` (Android, QuickTime), Apple's
 * `com.apple.quicktime.location.ISO6709`, plain `location` (ffmpeg's
 * `use_metadata_tags`). Eight-plus specific ASCII characters in a row do not
 * turn up in binary tables by chance.
 */
const ISO6709_POINT = /[+-]\d{2}(?:\.\d+)?[+-]\d{3}(?:\.\d+)?/;

/** Null when the blob is not an MP4 this can read (no `moov` found). */
export async function inspectMp4(blob: Blob): Promise<Mp4Facts | null> {
  let position = 0;
  for (let boxes = 0; boxes < MAX_TOP_LEVEL_BOXES && position + 8 <= blob.size; boxes++) {
    const header = new Uint8Array(await blob.slice(position, position + 16).arrayBuffer());
    const box = readBoxHeader(header, 0, blob.size - position);
    if (!box) return null;

    if (box.type === "moov") {
      if (box.size > MAX_MOOV_BYTES) return null;
      const moov = new Uint8Array(await blob.slice(position, position + box.size).arrayBuffer());
      return inspectMoov(moov);
    }
    position += box.size;
  }
  return null;
}

/** `moov` including its own header. Exported for tests. */
export function inspectMoov(moov: Uint8Array): Mp4Facts {
  return {
    createdAt: readCreationTime(moov),
    hasLocation: hasLocation(moov),
    videoCodec: findVideoCodec(moov, 0, moov.length),
  };
}

interface BoxHeader {
  type: string;
  /** Whole box, header included. */
  size: number;
  headerSize: number;
}

function readBoxHeader(bytes: Uint8Array, offset: number, available: number): BoxHeader | null {
  if (offset + 8 > bytes.length) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size32 = view.getUint32(offset);
  const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
  let size = size32;
  let headerSize = 8;
  if (size32 === 1) {
    if (offset + 16 > bytes.length) return null;
    size = Number(view.getBigUint64(offset + 8));
    headerSize = 16;
  } else if (size32 === 0) {
    // "Extends to the end of the file."
    size = available;
  }
  if (size < headerSize || size > available) return null;
  return { type, size, headerSize };
}

function readCreationTime(moov: Uint8Array): Date | null {
  const moovHeader = readBoxHeader(moov, 0, moov.length);
  if (!moovHeader) return null;
  const view = new DataView(moov.buffer, moov.byteOffset, moov.byteLength);

  for (let offset = moovHeader.headerSize; offset < moov.length;) {
    const child = readBoxHeader(moov, offset, moov.length - offset);
    if (!child) return null;
    if (child.type === "mvhd") {
      const body = offset + child.headerSize;
      if (body + 12 > moov.length) return null;
      // Full box: one byte version, three bytes flags, then the times — 32-bit
      // in version 0, 64-bit in version 1.
      const version = moov[body];
      const seconds =
        version === 1 ? Number(view.getBigUint64(body + 4)) : view.getUint32(body + 4);
      if (seconds === 0) return null;
      const date = new Date((seconds - MP4_EPOCH_OFFSET_S) * 1000);
      return Number.isNaN(date.getTime()) ? null : date;
    }
    offset += child.size;
  }
  return null;
}

/** Depth-first through the containers to each `stsd`'s first sample entry. */
function findVideoCodec(bytes: Uint8Array, start: number, end: number): string | null {
  for (let offset = start; offset < end;) {
    const box = readBoxHeader(bytes, offset, end - offset);
    if (!box) return null;
    const body = offset + box.headerSize;
    if (CONTAINERS.has(box.type)) {
      const found = findVideoCodec(bytes, body, offset + box.size);
      if (found) return found;
    } else if (box.type === "stsd") {
      // Full box (4 bytes version/flags), then a 4-byte entry count, then the
      // sample entries, each a box whose type is the codec.
      const entry = readBoxHeader(bytes, body + 8, offset + box.size - (body + 8));
      if (entry && VIDEO_SAMPLE_ENTRIES.has(entry.type)) return entry.type;
    }
    offset += box.size;
  }
  return null;
}

/**
 * `©xyz` is matched as a box — four bytes of plausible size in front of it —
 * so the same four bytes turning up inside a sample table cannot refuse an
 * innocent file. Any other spelling is caught by its value.
 */
function hasLocation(moov: Uint8Array): boolean {
  const view = new DataView(moov.buffer, moov.byteOffset, moov.byteLength);
  for (let i = 4; i + 4 <= moov.length; i++) {
    if (
      moov[i] === XYZ_BOX[0] &&
      moov[i + 1] === XYZ_BOX[1] &&
      moov[i + 2] === XYZ_BOX[2] &&
      moov[i + 3] === XYZ_BOX[3]
    ) {
      const size = view.getUint32(i - 4);
      if (size >= 8 && i - 4 + size <= moov.length) return true;
    }
  }
  // latin1 maps every byte to one character, so offsets survive and nothing
  // throws on binary data.
  return ISO6709_POINT.test(new TextDecoder("latin1").decode(moov));
}
