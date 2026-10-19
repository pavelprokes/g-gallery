/**
 * Matching re-picked files to the rows left behind by an interrupted upload.
 *
 * A PENDING Photo row outlives the browser session, but the File object does
 * not — the user has to select the same files again. Matching them back onto
 * their rows is what keeps a resumed batch from creating a second set of rows
 * and a second set of objects (docs/PLAN.md §5).
 */

export interface PendingUpload {
  id: string;
  fileName: string;
  sizeBytes: number | null;
}

/** Enough of File to match on, so this stays testable outside a browser. */
export interface PickedFile {
  name: string;
  size: number;
}

/**
 * Returns, per picked file, the id of the PENDING row it resumes — or
 * undefined if it is a genuinely new upload.
 *
 * Matching is on name AND size: name alone would let a re-export of the same
 * shot silently overwrite the previous one's object. Each row is claimed at
 * most once, so picking the same file twice uploads it twice, which is what
 * the user asked for.
 */
export function matchResumeTargets(
  files: readonly PickedFile[],
  pending: readonly PendingUpload[],
): (string | undefined)[] {
  // Grouped by name+size so repeated picks of an identical file consume
  // distinct rows instead of all claiming the first one.
  const byKey = new Map<string, string[]>();
  for (const row of pending) {
    if (row.sizeBytes === null) continue;
    const key = `${row.fileName} ${row.sizeBytes}`;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(row.id);
    else byKey.set(key, [row.id]);
  }

  return files.map((file) => byKey.get(`${file.name} ${file.size}`)?.shift());
}

/** How many of the pending rows the picked files actually cover. */
export function countResumed(matches: readonly (string | undefined)[]): number {
  return matches.filter(Boolean).length;
}

/** A CONFIRMED photo of the photographer's that a corrected export may replace. */
export interface ExistingPhoto {
  id: string;
  fileName: string;
}

/**
 * The part of a file name that names the shot, not its place in an export:
 * `svatba_0412_PPR57923.jpg` → `ppr57923`. Lightroom's sequence is the last
 * `_<digits>_` (or `-`) in the name, so a re-export numbered from 1 still
 * yields the camera's own name — `DSC_1234` too, underscore and all. A name
 * without a sequence is its own key, so the very same name matches as well
 * (docs/REPLACE-PHOTOS.md).
 */
export function shotKey(fileName: string): string {
  const stem = fileName.replace(/\.[^.]*$/, "").toLowerCase();
  return /^.*[_-]\d+[_-](.+)$/.exec(stem)?.[1] ?? stem;
}

/**
 * Per picked file, the id of the photo it replaces — or undefined. Only a
 * match that is unique on both sides counts: two photos in the gallery with
 * one key (two bodies' counters) or two picked files with one key would be a
 * guess, and a guess here overwrites somebody's photo. A file already resuming
 * a PENDING row is left to that.
 */
export function matchReplaceTargets(
  files: readonly PickedFile[],
  existing: readonly ExistingPhoto[],
  resumeIds: readonly (string | undefined)[] = [],
): (string | undefined)[] {
  const unique = <T>(items: readonly T[], key: (item: T) => string) => {
    const seen = new Map<string, T | null>();
    for (const item of items) seen.set(key(item), seen.has(key(item)) ? null : item);
    return seen;
  };
  const photos = unique(existing, (photo) => shotKey(photo.fileName));
  const picked = unique(files, (file) => shotKey(file.name));
  return files.map((file, index) => {
    if (resumeIds[index]) return undefined;
    const key = shotKey(file.name);
    return picked.get(key) === file ? (photos.get(key)?.id ?? undefined) : undefined;
  });
}
