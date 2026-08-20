import { describe, expect, it } from "vitest";
import { hasGpsData, stripGpsFromJpeg } from "./exif-gps";

// Minimal little-endian JPEG carrying EXIF with both an Orientation tag and a
// GPS IFD pointer. Offsets are relative to the TIFF header (`TIFF` below).
//
//   +0  "II", 0x002A, ifd0Offset = 8
//   +8  IFD0: count = 2
//   +10   entry: Orientation (0x0112), SHORT, 1, value 1
//   +22   entry: GPSInfoIFDPointer (0x8825), LONG, 1, value 38
//   +34   next IFD = 0
//   +38 GPS IFD: count = 1
//   +40   entry: GPSLatitude (0x0002), RATIONAL, 3, value offset 56
//   +52   next IFD = 0
//   +56 GPS rational payload (24 bytes, non-zero)
const TIFF_LENGTH = 80;
const GPS_IFD_OFFSET = 38;
const GPS_VALUE_OFFSET = 56;
const GPS_VALUE_BYTES = 24;

function buildJpegWithGps(): { bytes: Uint8Array; tiffStart: number } {
  const tiff = new Uint8Array(TIFF_LENGTH);
  const view = new DataView(tiff.buffer);
  const LE = true;

  tiff[0] = 0x49;
  tiff[1] = 0x49; // "II"
  view.setUint16(2, 0x002a, LE);
  view.setUint32(4, 8, LE);

  view.setUint16(8, 2, LE); // IFD0 entry count

  view.setUint16(10, 0x0112, LE); // Orientation
  view.setUint16(12, 3, LE); // SHORT
  view.setUint32(14, 1, LE);
  view.setUint32(18, 1, LE); // value: 1 (normal)

  view.setUint16(22, 0x8825, LE); // GPSInfoIFDPointer
  view.setUint16(24, 4, LE); // LONG
  view.setUint32(26, 1, LE);
  view.setUint32(30, GPS_IFD_OFFSET, LE);

  view.setUint32(34, 0, LE); // no IFD1

  view.setUint16(GPS_IFD_OFFSET, 1, LE); // GPS IFD entry count
  view.setUint16(GPS_IFD_OFFSET + 2, 0x0002, LE); // GPSLatitude
  view.setUint16(GPS_IFD_OFFSET + 4, 5, LE); // RATIONAL
  view.setUint32(GPS_IFD_OFFSET + 6, 3, LE);
  view.setUint32(GPS_IFD_OFFSET + 10, GPS_VALUE_OFFSET, LE);
  view.setUint32(GPS_IFD_OFFSET + 14, 0, LE); // no next IFD

  // 50°05'N as three rationals — any non-zero payload proves it gets wiped.
  tiff.fill(0x2a, GPS_VALUE_OFFSET, GPS_VALUE_OFFSET + GPS_VALUE_BYTES);

  const app1PayloadLength = 6 + TIFF_LENGTH; // "Exif\0\0" + TIFF
  const bytes = new Uint8Array(2 + 2 + 2 + app1PayloadLength + 2);
  let cursor = 0;
  bytes[cursor++] = 0xff;
  bytes[cursor++] = 0xd8; // SOI
  bytes[cursor++] = 0xff;
  bytes[cursor++] = 0xe1; // APP1
  new DataView(bytes.buffer).setUint16(cursor, app1PayloadLength + 2, false);
  cursor += 2;
  bytes.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], cursor); // "Exif\0\0"
  cursor += 6;
  const tiffStart = cursor;
  bytes.set(tiff, cursor);
  cursor += TIFF_LENGTH;
  bytes[cursor++] = 0xff;
  bytes[cursor++] = 0xd9; // EOI

  return { bytes, tiffStart };
}

describe("exif-gps", () => {
  it("detects GPS data before stripping and not after", () => {
    const { bytes } = buildJpegWithGps();
    expect(hasGpsData(bytes)).toBe(true);
    expect(hasGpsData(stripGpsFromJpeg(bytes))).toBe(false);
  });

  it("removes the GPS pointer entry and decrements the IFD0 count", () => {
    const { bytes, tiffStart } = buildJpegWithGps();
    const out = stripGpsFromJpeg(bytes);
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);

    expect(view.getUint16(tiffStart + 8, true)).toBe(1);
    // The surviving entry is still Orientation = 1.
    expect(view.getUint16(tiffStart + 10, true)).toBe(0x0112);
    expect(view.getUint32(tiffStart + 18, true)).toBe(1);
    // Next-IFD offset moved up into the freed slot.
    expect(view.getUint32(tiffStart + 22, true)).toBe(0);
  });

  it("zeroes the GPS IFD and its out-of-line rational payload", () => {
    const { bytes, tiffStart } = buildJpegWithGps();
    const out = stripGpsFromJpeg(bytes);

    const gpsIfd = out.subarray(tiffStart + GPS_IFD_OFFSET, tiffStart + GPS_VALUE_OFFSET);
    const gpsValues = out.subarray(
      tiffStart + GPS_VALUE_OFFSET,
      tiffStart + GPS_VALUE_OFFSET + GPS_VALUE_BYTES,
    );

    expect(gpsIfd.every((b) => b === 0)).toBe(true);
    expect(gpsValues.every((b) => b === 0)).toBe(true);
  });

  it("preserves overall file length and JPEG markers", () => {
    const { bytes } = buildJpegWithGps();
    const out = stripGpsFromJpeg(bytes);

    expect(out.length).toBe(bytes.length);
    expect(out[0]).toBe(0xff);
    expect(out[1]).toBe(0xd8);
    expect(out[out.length - 2]).toBe(0xff);
    expect(out[out.length - 1]).toBe(0xd9);
  });

  it("returns the exact same reference when there is nothing to strip", () => {
    const noExif = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    expect(stripGpsFromJpeg(noExif)).toBe(noExif);

    const notJpeg = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    expect(stripGpsFromJpeg(notJpeg)).toBe(notJpeg);
    expect(hasGpsData(notJpeg)).toBe(false);
  });

  it("does not mutate the input buffer", () => {
    const { bytes } = buildJpegWithGps();
    const snapshot = new Uint8Array(bytes);
    stripGpsFromJpeg(bytes);
    expect(bytes).toEqual(snapshot);
  });
});
