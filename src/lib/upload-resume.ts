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
 * `svatba_0412_PPR57923.jpg` → `ppr57923.jpg`, and a bare `PPR57923.jpg` (an
 * export without a sequence, Pavel 2026-10-19) is the same shot. Lightroom's
 * sequence is the last `_<digits>_` (or `-`) in the name, so a re-export
 * numbered from 1 still yields the camera's own name — `DSC_1234` too,
 * underscore and all — and a Photoshop round trip's `-Edit` is the same shot.
 * A key needs letters and digits both: what follows a sequence in
 * `2026-09-05_0412` or `IMG_4821-2` is a bare number, which would pair
 * unrelated shots, so such a name only ever matches itself, and one with no
 * letters at all matches nothing. The extension is part of the key, so a
 * replacement keeps the delivered file name exactly (docs/REPLACE-PHOTOS.md).
 */
export function shotKey(fileName: string): string | null {
  const lower = fileName.toLowerCase();
  const extension = (/\.([^.]*)$/.exec(lower)?.[1] ?? "").replace(/^jpeg$/, "jpg");
  const shot = (name: string | undefined) => {
    const core = name?.replace(/[-_ ](edit|upravit)(-\d+)?$/, "");
    return core && /[a-z]/.test(core) && /\d/.test(core) ? core : null;
  };
  const stem = lower.replace(/\.[^.]*$/, "");
  const camera = shot(/^.*[_-]\d+[_-](.+)$/.exec(stem)?.[1]) ?? shot(stem);
  return camera ? `${camera}.${extension}` : null;
}

/**
 * Per picked file, every delivered photo it could replace — empty when none.
 * One candidate is a pair; several (Lightroom virtual copies, two bodies'
 * counters) are the photographer's choice, never a guess, because a wrong
 * pair deletes a photo. Two picked files with one key pair with nothing, and
 * a file already resuming a PENDING row is left to that.
 */
export function replaceCandidates(
  files: readonly PickedFile[],
  existing: readonly ExistingPhoto[],
  resumeIds: readonly (string | undefined)[] = [],
): string[][] {
  const photos = new Map<string, string[]>();
  for (const photo of existing) {
    const key = shotKey(photo.fileName);
    if (key) photos.set(key, [...(photos.get(key) ?? []), photo.id]);
  }
  const picked = new Map<string, number>();
  for (const file of files) {
    const key = shotKey(file.name);
    if (key) picked.set(key, (picked.get(key) ?? 0) + 1);
  }
  return files.map((file, index) => {
    const key = shotKey(file.name);
    if (resumeIds[index] || !key || picked.get(key) !== 1) return [];
    return photos.get(key) ?? [];
  });
}

/** The unambiguous pairs only: per picked file, the photo it replaces. */
export function matchReplaceTargets(
  files: readonly PickedFile[],
  existing: readonly ExistingPhoto[],
  resumeIds: readonly (string | undefined)[] = [],
): (string | undefined)[] {
  return replaceCandidates(files, existing, resumeIds).map((ids) =>
    ids.length === 1 ? ids[0] : undefined,
  );
}

const SEQUENCED = /^(.*[_-]\d+[_-])(.+)$/;

/**
 * A new shot exported with its bare camera name (`PPR56518.jpg`) into a
 * gallery delivered with an export sequence would sort before every
 * `svatba_…` photo. It goes after the same camera's nearest lower number
 * instead, under that photo's sequence: `svatba_0384_PPR56518.jpg` follows
 * `svatba_0384_PPR56511.jpg` in file-name order (docs/REPLACE-PHOTOS.md).
 * Null when the name already carries a sequence or nothing of that camera
 * comes before it.
 *
 * ponytail: camera counter, not capture time — exact within one body and
 * clock-proof, but a counter that wrapped (9999 → 0001) lands wrong. Capture
 * time would need the EXIF read before presign.
 */
export function slotAfter(
  fileName: string,
  existing: readonly ExistingPhoto[],
): { name: string; after: string } | null {
  const stemOf = (name: string) => name.replace(/\.[^.]*$/, "");
  const counter = (camera: string) => {
    const match = /^(.*?)(\d+)$/.exec(camera.toLowerCase());
    return match ? { body: match[1], n: Number(match[2]) } : null;
  };
  if (SEQUENCED.test(stemOf(fileName))) return null;
  const own = counter(stemOf(fileName));
  if (!own) return null;
  let best: { prefix: string; n: number; after: string } | null = null;
  for (const photo of existing) {
    const match = SEQUENCED.exec(stemOf(photo.fileName));
    const theirs = match ? counter(match[2]!) : null;
    if (!theirs || theirs.body !== own.body || theirs.n >= own.n) continue;
    if (!best || theirs.n > best.n)
      best = { prefix: match![1]!, n: theirs.n, after: photo.fileName };
  }
  return best && { name: best.prefix + fileName, after: best.after };
}
