import "server-only";
import { prisma } from "@/lib/db";
import { deleteObject, listObjects, type StoredObject } from "@/lib/r2";
import { isThumbKey } from "@/lib/thumbnail";

// Presigned-PUT flows can leave two kinds of debris (docs/PLAN.md §5):
//   - ghost rows: a Photo row was created, the upload never confirmed
//   - orphan objects: bytes landed in R2 but the row was deleted afterwards
//
// Ghost rows are cheap to find (status + age). Orphan objects need a full
// bucket listing, which is why the sweep runs on its own, rarer schedule.

/** A PENDING photo older than this is assumed to be an abandoned upload. */
const GHOST_AGE_MS = 24 * 60 * 60 * 1000;

export interface ReconcileResult {
  ghostRowsDeleted: number;
  objectsDeleted: number;
  failures: string[];
}

/**
 * Deletes never-confirmed Photo rows and their (possibly non-existent) R2
 * objects. Safe to run repeatedly; R2 deletes of missing keys are ignored.
 */
export async function reconcileGhostUploads(olderThanMs = GHOST_AGE_MS): Promise<ReconcileResult> {
  const cutoff = new Date(Date.now() - olderThanMs);

  const ghosts = await prisma.photo.findMany({
    where: { status: "PENDING", createdAt: { lt: cutoff } },
    select: { id: true, objectKey: true },
  });

  const failures: string[] = [];
  let objectsDeleted = 0;

  for (const ghost of ghosts) {
    if (!ghost.objectKey) continue;
    try {
      await deleteObject(ghost.objectKey);
      objectsDeleted += 1;
    } catch (error) {
      failures.push(`${ghost.objectKey}: ${(error as Error).message}`);
    }
  }

  const { count } = await prisma.photo.deleteMany({
    where: { id: { in: ghosts.map((g) => g.id) } },
  });

  return { ghostRowsDeleted: count, objectsDeleted, failures };
}

/**
 * Removes every R2 object belonging to a gallery, then the gallery itself.
 * Objects are deleted first: a failure here leaves the rows intact so the job
 * can be retried, whereas the reverse order would strand the bytes forever.
 */
export async function deleteGalleryWithObjects(galleryId: string, ownerId: string): Promise<void> {
  const gallery = await prisma.gallery.findFirst({
    where: { id: galleryId, ownerId },
    select: { id: true, photos: { select: { objectKey: true } } },
  });
  if (!gallery) throw new Error("NOT_FOUND");

  for (const photo of gallery.photos) {
    if (photo.objectKey) await deleteObject(photo.objectKey);
  }

  await prisma.gallery.delete({ where: { id: gallery.id } });
}

export interface PurgeCandidate {
  id: string;
  ownerId: string;
  title: string;
}

/**
 * Which trashed galleries are past their purge deadline. Pure and exported so
 * the one rule that matters — `purgeAt` must be set and in the past — is
 * covered by tests rather than by inspection.
 */
export function selectPurgeCandidates(
  galleries: { id: string; ownerId: string; title: string; purgeAt: Date | null }[],
  now: Date,
): PurgeCandidate[] {
  return galleries
    .filter((gallery) => gallery.purgeAt !== null && gallery.purgeAt <= now)
    .map(({ id, ownerId, title }) => ({ id, ownerId, title }));
}

export interface PurgeResult {
  purged: number;
  failures: string[];
}

/**
 * Permanently deletes every trashed gallery whose recovery window has
 * elapsed — R2 objects first, then the row (via {@link deleteGalleryWithObjects}).
 * A failure on one gallery does not stop the rest of the run.
 */
export async function purgeTrashedGalleries(now = new Date()): Promise<PurgeResult> {
  const galleries = await prisma.gallery.findMany({
    where: { purgeAt: { not: null } },
    select: { id: true, ownerId: true, title: true, purgeAt: true },
  });

  const candidates = selectPurgeCandidates(galleries, now);

  const failures: string[] = [];
  let purged = 0;

  for (const candidate of candidates) {
    try {
      await deleteGalleryWithObjects(candidate.id, candidate.ownerId);
      purged += 1;
    } catch (error) {
      failures.push(`${candidate.title}: ${(error as Error).message}`);
    }
  }

  return { purged, failures };
}

/**
 * Permanently deletes every trashed wedding page whose recovery window has
 * passed (docs/GUEST-GALLERIES.md §2).
 *
 * Nothing in R2 belongs to an `Event` — it owns no objects, only the page that
 * lists galleries — so this is a row delete, and `Gallery.eventId` is
 * `SetNull`: the photographer's galleries outlive the page that listed them.
 * Reuses {@link selectPurgeCandidates} so the "purgeAt set and in the past"
 * rule has exactly one implementation.
 */
export async function purgeTrashedEvents(now = new Date()): Promise<PurgeResult> {
  const events = await prisma.event.findMany({
    where: { purgeAt: { not: null } },
    select: { id: true, ownerId: true, title: true, purgeAt: true },
  });

  const candidates = selectPurgeCandidates(events, now);

  const failures: string[] = [];
  let purged = 0;

  for (const candidate of candidates) {
    try {
      await prisma.event.delete({ where: { id: candidate.id } });
      purged += 1;
    } catch (error) {
      failures.push(`${candidate.title}: ${(error as Error).message}`);
    }
  }

  return { purged, failures };
}

/**
 * Every object lives under this prefix, so one listing covers the whole app
 * and nothing outside it (backups, for instance) is ever a deletion candidate.
 */
const GALLERY_PREFIX = "galleries/";

/**
 * An object younger than this is never touched: it may belong to an upload
 * that is presigned and in flight right now, whose row is still being written.
 */
const ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * The archive `zip-build.ts` writes beside a gallery's photos.
 *
 * `_archive-{buildId}.zip`, not a fixed `_archive.zip`: each build writes its
 * own object so a superseded build finishing late cannot overwrite the archive
 * the gallery is actually serving. The old fixed name is still matched, because
 * galleries built before 2026-09-03 have one and it is still what their
 * `zipObjectKey` points at.
 */
const ARCHIVE_NAME = /^_archive(-[0-9a-f]{32})?\.zip$/;

/**
 * The name presign gives an original: `randomUUID()` plus an extension. Being
 * strict here is the point — a key that does not match is not assumed to be a
 * photo, it is left alone.
 */
const ORIGINAL_NAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9]+$/;

/**
 * What a listed object is, and what has to still exist for it to be live.
 *
 * `unknown` is the safe default and never a deletion candidate: a key shape
 * nobody taught this function about is a gap in this function, and the cost of
 * guessing wrong is somebody's wedding photos.
 */
export interface KeyClassification {
  kind: "original" | "thumbnail" | "archive" | "unknown";
  /** Photo stem or gallery prefix the object belongs to; null when unknown. */
  owner: string | null;
}

/**
 * Reads an object key back into what wrote it.
 *
 * ## Why shape and not a list of database columns
 *
 * The sweep used to spare exactly the keys named by `Photo.objectKey`, which
 * silently made every *derived* object — the browser-made thumbnail, the
 * pre-built archive — look like debris. Both are created far away from this
 * file (`api/uploads/presign`, `lib/zip-build`), so nothing pointed the next
 * person at the list they had to extend, and the default for forgetting was
 * deletion. On 2026-09-01 that emptied every thumbnail in the bucket.
 *
 * Classifying by shape removes the coupling instead of restating it: a
 * thumbnail is live because *its original* is live, so the sweep needs to know
 * nothing about `thumbObjectKey` at all. And because an unrecognised shape maps
 * to `unknown`, forgetting now means "not cleaned up" rather than "deleted".
 */
export function classifyKey(key: string): KeyClassification {
  // Every key this app writes is `galleries/{storagePrefix}/{name}`, exactly
  // three segments. Checked here rather than trusted from the listing, so the
  // function is safe to call on any key at all.
  const segments = key.split("/");
  if (segments.length !== 3 || `${segments[0]}/` !== GALLERY_PREFIX) {
    return { kind: "unknown", owner: null };
  }

  const name = segments[2]!;

  if (ARCHIVE_NAME.test(name)) {
    // Owned by the gallery prefix, so every archive under a live gallery is
    // spared. Retiring a superseded one is `zip-callback`'s job, at the moment
    // it repoints `zipObjectKey` — this sweep deliberately never decides that,
    // because getting it wrong deletes the download the couple came for.
    return { kind: "archive", owner: key.slice(0, key.lastIndexOf("/")) };
  }

  if (isThumbKey(key)) {
    // Stripped back to the stem the original shares — the original's own
    // extension is not recoverable from `.thumb.webp`, which is exactly why the
    // live set is keyed on stems rather than on whole keys.
    return { kind: "thumbnail", owner: key.slice(0, key.lastIndexOf(".thumb.")) };
  }

  if (ORIGINAL_NAME.test(name)) {
    return { kind: "original", owner: key.slice(0, key.lastIndexOf(".")) };
  }

  return { kind: "unknown", owner: null };
}

/**
 * What the sweep spares, in the two shapes {@link classifyKey} resolves to: a
 * photo's stem (its key without the extension) and a gallery's storage prefix.
 *
 * Stems rather than whole keys so a thumbnail is spared by the existence of its
 * photo — including a thumbnail whose `thumbObjectKey` was never recorded
 * because the confirm that would have written it failed.
 */
export interface LiveIndex {
  photoStems: ReadonlySet<string>;
  galleryPrefixes: ReadonlySet<string>;
}

export function liveIndex(
  photos: { objectKey: string | null }[],
  galleries: { storagePrefix: string | null }[],
): LiveIndex {
  const photoStems = new Set<string>();
  for (const photo of photos) {
    if (!photo.objectKey) continue;
    const dot = photo.objectKey.lastIndexOf(".");
    photoStems.add(
      dot > photo.objectKey.lastIndexOf("/") ? photo.objectKey.slice(0, dot) : photo.objectKey,
    );
  }

  const galleryPrefixes = new Set<string>();
  for (const gallery of galleries) {
    if (gallery.storagePrefix) galleryPrefixes.add(gallery.storagePrefix);
  }

  return { photoStems, galleryPrefixes };
}

export interface OrphanSelection {
  orphans: StoredObject[];
  skippedTooRecent: number;
  /** Objects of a shape this code does not recognise, deliberately left alone. */
  skippedUnknown: number;
}

/**
 * Decides which listed objects are safe to delete. Pure and exported so the
 * rules that matter — a live owner is never a candidate whatever its age, and
 * an unrecognised key is never a candidate at all — are covered by tests rather
 * than by inspection.
 */
export function selectOrphans(
  objects: StoredObject[],
  live: LiveIndex,
  cutoffMs: number,
): OrphanSelection {
  const orphans: StoredObject[] = [];
  let skippedTooRecent = 0;
  let skippedUnknown = 0;

  for (const object of objects) {
    const { kind, owner } = classifyKey(object.key);

    if (kind === "unknown" || !owner) {
      skippedUnknown += 1;
      continue;
    }

    const alive = kind === "archive" ? live.galleryPrefixes.has(owner) : live.photoStems.has(owner);
    if (alive) continue;

    if (object.lastModified.getTime() > cutoffMs) {
      skippedTooRecent += 1;
      continue;
    }

    orphans.push(object);
  }

  return { orphans, skippedTooRecent, skippedUnknown };
}

/**
 * Blast radius. A job whose purpose is clearing up rare debris has no business
 * deleting a large share of the bucket, so past both of these it refuses the
 * whole run and asks for a human instead of proceeding.
 *
 * Both bounds together, not either: a small bucket legitimately hits the ratio,
 * and a large one legitimately hits the count. The 2026-09-01 incident cleared
 * 100% of thumbnails in one run and would have been stopped here even if
 * {@link classifyKey} had also been wrong.
 */
const MAX_SWEEP_OBJECTS = 100;
const MAX_SWEEP_RATIO = 0.1;

export function exceedsBlastRadius(orphanCount: number, objectsListed: number): boolean {
  return orphanCount > MAX_SWEEP_OBJECTS && orphanCount > objectsListed * MAX_SWEEP_RATIO;
}

export interface SweepResult {
  objectsListed: number;
  orphansFound: number;
  orphansDeleted: number;
  bytesReclaimed: number;
  skippedTooRecent: number;
  skippedUnknown: number;
  /** Set when the run was refused wholesale; nothing was deleted. */
  refused: string | null;
  failures: string[];
}

/**
 * Deletes bytes in the bucket that nothing in the database accounts for.
 *
 * This is the mirror image of {@link reconcileGhostUploads}: that one finds
 * rows without bytes, this one finds bytes without rows — the debris left when
 * a row is deleted but its R2 delete fails, or when a confirm lands after the
 * ghost sweep already removed the row.
 *
 * Deletion is driven by {@link classifyKey} and a set of known-good owners,
 * never by a per-object query: if the listing or the live set is incomplete the
 * job must under-delete, never over-delete. A failed listing therefore throws
 * before anything is removed.
 */
export async function sweepOrphanObjects({
  dryRun = false,
  minAgeMs = ORPHAN_MIN_AGE_MS,
} = {}): Promise<SweepResult> {
  const objects = await listObjects(GALLERY_PREFIX);

  // Read the rows AFTER the listing. In the other order, a photo uploaded
  // between the two calls would appear in the listing but not in the live set,
  // and be deleted as an orphan.
  const [photos, galleries] = await Promise.all([
    prisma.photo.findMany({ select: { objectKey: true } }),
    prisma.gallery.findMany({ select: { storagePrefix: true } }),
  ]);

  const { orphans, skippedTooRecent, skippedUnknown } = selectOrphans(
    objects,
    liveIndex(photos, galleries),
    Date.now() - minAgeMs,
  );

  const base: SweepResult = {
    objectsListed: objects.length,
    orphansFound: orphans.length,
    orphansDeleted: 0,
    bytesReclaimed: 0,
    skippedTooRecent,
    skippedUnknown,
    refused: null,
    failures: [],
  };

  if (exceedsBlastRadius(orphans.length, objects.length)) {
    return {
      ...base,
      refused: `${orphans.length} of ${objects.length} listed objects looked like debris — refusing to delete that much at once. Run \`sweepOrphanObjects({ dryRun: true })\` and check the classification before clearing this by hand.`,
    };
  }

  const failures: string[] = [];
  let orphansDeleted = 0;
  let bytesReclaimed = 0;

  for (const object of orphans) {
    if (!dryRun) {
      try {
        await deleteObject(object.key);
      } catch (error) {
        failures.push(`${object.key}: ${(error as Error).message}`);
        continue;
      }
    }
    orphansDeleted += 1;
    bytesReclaimed += object.sizeBytes;
  }

  return { ...base, orphansDeleted, bytesReclaimed, failures };
}

/**
 * True when a run is worth an email.
 *
 * A sweep that deletes nothing is the normal, boring outcome and mailing it
 * weekly would train the reader to ignore the one that matters. A refusal, a
 * failure, or bytes actually leaving the bucket is not boring — and neither is
 * an unrecognised key, which means {@link classifyKey} has a gap that is
 * quietly accumulating storage nobody is cleaning up.
 */
export function sweepIsNoteworthy(result: SweepResult): boolean {
  return (
    result.refused !== null ||
    result.failures.length > 0 ||
    result.orphansDeleted > 0 ||
    result.skippedUnknown > 0
  );
}

export function renderSweepReport(result: SweepResult): { subject: string; text: string } {
  const megabytes = (result.bytesReclaimed / 1024 / 1024).toFixed(1);
  const subject = result.refused
    ? "g-gallery: úklid úložiště zastaven"
    : `g-gallery: úklid úložiště smazal ${result.orphansDeleted} objektů`;

  const lines = [
    `Vylistováno objektů: ${result.objectsListed}`,
    `Vyhodnoceno jako odpad: ${result.orphansFound}`,
    `Smazáno: ${result.orphansDeleted} (${megabytes} MB)`,
    `Přeskočeno jako čerstvé: ${result.skippedTooRecent}`,
    `Přeskočeno jako nerozpoznané: ${result.skippedUnknown}`,
  ];

  if (result.refused) lines.push("", `ZASTAVENO: ${result.refused}`);
  if (result.skippedUnknown > 0) {
    lines.push(
      "",
      "Nerozpoznané objekty se nikdy nemažou. Pokud jich přibývá, chybí pro ně pravidlo v classifyKey() — do té doby zabírají místo, které nikdo neuklidí.",
    );
  }
  if (result.failures.length > 0) lines.push("", "Chyby:", ...result.failures);

  return { subject, text: lines.join("\n") };
}
