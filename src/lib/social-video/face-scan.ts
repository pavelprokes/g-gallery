// Faces for a whole gallery, on the photographer's click (docs/SOCIAL-VIDEO.md
// §4): every photo without current faces is fetched, searched in the face
// worker and saved in batches, so a scan stopped halfway — paused, the tab
// closed — keeps what it found and the next one picks up the rest.

import type { PhotoFaces } from "@/lib/social-video/faces";

/** Photos fetched ahead of the one being searched. */
export const SCAN_PREFETCH = 4;
/** Photos saved per call — well under saveFaces' limit, and little lost to a
 * closed tab. */
export const SCAN_BATCH = 20;

export interface ScanProgress {
  /** Photos finished, found or failed. */
  done: number;
  total: number;
  failed: number;
}

export interface ScanOptions<P extends { id: string }> {
  photos: readonly P[];
  fetchPhoto(photo: P): Promise<Blob>;
  find(blob: Blob): Promise<PhotoFaces>;
  save(entries: { photoId: string; faces: PhotoFaces }[]): Promise<unknown>;
  /** Each photo's faces as soon as they are found, before they are saved. */
  onFound?(entries: { photoId: string; faces: PhotoFaces }[]): void;
  onProgress?(progress: ScanProgress): void;
  signal?: AbortSignal;
}

/**
 * Searches `photos` one by one, fetching a few ahead. A photo that does not
 * load or fails detection is counted and skipped — it stays without faces
 * and is tried again by the next scan. Stops at the next photo when `signal`
 * aborts, saving what it found before.
 */
export async function scanFaces<P extends { id: string }>(
  options: ScanOptions<P>,
): Promise<ScanProgress> {
  const { photos, fetchPhoto, find, save, onFound, onProgress, signal } = options;
  const progress: ScanProgress = { done: 0, total: photos.length, failed: 0 };
  let unsaved: { photoId: string; faces: PhotoFaces }[] = [];
  const flush = async () => {
    if (unsaved.length === 0) return;
    const batch = unsaved;
    unsaved = [];
    await save(batch);
  };

  const fetches = new Map<number, Promise<Blob>>();
  const fetchAt = (i: number) => {
    const photo = photos[i];
    if (!photo || fetches.has(i)) return;
    const blob = fetchPhoto(photo);
    // Awaited in order below; until then a rejection is not unhandled.
    blob.catch(() => {});
    fetches.set(i, blob);
  };

  for (let i = 0; i < photos.length; i++) {
    if (signal?.aborted) break;
    for (let ahead = i; ahead <= i + SCAN_PREFETCH; ahead++) fetchAt(ahead);
    const photo = photos[i]!;
    try {
      const faces = await find(await fetches.get(i)!);
      const entry = { photoId: photo.id, faces };
      unsaved.push(entry);
      onFound?.([entry]);
    } catch {
      progress.failed += 1;
    }
    fetches.delete(i);
    progress.done += 1;
    onProgress?.({ ...progress });
    if (unsaved.length >= SCAN_BATCH) await flush();
  }
  await flush();
  return progress;
}
