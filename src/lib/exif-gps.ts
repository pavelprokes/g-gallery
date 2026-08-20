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
const IFD_ENTRY_BYTES = 12;

/** TIFF field type -> bytes per component. Index is the type code. */
const TYPE_SIZES = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8] as const;

interface ExifSegment {
  /** Offset of the TIFF header (byte-order marker) within the JPEG. */
  tiffStart: number;
  tiffEnd: number;
}

function findExifSegment(bytes: Uint8Array): ExifSegment | null {
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

    if (marker === 0xe1 && payloadEnd - payloadStart >= 8) {
      const isExif =
        bytes[payloadStart] === 0x45 && // E
        bytes[payloadStart + 1] === 0x78 && // x
        bytes[payloadStart + 2] === 0x69 && // i
        bytes[payloadStart + 3] === 0x66 && // f
        bytes[payloadStart + 4] === 0x00 &&
        bytes[payloadStart + 5] === 0x00;
      if (isExif) return { tiffStart: payloadStart + 6, tiffEnd: payloadEnd };
    }

    offset = payloadEnd;
  }

  return null;
}

interface TiffHeader {
  littleEndian: boolean;
  ifd0Offset: number;
}

function readTiffHeader(view: DataView, tiffStart: number): TiffHeader | null {
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

/** True if the JPEG carries a GPS IFD pointer in IFD0. */
export function hasGpsData(input: Uint8Array): boolean {
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
 * (orientation, copyright, camera, timestamps).
 *
 * Returns the input unchanged when there is nothing to strip, so callers can
 * cheaply skip re-hashing.
 */
export function stripGpsFromJpeg(input: Uint8Array): Uint8Array {
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

/** Convenience wrapper for the upload pipeline. */
export async function stripGpsFromFile(file: File): Promise<Blob> {
  if (!file.type.includes("jpeg")) return file;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const stripped = stripGpsFromJpeg(bytes);
  if (stripped === bytes) return file;
  return new Blob([stripped as BlobPart], { type: file.type });
}
