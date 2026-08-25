import { describe, expect, it } from "vitest";
import { readTakenAtFromJpeg } from "./exif-taken-at";

// Minimal little-endian JPEG whose EXIF carries a DateTimeOriginal (with
// subseconds and a timezone offset) in the Exif IFD, plus a different
// DateTime in IFD0 to prove precedence. Offsets are TIFF-relative.
const EXIF_IFD_OFFSET = 38;
const DTO_OFFSET = 80;
const IFD0_DT_OFFSET = 100;
const TZ_OFFSET = 120;
const TIFF_LENGTH = 128;

function writeAscii(tiff: Uint8Array, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) tiff[offset + i] = text.charCodeAt(i);
}

function buildTiff(options: { withExifIfd: boolean }): Uint8Array {
  const tiff = new Uint8Array(TIFF_LENGTH);
  const view = new DataView(tiff.buffer);
  const LE = true;

  tiff[0] = 0x49;
  tiff[1] = 0x49; // "II"
  view.setUint16(2, 0x002a, LE);
  view.setUint32(4, 8, LE);

  view.setUint16(8, 2, LE); // IFD0: two entries

  if (options.withExifIfd) {
    view.setUint16(10, 0x8769, LE); // ExifIFDPointer
    view.setUint16(12, 4, LE); // LONG
    view.setUint32(14, 1, LE);
    view.setUint32(18, EXIF_IFD_OFFSET, LE);
  } else {
    view.setUint16(10, 0x0112, LE); // Orientation, as filler
    view.setUint16(12, 3, LE);
    view.setUint32(14, 1, LE);
    view.setUint32(18, 1, LE);
  }

  view.setUint16(22, 0x0132, LE); // IFD0 DateTime
  view.setUint16(24, 2, LE); // ASCII
  view.setUint32(26, 20, LE);
  view.setUint32(30, IFD0_DT_OFFSET, LE);

  view.setUint32(34, 0, LE); // no IFD1

  view.setUint16(EXIF_IFD_OFFSET, 3, LE); // Exif IFD: three entries

  view.setUint16(EXIF_IFD_OFFSET + 2, 0x9003, LE); // DateTimeOriginal
  view.setUint16(EXIF_IFD_OFFSET + 4, 2, LE);
  view.setUint32(EXIF_IFD_OFFSET + 6, 20, LE);
  view.setUint32(EXIF_IFD_OFFSET + 10, DTO_OFFSET, LE);

  view.setUint16(EXIF_IFD_OFFSET + 14, 0x9291, LE); // SubSecTimeOriginal
  view.setUint16(EXIF_IFD_OFFSET + 16, 2, LE);
  view.setUint32(EXIF_IFD_OFFSET + 18, 3, LE); // "42\0" fits inline
  writeAscii(tiff, EXIF_IFD_OFFSET + 22, "42\0");

  view.setUint16(EXIF_IFD_OFFSET + 26, 0x9011, LE); // OffsetTimeOriginal
  view.setUint16(EXIF_IFD_OFFSET + 28, 2, LE);
  view.setUint32(EXIF_IFD_OFFSET + 30, 7, LE);
  view.setUint32(EXIF_IFD_OFFSET + 34, TZ_OFFSET, LE);

  view.setUint32(EXIF_IFD_OFFSET + 38, 0, LE); // no next IFD

  writeAscii(tiff, DTO_OFFSET, "2026:08:22 14:03:05\0");
  writeAscii(tiff, IFD0_DT_OFFSET, "2026:08:23 18:00:00\0");
  writeAscii(tiff, TZ_OFFSET, "+02:00\0");

  return tiff;
}

function wrapInJpeg(tiff: Uint8Array): Uint8Array {
  const app1PayloadLength = 6 + tiff.length; // "Exif\0\0" + TIFF
  const bytes = new Uint8Array(2 + 2 + 2 + app1PayloadLength + 2);
  const view = new DataView(bytes.buffer);
  let cursor = 0;
  bytes[cursor++] = 0xff;
  bytes[cursor++] = 0xd8; // SOI
  bytes[cursor++] = 0xff;
  bytes[cursor++] = 0xe1; // APP1
  view.setUint16(cursor, 2 + app1PayloadLength, false);
  cursor += 2;
  writeAscii(bytes, cursor, "Exif\0\0");
  cursor += 6;
  bytes.set(tiff, cursor);
  cursor += tiff.length;
  bytes[cursor++] = 0xff;
  bytes[cursor] = 0xd9; // EOI
  return bytes;
}

describe("readTakenAtFromJpeg", () => {
  it("reads DateTimeOriginal with subseconds and timezone offset", () => {
    const takenAt = readTakenAtFromJpeg(wrapInJpeg(buildTiff({ withExifIfd: true })));
    expect(takenAt).not.toBeNull();
    // 14:03:05.420 at +02:00 pins the UTC instant.
    expect(takenAt!.toISOString()).toBe("2026-08-22T12:03:05.420Z");
  });

  it("falls back to IFD0 DateTime when there is no Exif IFD", () => {
    const takenAt = readTakenAtFromJpeg(wrapInJpeg(buildTiff({ withExifIfd: false })));
    expect(takenAt).not.toBeNull();
    // No offset tag on the fallback path: parsed as local wall-clock time.
    expect(takenAt!.getFullYear()).toBe(2026);
    expect(takenAt!.getMonth()).toBe(7);
    expect(takenAt!.getDate()).toBe(23);
    expect(takenAt!.getHours()).toBe(18);
  });

  it("returns null for a JPEG without EXIF", () => {
    const bare = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    expect(readTakenAtFromJpeg(bare)).toBeNull();
  });

  it("returns null for garbage without throwing", () => {
    expect(readTakenAtFromJpeg(new Uint8Array(0))).toBeNull();
    expect(readTakenAtFromJpeg(new Uint8Array(64).fill(0x2a))).toBeNull();
  });

  it("survives a truncated read that still covers the APP1 segment", () => {
    const full = wrapInJpeg(buildTiff({ withExifIfd: true }));
    const head = full.slice(0, full.length - 2); // drop the EOI marker
    expect(readTakenAtFromJpeg(head)?.toISOString()).toBe("2026-08-22T12:03:05.420Z");
  });
});
