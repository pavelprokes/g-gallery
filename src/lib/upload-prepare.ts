import { crc32HexOfBlob } from "@/lib/crc32";
import { stripGpsFromJpeg } from "@/lib/exif-gps";
import { EXIF_SCAN_BYTES, readTakenAtFromJpeg } from "@/lib/exif-taken-at";
import { readXmpPicksFromJpeg, type XmpPicks } from "@/lib/xmp-picks";
import { averageColorOf } from "@/lib/placeholder";

/**
 * Everything the upload pipeline derives from a file before the PUT
 * (docs/PLAN.md §5): the bytes to store, with GPS stripped, and what the
 * confirm call reports about them.
 *
 * DOM-free on purpose — Blob, createImageBitmap and OffscreenCanvas only — so
 * the same function runs in the upload worker (src/lib/upload-prepare.worker.ts)
 * and, where a worker cannot start, on the main thread exactly as before.
 */
export interface PreparedUpload {
  /** The file with its EXIF GPS removed — the exact bytes that get stored. */
  body: Blob;
  /** CRC32 of `body`, so the ZIP writer can trust it without re-reading. */
  crc32: string;
  /** Capture time: EXIF where the file has it, else the file's mtime. */
  takenAt: Date | null;
  width: number | null;
  height: number | null;
  /** Average colour, painted before the image arrives. Cosmetic. */
  placeholder: string | null;
  /** The photographer's Lightroom marks, for the highlights (docs/HIGHLIGHTS.md). */
  picks: XmpPicks | null;
}

export async function prepareUpload(file: File): Promise<PreparedUpload> {
  // GPS is stripped before the bytes ever leave the browser, and the CRC32 is
  // computed on the exact bytes that get stored so the ZIP writer can trust it.
  // One read of the file serves the strip, the capture time and the marks.
  const bytes = file.type.includes("jpeg") ? new Uint8Array(await file.arrayBuffer()) : null;
  const stripped = bytes ? stripGpsFromJpeg(bytes) : null;
  const body =
    stripped && stripped !== bytes ? new Blob([stripped as BlobPart], { type: file.type }) : file;
  // Capture time drives the gallery timeline (oldest shot first). EXIF where
  // the file has it; the file's own mtime otherwise — for a camera-roll pick
  // that is the capture time too, and it beats "when the upload ran" for
  // everything else. The server falls back to confirm time if both are junk.
  // EXIF and Lightroom's XMP both sit in the head of the file.
  const head = bytes?.subarray(0, EXIF_SCAN_BYTES) ?? null;
  const takenAt =
    (head && orNull(() => readTakenAtFromJpeg(head))) ??
    (Number.isFinite(file.lastModified) && file.lastModified > 0
      ? new Date(file.lastModified)
      : null);
  const crc32 = await crc32HexOfBlob(body);
  const dimensions = await readDimensions(body);
  // Cosmetic, so a failure here never blocks the upload.
  const placeholder = await averageColorOf(body);
  // Marks for the highlights (docs/HIGHLIGHTS.md) — a hint, never a reason
  // for an upload to fail.
  const picks = head ? orNull(() => readXmpPicksFromJpeg(head)) : null;
  return {
    body,
    crc32,
    takenAt,
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
    placeholder,
    picks,
  };
}

/** Metadata is a hint: a file that trips a parser still uploads. */
function orNull<T>(read: () => T | null): T | null {
  try {
    return read();
  } catch {
    return null;
  }
}

/** Dimensions drive the justified gallery layout; failure is non-fatal. */
async function readDimensions(blob: Blob): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap !== "function") return null;
  try {
    const bitmap = await createImageBitmap(blob);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return null;
  }
}
