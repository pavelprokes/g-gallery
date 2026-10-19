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
  /** The photo an interrupted replacement was going to replace. */
  replacesPhotoId?: string | null;
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

/** An export's sequence and what follows it: `svatba_0412_` + `PPR57923`. */
const SEQUENCED = /^(.*[_-]\d+[_-])(.+)$/;
/** A Photoshop round trip's suffix — the same shot. */
const EDITED = /[-_ ](edit|upravit)(-\d+)?$/;
const stemOf = (fileName: string) => fileName.replace(/\.[^.]*$/, "");

/**
 * The camera's name for the shot, or null. A delivered photo has one only
 * after a sequence (`svatba_0412_PPR57923`); a picked file may also be bare
 * (`PPR57923`, an export without a sequence — Pavel's fix set, 2026-10-19).
 * Never for a delivered name that is only a sequence (`svatba_0001`): a second
 * batch numbered from 1 would pair with unrelated photos. It needs letters and
 * digits both, so `IMG_4821-2` (a bare `2` after a sequence) or
 * `2026-09-05_0412` names no shot.
 */
function cameraOf(fileName: string, bare: boolean): string | null {
  const stem = stemOf(fileName).toLowerCase();
  const match = SEQUENCED.exec(stem);
  const core = (match ? match[2]! : bare ? stem : "").replace(EDITED, "");
  return /[a-z]/.test(core) && /\d/.test(core) ? core : null;
}

/**
 * The part of a file name that names the shot, not its place in an export:
 * `svatba_0412_PPR57923.jpg` and `PPR57923-Edit.jpg` are both `ppr57923.jpg`.
 * The extension is part of the key, so a replacement keeps the delivered file
 * name exactly (docs/REPLACE-PHOTOS.md). `bare: false` for delivered names.
 */
export function shotKey(fileName: string, { bare = true } = {}): string | null {
  const camera = cameraOf(fileName, bare);
  if (!camera) return null;
  const extension = (/\.([^.]*)$/.exec(fileName.toLowerCase())?.[1] ?? "").replace(/^jpeg$/, "jpg");
  return `${camera}.${extension}`;
}

/**
 * Per picked file, every delivered photo it could replace — empty when none.
 * Always the photographer's choice in the review, never a guess, because a
 * wrong pair deletes a photo: one candidate comes pre-selected, several
 * (virtual copies) wait for a pick. Two picked files with one key pair with
 * nothing, and a file resuming a PENDING row is left to that row.
 */
export function replaceCandidates(
  files: readonly PickedFile[],
  existing: readonly ExistingPhoto[],
  resumeIds: readonly (string | undefined)[] = [],
): string[][] {
  const photos = new Map<string, string[]>();
  for (const photo of existing) {
    const key = shotKey(photo.fileName, { bare: false });
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

const counterOf = (camera: string | null) => {
  const match = camera ? /^(.*?)(\d+)$/.exec(camera) : null;
  return match ? { body: match[1]!, n: Number(match[2]) } : null;
};

/**
 * Where new shots go (docs/REPLACE-PHOTOS.md). One exported with its bare
 * camera name (`PPR56518.jpg`) into a gallery delivered with a sequence would
 * sort before every `svatba_…` photo; it is stored under the sequence of the
 * same camera's nearest lower number instead — `svatba_0384_PPR56518.jpg`
 * after `svatba_0384_PPR56511.jpg`. Null for a name with its own sequence,
 * for a number already delivered (that is a replacement, or a choice, not a
 * new shot), and when nothing of that camera comes before it.
 *
 * ponytail: camera counter, not capture time — exact within one body and
 * clock-proof, but two bodies sharing a prefix (`DSC_`) or a counter that
 * wrapped (9999 → 0001) land wrong. Capture time would need EXIF before presign.
 */
export function slotter(
  existing: readonly ExistingPhoto[],
): (fileName: string) => { name: string; after: string } | null {
  // Parsed once: the review runs this for every picked file.
  const delivered = existing.flatMap((photo) => {
    const prefix = SEQUENCED.exec(stemOf(photo.fileName))?.[1];
    const counter = counterOf(cameraOf(photo.fileName, false));
    return prefix && counter ? [{ prefix, ...counter, fileName: photo.fileName }] : [];
  });
  return (fileName) => {
    if (SEQUENCED.test(stemOf(fileName).toLowerCase())) return null;
    const own = counterOf(cameraOf(fileName, true));
    if (!own) return null;
    let best: (typeof delivered)[number] | null = null;
    for (const photo of delivered) {
      if (photo.body !== own.body || photo.n > own.n) continue;
      if (photo.n === own.n) return null;
      if (!best || photo.n > best.n) best = photo;
    }
    return best && { name: best.prefix + fileName, after: best.fileName };
  };
}
