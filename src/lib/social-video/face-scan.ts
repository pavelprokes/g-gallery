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
  /** Faces once they are saved — a failed save leaves its photos unknown, so
   * the next scan searches them again. */
  onSaved?(entries: { photoId: string; faces: PhotoFaces }[]): void;
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
  const { photos, fetchPhoto, find, save, onSaved, onProgress, signal } = options;
  const progress: ScanProgress = { done: 0, total: photos.length, failed: 0 };
  let unsaved: { photoId: string; faces: PhotoFaces }[] = [];
  const flush = async () => {
    if (unsaved.length === 0) return;
    const batch = unsaved;
    unsaved = [];
    await save(batch);
    onSaved?.(batch);
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
      unsaved.push({ photoId: photo.id, faces });
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

/** The query the "Přepočet fotek" page reloads itself with after a failed
 * save, and starts from on its own. Here, not in the client component: a
 * server page importing it from there would get a reference, not the string. */
export const RESCAN_CONTINUE_PARAM = "pokracovat";

/** Waits before each retry of a failed save — a passing network error, a
 * database connection the pooler dropped. */
export const SAVE_RETRY_DELAYS = [2_000, 5_000, 15_000] as const;

/**
 * `work`, tried again after each of `delays` while it throws — unless
 * `retryable` says the error is one waiting will not cure.
 */
export async function withRetry<T>(
  work: () => Promise<T>,
  {
    delays = SAVE_RETRY_DELAYS,
    retryable = () => true,
    wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  }: {
    delays?: readonly number[];
    retryable?: (error: unknown) => boolean;
    wait?: (ms: number) => Promise<void>;
  } = {},
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await work();
    } catch (error) {
      const delay = delays[attempt];
      if (delay === undefined || !retryable(error)) throw error;
      await wait(delay);
    }
  }
}

/**
 * Runs `work` on every item with at most `lanes` at once, each lane taking the
 * next item as it finishes one — the face scan's workers each searching their
 * own batch of photos. Stops taking items once `signal` aborts. The first
 * error aborts `controller` (the other lanes stop at their next photo and save
 * what they found) and is thrown once every lane has stopped.
 */
export async function inLanes<T>(
  items: readonly T[],
  lanes: number,
  work: (item: T, index: number, lane: number) => Promise<void>,
  controller: AbortController,
): Promise<void> {
  let next = 0;
  let failure: { error: unknown } | null = null;
  const lane = async (laneIndex: number) => {
    while (!controller.signal.aborted && next < items.length) {
      const index = next++;
      try {
        await work(items[index]!, index, laneIndex);
      } catch (error) {
        failure ??= { error };
        controller.abort();
      }
    }
  };
  const count = Math.max(1, Math.min(lanes, items.length));
  await Promise.all(Array.from({ length: count }, (_, i) => lane(i)));
  if (failure) throw (failure as { error: unknown }).error;
}
