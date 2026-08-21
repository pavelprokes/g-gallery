import "server-only";
import { prisma } from "@/lib/db";
import { deleteObject, listObjects, type StoredObject } from "@/lib/r2";

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
 * Decides which listed objects are safe to delete. Pure and exported so the
 * one rule that matters — a key backed by a Photo row is never a candidate,
 * whatever its age — is covered by tests rather than by inspection.
 */
export function selectOrphans(
  objects: StoredObject[],
  liveKeys: ReadonlySet<string>,
  cutoffMs: number,
): { orphans: StoredObject[]; skippedTooRecent: number } {
  const orphans: StoredObject[] = [];
  let skippedTooRecent = 0;

  for (const object of objects) {
    if (liveKeys.has(object.key)) continue;
    if (object.lastModified.getTime() > cutoffMs) {
      skippedTooRecent += 1;
      continue;
    }
    orphans.push(object);
  }

  return { orphans, skippedTooRecent };
}

export interface SweepResult {
  objectsListed: number;
  orphansDeleted: number;
  bytesReclaimed: number;
  skippedTooRecent: number;
  failures: string[];
}

/**
 * Deletes bytes in the bucket that no Photo row points at.
 *
 * This is the mirror image of {@link reconcileGhostUploads}: that one finds
 * rows without bytes, this one finds bytes without rows — the debris left when
 * a row is deleted but its R2 delete fails, or when a confirm lands after the
 * ghost sweep already removed the row.
 *
 * Deletion is driven by a set of known-good keys, never by a per-object query:
 * if the listing or the key set is incomplete the job must under-delete, never
 * over-delete. A failed listing therefore throws before anything is removed.
 */
export async function sweepOrphanObjects({
  dryRun = false,
  minAgeMs = ORPHAN_MIN_AGE_MS,
} = {}): Promise<SweepResult> {
  const objects = await listObjects(GALLERY_PREFIX);

  // Read the rows AFTER the listing. In the other order, a photo uploaded
  // between the two calls would appear in the listing but not in the key set,
  // and be deleted as an orphan.
  const rows = await prisma.photo.findMany({ select: { objectKey: true } });
  const liveKeys = new Set(rows.map((row) => row.objectKey).filter(Boolean));

  const { orphans, skippedTooRecent } = selectOrphans(objects, liveKeys, Date.now() - minAgeMs);

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

  return {
    objectsListed: objects.length,
    orphansDeleted,
    bytesReclaimed,
    skippedTooRecent,
    failures,
  };
}
