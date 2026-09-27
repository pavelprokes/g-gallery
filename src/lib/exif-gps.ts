// Targeted GPS removal from JPEG EXIF, run in the browser BEFORE upload.
//
// Why not just drop the whole APP1 segment: that would also discard the
// orientation tag (photos would render rotated) and the copyright tag the
// photographer wants delivered. So we surgically remove only the GPS IFD
// pointer from IFD0 and zero the GPS data it referenced.
//
// Delivered variants are already EXIF-free (Cloudflare strips metadata, and
// AVIF/WebP output carries none), but ZIP/direct downloads hand over the
// untouched original — this is the only place GPS gets sanitized.

const GPS_IFD_POINTER_TAG = 0x8825;
export const IFD_ENTRY_BYTES = 12;

/** TIFF field type -> bytes per component. Index is the type code. */
export const TYPE_SIZES = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8] as const;

export interface ExifSegment {
  /** Offset of the TIFF header (byte-order marker) within the JPEG. */
  tiffStart: number;
  tiffEnd: number;
}

/**
 * The payload of the first APP1 segment whose payload starts with `signature`
 * — "Exif\0\0" for EXIF, Adobe's namespace URI for XMP. Offsets are into
 * `bytes`, with the signature already skipped. Null when there is none before
 * the image data, or when the file is not a JPEG.
 */
export function findApp1Segment(
  bytes: Uint8Array,
  signature: string,
): { start: number; end: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null; // not a JPEG

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;

  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null; // marker desync — bail out untouched
    const marker = bytes[offset + 1]!;

    // Standalone markers carry no length field.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      offset += 2;
      continue;
    }
    // Start of scan / end of image: no metadata segments beyond this point.
    if (marker === 0xda || marker === 0xd9) return null;

    const length = view.getUint16(offset + 2, false);
    const payloadStart = offset + 4;
    const payloadEnd = offset + 2 + length;
    if (length < 2 || payloadEnd > bytes.length) return null;

    if (marker === 0xe1 && payloadEnd - payloadStart >= signature.length) {
      let matches = true;
      for (let i = 0; i < signature.length && matches; i++) {
        matches = bytes[payloadStart + i] === signature.charCodeAt(i);
      }
      if (matches) return { start: payloadStart + signature.length, end: payloadEnd };
    }

    offset = payloadEnd;
  }

  return null;
}

const EXIF_SIGNATURE = "Exif\0\0";

/** The APP1 identifier that marks a segment as XMP rather than EXIF. */
export const XMP_SIGNATURE = "http://ns.adobe.com/xap/1.0/\0";

export function findExifSegment(bytes: Uint8Array): ExifSegment | null {
  const segment = findApp1Segment(bytes, EXIF_SIGNATURE);
  // A TIFF header is 8 bytes; `readTiffHeader` reads all of them unchecked.
  if (!segment || segment.end - segment.start < 8) return null;
  return { tiffStart: segment.start, tiffEnd: segment.end };
}

export interface TiffHeader {
  littleEndian: boolean;
  ifd0Offset: number;
}

export function readTiffHeader(view: DataView, tiffStart: number): TiffHeader | null {
  const byteOrder = view.getUint16(tiffStart, false);
  const littleEndian = byteOrder === 0x4949; // "II"
  if (!littleEndian && byteOrder !== 0x4d4d) return null; // neither II nor MM

  if (view.getUint16(tiffStart + 2, littleEndian) !== 0x002a) return null;

  return { littleEndian, ifd0Offset: view.getUint32(tiffStart + 4, littleEndian) };
}

/** Zero the GPS IFD itself plus any out-of-line values its entries point to. */
function zeroGpsData(
  bytes: Uint8Array,
  view: DataView,
  tiffStart: number,
  tiffEnd: number,
  gpsIfdOffset: number,
): void {
  const ifdStart = tiffStart + gpsIfdOffset;
  if (ifdStart + 2 > tiffEnd) return;

  const { littleEndian } = readTiffHeader(view, tiffStart) ?? { littleEndian: true };
  const count = view.getUint16(ifdStart, littleEndian);
  const ifdEnd = ifdStart + 2 + count * IFD_ENTRY_BYTES + 4;
  if (ifdEnd > tiffEnd) return;

  for (let i = 0; i < count; i++) {
    const entry = ifdStart + 2 + i * IFD_ENTRY_BYTES;
    const type = view.getUint16(entry + 2, littleEndian);
    const componentCount = view.getUint32(entry + 4, littleEndian);
    const typeSize = TYPE_SIZES[type] ?? 0;
    const valueBytes = typeSize * componentCount;

    // Values of 4 bytes or less live inline in the entry; larger ones are at
    // an offset relative to the TIFF header.
    if (valueBytes > 4) {
      const valueOffset = tiffStart + view.getUint32(entry + 8, littleEndian);
      if (valueOffset >= tiffStart && valueOffset + valueBytes <= tiffEnd) {
        bytes.fill(0, valueOffset, valueOffset + valueBytes);
      }
    }
  }

  bytes.fill(0, ifdStart, ifdEnd);
}

/** True if the JPEG carries a GPS IFD pointer in IFD0, or a location in its XMP. */
export function hasGpsData(input: Uint8Array): boolean {
  if (xmpGpsValueRanges(input).length > 0) return true;
  const segment = findExifSegment(input);
  if (!segment) return false;

  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const header = readTiffHeader(view, segment.tiffStart);
  if (!header) return false;

  const ifdStart = segment.tiffStart + header.ifd0Offset;
  if (ifdStart + 2 > segment.tiffEnd) return false;

  const count = view.getUint16(ifdStart, header.littleEndian);
  if (ifdStart + 2 + count * IFD_ENTRY_BYTES + 4 > segment.tiffEnd) return false;

  for (let i = 0; i < count; i++) {
    const entry = ifdStart + 2 + i * IFD_ENTRY_BYTES;
    if (view.getUint16(entry, header.littleEndian) === GPS_IFD_POINTER_TAG) return true;
  }
  return false;
}

/**
 * Remove GPS location data from a JPEG, preserving every other EXIF tag
 * (orientation, copyright, camera, timestamps) and the rest of the XMP packet
 * (the photographer's rating and keywords, docs/HIGHLIGHTS.md).
 *
 * Returns the input unchanged when there is nothing to strip, so callers can
 * cheaply skip re-hashing.
 */
export function stripGpsFromJpeg(input: Uint8Array): Uint8Array {
  // Found on the input: stripping EXIF moves nothing outside its own segment,
  // so the XMP offsets hold for the stripped copy too.
  const ranges = xmpGpsValueRanges(input);
  const exifStripped = stripExifGps(input);
  if (ranges.length === 0) return exifStripped;
  // Copy-on-write, like the EXIF step: the input is never modified in place.
  const output = exifStripped === input ? new Uint8Array(input) : exifStripped;
  for (const [from, to] of ranges) output.fill(0x20, from, to);
  return output;
}

/**
 * Where the values of the XMP packet's `exif:GPS…` properties sit — Lightroom
 * copies the location into XMP as well as EXIF, so stripping EXIF alone would
 * still ship it. Blanking the values with spaces keeps every byte where it
 * was: no segment length changes and the packet stays well-formed XML, while
 * the coordinates are gone.
 */
function xmpGpsValueRanges(bytes: Uint8Array): [number, number][] {
  const segment = findApp1Segment(bytes, XMP_SIGNATURE);
  if (!segment) return [];
  // latin1: one character per byte, so string indices are byte offsets.
  const packet = new TextDecoder("latin1").decode(bytes.subarray(segment.start, segment.end));
  const ranges: [number, number][] = [];
  // `d`: the match reports where each group sits, so the value's bytes are
  // located exactly rather than searched for again.
  const property =
    /exif:GPS\w+\s*=\s*(?:"([^"]*)"|'([^']*)')|<exif:GPS(\w+)>([^<]*)<\/exif:GPS\3>/dg;
  for (const match of packet.matchAll(property)) {
    const group = [1, 2, 4].find((g) => match[g] !== undefined)!;
    const [from, to] = match.indices![group]!;
    if (match[group]!.trim() !== "") ranges.push([segment.start + from, segment.start + to]);
  }
  return ranges;
}

function stripExifGps(input: Uint8Array): Uint8Array {
  const segment = findExifSegment(input);
  if (!segment) return input;

  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const header = readTiffHeader(view, segment.tiffStart);
  if (!header) return input;

  const ifdStart = segment.tiffStart + header.ifd0Offset;
  if (ifdStart + 2 > segment.tiffEnd) return input;

  const { littleEndian } = header;
  const count = view.getUint16(ifdStart, littleEndian);
  const entriesEnd = ifdStart + 2 + count * IFD_ENTRY_BYTES;
  if (entriesEnd + 4 > segment.tiffEnd) return input;

  let gpsIndex = -1;
  for (let i = 0; i < count; i++) {
    const entry = ifdStart + 2 + i * IFD_ENTRY_BYTES;
    if (view.getUint16(entry, littleEndian) === GPS_IFD_POINTER_TAG) {
      gpsIndex = i;
      break;
    }
  }
  if (gpsIndex === -1) return input;

  const output = new Uint8Array(input);
  const outView = new DataView(output.buffer);

  const gpsEntry = ifdStart + 2 + gpsIndex * IFD_ENTRY_BYTES;
  const gpsIfdOffset = outView.getUint32(gpsEntry + 8, littleEndian);
  zeroGpsData(output, outView, segment.tiffStart, segment.tiffEnd, gpsIfdOffset);

  // Drop the pointer entry: shift the remaining entries left by one slot, move
  // the next-IFD offset up with them, and decrement the count. Entry values
  // are addressed absolutely from the TIFF header, so nothing else moves. The
  // 12 trailing bytes become unreferenced slack — zero them for cleanliness.
  const nextIfdOffset = outView.getUint32(entriesEnd, littleEndian);
  const tailStart = gpsEntry + IFD_ENTRY_BYTES;
  output.copyWithin(gpsEntry, tailStart, entriesEnd);

  const newEntriesEnd = entriesEnd - IFD_ENTRY_BYTES;
  outView.setUint32(newEntriesEnd, nextIfdOffset, littleEndian);
  output.fill(0, newEntriesEnd + 4, entriesEnd + 4);
  outView.setUint16(ifdStart, count - 1, littleEndian);

  return output;
}
