import "server-only";
import { prisma } from "@/lib/db";
import { deleteObject } from "@/lib/r2";

// Presigned-PUT flows can leave two kinds of debris (docs/PLAN.md §5):
//   - ghost rows: a Photo row was created, the upload never confirmed
//   - orphan objects: bytes landed in R2 but the row was deleted afterwards
//
// Ghost rows are cheap to find (status + age). Orphan objects require listing
// the bucket, which needs the S3 ListObjectsV2 API; for now we handle the
// common case — deleting a gallery cascades its objects.

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
