"use client";

/**
 * Turning a drop or a folder pick into the list of photos to upload.
 *
 * A photographer drags a whole export folder (often with sub-folders per
 * part of the day) straight from Finder. What arrives mixes photos with
 * `.DS_Store`, AppleDouble `._IMG_0001.jpg` shadows from external drives,
 * Lightroom `.xmp` sidecars and RAW files — none of which belong in a gallery.
 */

import { classifyContentType } from "@/lib/upload-content-types";

export { formatBytes } from "@/lib/offline";

// A folder walk or a drop can hand over files with an empty `type` (no codec
// registered for HEIC on Windows/Linux, some external drives). The type is then
// inferred from the extension — never defaulted to JPEG, or a HEIC would be
// stored as a broken "JPEG".
const TYPE_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
  heic: "image/heic",
  heif: "image/heif",
};

export function photoType(file: Pick<File, "name" | "type">): string | null {
  if (file.type) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return TYPE_BY_EXTENSION[extension] ?? null;
}

/**
 * True for a file we can store — or one we must refuse out loud (HEIC, so the
 * photographer learns to export JPEG). Everything else — RAW, TIFF, GIF, XMP,
 * `.DS_Store`, AppleDouble shadows — is noise, skipped with a quiet notice.
 */
export function isCandidatePhoto(file: Pick<File, "name" | "type">): boolean {
  if (file.name.startsWith(".")) return false;
  const type = photoType(file);
  if (!type) return false;
  const verdict = classifyContentType(type);
  return verdict.ok || verdict.reason === "heic";
}

/**
 * Photos only, each file once (the same folder dropped twice, or a file both
 * picked and dropped), in the order a photographer expects: by name with
 * numbers compared as numbers, so IMG_2 comes before IMG_10.
 */
export function selectPhotos(files: File[]): { photos: File[]; ignored: number } {
  const seen = new Set<string>();
  const photos: File[] = [];
  let ignored = 0;

  for (const file of files) {
    if (!isCandidatePhoto(file)) {
      ignored += 1;
      continue;
    }
    const key = `${relativePath(file)}\u0000${file.size}\u0000${file.lastModified}`;
    if (seen.has(key)) continue;
    seen.add(key);
    photos.push(file);
  }

  photos.sort((a, b) =>
    relativePath(a).localeCompare(relativePath(b), undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );
  // Re-wrapping only relabels the Blob; no bytes are copied.
  const typed = photos.map((file) =>
    file.type
      ? file
      : new File([file], file.name, { type: photoType(file)!, lastModified: file.lastModified }),
  );
  return { photos: typed, ignored };
}

function relativePath(file: File): string {
  return (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
}

/**
 * Every file in a drop, folders walked recursively.
 *
 * `webkitGetAsEntry()` is only readable synchronously inside the `drop`
 * handler, so the entries are captured first and walked afterwards.
 * `readEntries()` returns at most 100 entries per call in Chromium — it has to
 * be called until it returns an empty batch, or big folders get cut off.
 */
export async function filesFromDrop(dataTransfer: DataTransfer): Promise<File[]> {
  const entries = Array.from(dataTransfer.items ?? [])
    .filter((item) => item.kind === "file")
    .map((item) => item.webkitGetAsEntry?.() ?? null);

  // No entry API (or a synthetic drop): fall back to the flat file list.
  if (entries.length === 0 || entries.some((entry) => entry === null)) {
    return Array.from(dataTransfer.files ?? []);
  }

  const files: File[] = [];
  await Promise.all(entries.map((entry) => walk(entry!, files)));
  return files;
}

async function walk(entry: FileSystemEntry, into: File[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File | null>((resolve) =>
      (entry as FileSystemFileEntry).file(resolve, () => resolve(null)),
    );
    if (file) into.push(file);
    return;
  }
  if (!entry.isDirectory) return;

  const reader = (entry as FileSystemDirectoryEntry).createReader();
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve) =>
      reader.readEntries(resolve, () => resolve([])),
    );
    if (batch.length === 0) return;
    await Promise.all(batch.map((child) => walk(child, into)));
  }
}

/**
 * Upload speed smoothed with an exponential moving average, so the ETA does
 * not jump every time one of four parallel files finishes.
 */
export function smoothSpeed(previous: number | null, sample: number, alpha = 0.2): number {
  return previous === null ? sample : previous + alpha * (sample - previous);
}

/** "~3 min" / "~1 h 20 min" — or null while there is too little data to guess. */
export function formatEta(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return null;
  if (seconds < 60) return "méně než minuta";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `~${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `~${hours} h` : `~${hours} h ${rest} min`;
}
