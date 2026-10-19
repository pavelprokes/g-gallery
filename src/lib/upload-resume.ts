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
const EDITED = /[-_ ](edit|upravit)(-\d+)?$/i;
const stemOf = (fileName: string) => fileName.replace(/\.[^.]*$/, "");

/** A file's stem, lowercased and without a Photoshop round trip's suffix. */
const shotStem = (fileName: string) => stemOf(fileName).toLowerCase().replace(EDITED, "");

/** Whether the name carries an export sequence before the camera's name. */
export function isSequenced(fileName: string): boolean {
  return SEQUENCED.test(shotStem(fileName));
}

/**
 * The camera's name for the shot, or null: what follows the export's sequence
 * (`svatba_0412_PPR57923`), or a bare name (`PPR57923`, an export without a
 * sequence — Pavel's fix set, 2026-10-19). It needs letters and digits both,
 * so `IMG_4821-2` (a bare `2` after a sequence) or `2026-09-05_0412` names no
 * shot. A name that is a sequence alone (`svatba_0001`) does get a key, but a
 * pair with it is never pre-selected (`planPick`): a second batch numbered
 * from 1 would otherwise pair with unrelated photos.
 */
function cameraOf(fileName: string): string | null {
  const stem = shotStem(fileName);
  const core = SEQUENCED.exec(stem)?.[2] ?? stem;
  return /[a-z]/.test(core) && /\d/.test(core) ? core : null;
}

/**
 * The part of a file name that names the shot, not its place in an export:
 * `svatba_0412_PPR57923.jpg` and `DSC_1234-Edit.jpg` are `ppr57923.jpg` and
 * `dsc_1234.jpg`. The extension is part of the key, so a replacement keeps the
 * delivered file name exactly (docs/REPLACE-PHOTOS.md).
 */
export function shotKey(fileName: string): string | null {
  const camera = cameraOf(fileName);
  if (!camera) return null;
  const extension = (/\.([^.]*)$/.exec(fileName.toLowerCase())?.[1] ?? "").replace(/^jpeg$/, "jpg");
  return `${camera}.${extension}`;
}

/**
 * Per picked file, every delivered photo it could replace — empty when none.
 * Two picked files with one key pair with nothing, and a file resuming a
 * PENDING row is left to that row.
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

const counterOf = (camera: string | null) => {
  const match = camera ? /^(.*?)(\d+)$/.exec(camera) : null;
  return match ? { body: match[1]!, n: Number(match[2]) } : null;
};

/**
 * Where new shots go (docs/REPLACE-PHOTOS.md). One exported with its bare
 * camera name (`PPR56518.jpg`) into a gallery delivered with a sequence would
 * sort before every `svatba_…` photo; it is stored under the sequence of the
 * same camera's nearest lower number instead — `svatba_0384_PPR56518.jpg`
 * after `svatba_0384_PPR56511.jpg`. Null for a name with its own sequence and
 * when nothing of that camera comes before it.
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
    const prefix = SEQUENCED.exec(shotStem(photo.fileName))?.[1];
    const counter = counterOf(cameraOf(photo.fileName));
    if (!prefix || !counter) return [];
    // The delivered name's own case, not the lowercased match.
    return [
      { prefix: photo.fileName.slice(0, prefix.length), ...counter, fileName: photo.fileName },
    ];
  });
  return (fileName) => {
    if (isSequenced(fileName)) return null;
    const own = counterOf(cameraOf(fileName));
    if (!own) return null;
    let best: (typeof delivered)[number] | null = null;
    for (const photo of delivered) {
      if (photo.body !== own.body || photo.n >= own.n) continue;
      if (!best || photo.n > best.n) best = photo;
    }
    return best && { name: best.prefix + fileName, after: best.fileName };
  };
}

/** What the review offers for one picked file (`planPick`). */
export interface PickPlan {
  /** Delivered photos it could replace; empty when none. */
  candidates: string[];
  /**
   * The pair to pre-select: a single candidate whose delivered name carries a
   * sequence. Any other pair waits for the photographer's pick.
   */
  preselect?: string;
  /** Where it goes as a new shot (`slotter`), when it does not replace. */
  slot: { name: string; after: string } | null;
  /** The PENDING row an interrupted run left for it. */
  resumeId?: string;
  /** A name it must keep whatever is chosen: the one its resumed row was filed under. */
  keepName?: string;
  /** It resumes a replacement whose photo has been deleted since. */
  lostTarget: boolean;
}

/**
 * Everything the uploader's review needs for a pick, in one pure place so it
 * is testable. An interrupted run is resumed under the name it was stored with
 * — the file's own, or the filed one — each row claimed once, and goes on
 * replacing what it was replacing.
 */
export function planPick(
  files: readonly PickedFile[],
  pending: readonly PendingUpload[],
  existing: readonly ExistingPhoto[],
): PickPlan[] {
  const slot = slotter(existing);
  // Never filed under a name another picked file already carries: two photos
  // with one name, and resume could not tell them apart.
  const pickedNames = new Set(files.map((file) => file.name.toLowerCase()));
  const slots = files.map((file) => {
    const filed = slot(file.name);
    return filed && !pickedNames.has(filed.name.toLowerCase()) ? filed : null;
  });
  const rows = new Map<string, PendingUpload[]>();
  for (const row of pending) {
    if (row.sizeBytes === null) continue;
    const key = `${row.fileName} ${row.sizeBytes}`;
    rows.set(key, [...(rows.get(key) ?? []), row]);
  }
  const claim = (name: string | undefined, size: number) =>
    name === undefined ? undefined : rows.get(`${name} ${size}`)?.shift();
  // Own names first, for every file, then filed names: a file that already
  // carries the filed name must not lose its row to the bare one.
  const own = files.map((file) => claim(file.name, file.size));
  const resumed = files.map((file, index) =>
    own[index]
      ? { row: own[index], filed: false }
      : (() => {
          const filed = claim(slots[index]?.name, file.size);
          return filed ? { row: filed, filed: true } : undefined;
        })(),
  );
  const names = new Map(existing.map((photo) => [photo.id, photo.fileName]));
  const candidates = replaceCandidates(
    files,
    existing,
    resumed.map((entry) => entry?.row.id),
  );
  return files.map((_, index) => {
    const entry = resumed[index];
    const was = entry?.row.replacesPhotoId ?? undefined;
    if (entry && was) {
      return names.has(was)
        ? {
            candidates: [was],
            preselect: was,
            slot: null,
            resumeId: entry.row.id,
            lostTarget: false,
          }
        : { candidates: [], slot: null, resumeId: entry.row.id, lostTarget: true };
    }
    const ids = entry ? [] : candidates[index]!;
    const sure = ids.length === 1 && isSequenced(names.get(ids[0]!) ?? "");
    return {
      candidates: ids,
      preselect: sure ? ids[0] : undefined,
      // A row resumed under its own name keeps it; one filed keeps that.
      slot: entry && !entry.filed ? null : slots[index]!,
      resumeId: entry?.row.id,
      keepName: entry?.filed ? slots[index]!.name : undefined,
      lostTarget: false,
    };
  });
}

/**
 * The camera's own name for a delivered photo, as written — `PPR55013` out of
 * `svatba_0215_PPR55013.jpg` — for finding it in Lightroom
 * (docs/CORRECTIONS.md). The stem itself when there is no sequence.
 */
export function cameraName(fileName: string): string {
  const stem = stemOf(fileName).replace(EDITED, "");
  return SEQUENCED.exec(stem)?.[2] ?? stem;
}
