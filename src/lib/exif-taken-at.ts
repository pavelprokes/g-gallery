// Reads when a JPEG was shot — EXIF DateTimeOriginal, in the browser at
// upload and in the backfill script. Pure byte-walking on the same TIFF
// helpers the GPS strip uses; no image library on either side.
//
// Resolution notes:
//   - DateTimeOriginal ("YYYY:MM:DD HH:MM:SS") has one-second resolution;
//     SubSecTimeOriginal adds the fraction where the camera wrote one, which
//     is what keeps a burst in shot order.
//   - OffsetTimeOriginal ("+02:00") pins the instant to a timezone. Without
//     it the wall-clock time is interpreted in the interpreter's local zone —
//     for sorting a single event's photos against each other that is exactly
//     as good, and it degrades gracefully for cameras that never write one.

import {
  findExifSegment,
  readTiffHeader,
  IFD_ENTRY_BYTES,
  TYPE_SIZES,
  type ExifSegment,
  type TiffHeader,
} from "@/lib/exif-gps";

const EXIF_IFD_POINTER_TAG = 0x8769;
const DATE_TIME_ORIGINAL_TAG = 0x9003;
const DATE_TIME_DIGITIZED_TAG = 0x9004;
const IFD0_DATE_TIME_TAG = 0x0132;
const SUBSEC_TIME_ORIGINAL_TAG = 0x9291;
const OFFSET_TIME_ORIGINAL_TAG = 0x9011;
const ASCII_TYPE = 2;

/** EXIF sits in an APP1 segment near the start of the file; a JPEG's segment
 * length field caps any single segment at 64 KiB, so this always covers it
 * (with room for a leading XMP or a bloated maker-note block). */
export const EXIF_SCAN_BYTES = 512 * 1024;

interface IfdReader {
  view: DataView;
  segment: ExifSegment;
  header: TiffHeader;
}

/** ASCII value of `tag` in the IFD at `ifdOffset` (TIFF-relative), or null. */
function readAsciiTag(reader: IfdReader, ifdOffset: number, tag: number): string | null {
  const { view, segment, header } = reader;
  const ifdStart = segment.tiffStart + ifdOffset;
  if (ifdStart + 2 > segment.tiffEnd) return null;

  const count = view.getUint16(ifdStart, header.littleEndian);
  if (ifdStart + 2 + count * IFD_ENTRY_BYTES + 4 > segment.tiffEnd) return null;

  for (let i = 0; i < count; i++) {
    const entry = ifdStart + 2 + i * IFD_ENTRY_BYTES;
    if (view.getUint16(entry, header.littleEndian) !== tag) continue;

    const type = view.getUint16(entry + 2, header.littleEndian);
    if (type !== ASCII_TYPE) return null;
    const componentCount = view.getUint32(entry + 4, header.littleEndian);
    const valueBytes = (TYPE_SIZES[type] ?? 0) * componentCount;

    const valueStart =
      valueBytes > 4
        ? segment.tiffStart + view.getUint32(entry + 8, header.littleEndian)
        : entry + 8;
    if (valueStart < segment.tiffStart || valueStart + valueBytes > segment.tiffEnd) return null;

    let text = "";
    for (let b = 0; b < valueBytes; b++) {
      const code = view.getUint8(valueStart + b);
      if (code === 0) break;
      text += String.fromCharCode(code);
    }
    return text;
  }
  return null;
}

/** LONG value of `tag` (an IFD pointer) in the IFD at `ifdOffset`, or null. */
function readPointerTag(reader: IfdReader, ifdOffset: number, tag: number): number | null {
  const { view, segment, header } = reader;
  const ifdStart = segment.tiffStart + ifdOffset;
  if (ifdStart + 2 > segment.tiffEnd) return null;

  const count = view.getUint16(ifdStart, header.littleEndian);
  if (ifdStart + 2 + count * IFD_ENTRY_BYTES + 4 > segment.tiffEnd) return null;

  for (let i = 0; i < count; i++) {
    const entry = ifdStart + 2 + i * IFD_ENTRY_BYTES;
    if (view.getUint16(entry, header.littleEndian) === tag) {
      return view.getUint32(entry + 8, header.littleEndian);
    }
  }
  return null;
}

/** "YYYY:MM:DD HH:MM:SS" (+ optional subseconds and "+HH:MM" offset) → Date. */
function parseExifDate(value: string, subSec: string | null, offset: string | null): Date | null {
  const match = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(value.trim());
  if (!match) return null;

  const [, year, month, day, hour, minute, second] = match.map(Number) as unknown as number[];
  if (!year || !month || !day || month > 12 || day > 31) return null;
  if (hour! > 23 || minute! > 59 || second! > 60) return null;

  const millis = subSec
    ? Math.round(Number(`0.${subSec.trim().replace(/\D.*$/, "") || "0"}`) * 1000)
    : 0;

  const offsetMatch = offset ? /^([+-])(\d{2}):(\d{2})$/.exec(offset.trim()) : null;
  if (offsetMatch) {
    const sign = offsetMatch[1] === "-" ? -1 : 1;
    const offsetMinutes = sign * (Number(offsetMatch[2]) * 60 + Number(offsetMatch[3]));
    const utc = Date.UTC(year, month! - 1, day!, hour!, minute!, second!, millis);
    return new Date(utc - offsetMinutes * 60_000);
  }

  // No zone recorded: local wall-clock time. Within one event every photo is
  // off by the same amount, so the ordering — the thing this feeds — holds.
  const date = new Date(year, month! - 1, day!, hour!, minute!, second!, millis);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Capture time of a JPEG from its EXIF, or null when there is none to read.
 * Accepts a prefix of the file — anything covering the APP1 segment works.
 */
export function readTakenAtFromJpeg(bytes: Uint8Array): Date | null {
  const segment = findExifSegment(bytes);
  if (!segment) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const header = readTiffHeader(view, segment.tiffStart);
  if (!header) return null;

  const reader: IfdReader = { view, segment, header };

  const exifIfdOffset = readPointerTag(reader, header.ifd0Offset, EXIF_IFD_POINTER_TAG);
  if (exifIfdOffset !== null) {
    const original =
      readAsciiTag(reader, exifIfdOffset, DATE_TIME_ORIGINAL_TAG) ??
      readAsciiTag(reader, exifIfdOffset, DATE_TIME_DIGITIZED_TAG);
    if (original) {
      const parsed = parseExifDate(
        original,
        readAsciiTag(reader, exifIfdOffset, SUBSEC_TIME_ORIGINAL_TAG),
        readAsciiTag(reader, exifIfdOffset, OFFSET_TIME_ORIGINAL_TAG),
      );
      if (parsed) return parsed;
    }
  }

  // Last resort: IFD0's DateTime — file modification in EXIF terms, still
  // closer to the shoot than the upload timestamp is.
  const ifd0Date = readAsciiTag(reader, header.ifd0Offset, IFD0_DATE_TIME_TAG);
  return ifd0Date ? parseExifDate(ifd0Date, null, null) : null;
}

/**
 * Browser-side wrapper: reads only the head of the file (EXIF lives there),
 * so a 40 MB original costs a 512 KiB slice, not a full read. Null when the
 * file is not a JPEG or carries no usable timestamp.
 */
export async function readTakenAtFromFile(file: File): Promise<Date | null> {
  if (!file.type.includes("jpeg")) return null;
  try {
    const head = new Uint8Array(await file.slice(0, EXIF_SCAN_BYTES).arrayBuffer());
    return readTakenAtFromJpeg(head);
  } catch {
    return null;
  }
}
