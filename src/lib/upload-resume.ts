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
