import { crc32HexOfBlob } from "@/lib/crc32";
import { stripGpsFromFile } from "@/lib/exif-gps";
import { readTakenAtFromFile } from "@/lib/exif-taken-at";
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
}

export async function prepareUpload(file: File): Promise<PreparedUpload> {
  // GPS is stripped before the bytes ever leave the browser, and the CRC32 is
  // computed on the exact bytes that get stored so the ZIP writer can trust it.
  const body = await stripGpsFromFile(file);
  // Capture time drives the gallery timeline (oldest shot first). EXIF where
  // the file has it; the file's own mtime otherwise — for a camera-roll pick
  // that is the capture time too, and it beats "when the upload ran" for
  // everything else. The server falls back to confirm time if both are junk.
  const takenAt =
    (await readTakenAtFromFile(file)) ??
    (Number.isFinite(file.lastModified) && file.lastModified > 0
      ? new Date(file.lastModified)
      : null);
  const crc32 = await crc32HexOfBlob(body);
  const dimensions = await readDimensions(body);
  // Cosmetic, so a failure here never blocks the upload.
  const placeholder = await averageColorOf(body);
  return {
    body,
    crc32,
    takenAt,
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
    placeholder,
  };
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
