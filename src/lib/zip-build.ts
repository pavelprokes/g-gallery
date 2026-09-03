import "server-only";
import { prisma } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import {
  signBuildManifest,
  BUILD_MANIFEST_TTL_SECONDS,
  type BuildManifest,
} from "@/lib/zip-build-manifest";
import { uniqueNames } from "@/lib/zip-manifest";
import {
  chooseZipBuild,
  ZIP_BUILD_CANDIDATE_LIMIT,
  type SkipReason,
  type ZipBuildCandidate,
  type ZipStatusName,
} from "@/lib/zip-build-policy";

/**
 * Background "download all" ZIP build (docs/TODO.md §7).
 *
 * Kickoff only — the app never builds the archive itself (CLAUDE.md invariant
 * #1: no ZIP bytes through Vercel). This finds one gallery that wants a fresh
 * archive, hands the builder Worker a signed manifest of what to zip and
 * where, and records that a build is in flight. The Worker calls
 * `/api/internal/zip-callback` when it's done; this function never waits for
 * that.
 */

export type KickoffResult =
  | { attempted: false; reason: "not_configured" }
  /** Nothing was built, and why — one entry per gallery that was passed over.
   * "Nothing to do" and "everything is stuck" used to be the same empty
   * answer, which is how this went unnoticed for a day. */
  | { attempted: false; reason: "nothing_eligible"; skipped: { id: string; reason: SkipReason }[] }
  | { attempted: true; galleryId: string; ok: true }
  | { attempted: true; galleryId: string; ok: false; reason: string };

/**
 * Records that a gallery's set of confirmed photos changed — a confirmed
 * upload, or a delete — and invalidates any pre-built archive.
 *
 * One function rather than the three near-identical copies this used to be
 * (`uploads/confirm`, `g/[token]/mine`, `admin/actions`), because the two
 * writes have to stay together: the timestamp is what defers a build until the
 * gallery settles, and it must move for **every** change, while the status
 * reset must not touch a NONE gallery (nobody has asked for a zip yet).
 *
 * `photosChangedAt` cannot be derived. Photo rows are hard-deleted, so a
 * photographer culling a gallery leaves nothing behind to read a time off —
 * and that is exactly when a rebuild is most wasteful, since the next delete
 * invalidates it again.
 */
export async function markGalleryPhotosChanged(galleryId: string): Promise<void> {
  await prisma.gallery.updateMany({
    where: { id: galleryId },
    data: { photosChangedAt: new Date() },
  });

  // A build already in flight is left running — `zip-callback` fences on
  // `zipUploadId`, so one that finishes after this is ignored as stale rather
  // than served as current. `zipAttempts` resets because the gallery's
  // contents changed: past failures say nothing about this build.
  await prisma.gallery.updateMany({
    where: { id: galleryId, zipStatus: { in: ["READY", "BUILDING", "FAILED"] } },
    data: { zipStatus: "PENDING", zipAttempts: 0 },
  });
}

/** ASCII-safe: Content-Disposition filenames travel badly with diacritics — same rule as `zip/route.ts`'s live-download archive name. */
function archiveNameFor(title: string): string {
  const slug =
    title
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase()
      .slice(0, 60) || "galerie";
  return `${slug}.zip`;
}

/**
 * A cheap scan of everything that might want building, with just enough per
 * gallery for {@link chooseZipBuild} to decide. Deliberately *not* a
 * `findFirst`: the query cannot express "skip this one and take the next", so
 * a single unbuildable gallery at the front used to block the whole queue.
 */
async function loadCandidates(): Promise<ZipBuildCandidate[]> {
  const rows = await prisma.gallery.findMany({
    where: {
      status: "PUBLISHED",
      trashedAt: null,
      // FAILED is in here now. It is not a terminal state any more — the retry
      // backoff and attempt cap live in zip-build-policy.ts.
      zipStatus: { in: ["NONE", "PENDING", "FAILED"] },
      photos: { some: { status: "CONFIRMED" } },
    },
    orderBy: { updatedAt: "asc" },
    take: ZIP_BUILD_CANDIDATE_LIMIT,
    select: {
      id: true,
      zipStatus: true,
      zipAttempts: true,
      updatedAt: true,
      photosChangedAt: true,
      _count: {
        select: {
          photos: {
            where: { status: "CONFIRMED", OR: [{ crc32: null }, { sizeBytes: null }] },
          },
        },
      },
      photos: {
        where: { status: "CONFIRMED" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true },
      },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    zipStatus: row.zipStatus as ZipStatusName,
    zipAttempts: row.zipAttempts,
    updatedAt: row.updatedAt,
    photosChangedAt: row.photosChangedAt,
    newestPhotoAt: row.photos[0]?.createdAt ?? null,
    photosMissingChecksum: row._count.photos,
  }));
}

export async function kickoffPendingZipBuild(): Promise<KickoffResult> {
  const env = serverEnv();
  if (!env.ZIP_BUILDER_WORKER_URL || !env.ZIP_BUILD_SIGNING_SECRET) {
    return { attempted: false, reason: "not_configured" };
  }

  const choice = chooseZipBuild(await loadCandidates());
  if (!choice.pick) {
    return { attempted: false, reason: "nothing_eligible", skipped: choice.skipped };
  }

  const gallery = await prisma.gallery.findUnique({
    where: { id: choice.pick.id },
    select: {
      id: true,
      title: true,
      storagePrefix: true,
      photos: {
        where: { status: "CONFIRMED" },
        // Capture order — the archive unpacks in the order the day happened.
        orderBy: [{ takenAt: "asc" }, { id: "asc" }],
        select: { objectKey: true, fileName: true, sizeBytes: true, crc32: true },
      },
    },
  });
  // Deleted between the scan and here — the next tick picks something else.
  if (!gallery) return { attempted: false, reason: "nothing_eligible", skipped: choice.skipped };

  const missing = gallery.photos.findIndex((p) => !p.crc32 || !p.sizeBytes);
  if (missing >= 0) {
    // The candidate scan already filters these out; reaching this means a photo
    // was confirmed between the two queries. Leave it alone rather than
    // shipping an archive quietly missing a photo.
    return { attempted: true, galleryId: gallery.id, ok: false, reason: "missing_checksum" };
  }

  const names = uniqueNames(gallery.photos.map((p) => p.fileName));
  const entries = gallery.photos.map((photo, i) => ({
    key: photo.objectKey,
    name: names[i]!,
    size: photo.sizeBytes!,
    crc32: photo.crc32!,
  }));

  const objectKey = `${gallery.storagePrefix}/_archive.zip`;
  const manifest: BuildManifest = {
    galleryId: gallery.id,
    objectKey,
    archiveName: archiveNameFor(gallery.title),
    entries,
    exp: Math.floor(Date.now() / 1000) + BUILD_MANIFEST_TTL_SECONDS,
  };
  const token = await signBuildManifest(manifest, env.ZIP_BUILD_SIGNING_SECRET);

  // Marked BUILDING (with no uploadId yet) before the request goes out, so a
  // crashed/timed-out kickoff still shows as "in progress" rather than
  // silently retrying the same gallery every tick. `zip-callback` clears
  // this back to PENDING on a build-start failure it hears about; a kickoff
  // that never even got a response is caught by the stale-build sweep below.
  await prisma.gallery.update({ where: { id: gallery.id }, data: { zipStatus: "BUILDING" } });

  let response: Response;
  try {
    response = await fetch(`${env.ZIP_BUILDER_WORKER_URL}/build-start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
  } catch (error) {
    await prisma.gallery.update({ where: { id: gallery.id }, data: { zipStatus: "PENDING" } });
    return { attempted: true, galleryId: gallery.id, ok: false, reason: (error as Error).message };
  }

  if (!response.ok) {
    await prisma.gallery.update({ where: { id: gallery.id }, data: { zipStatus: "PENDING" } });
    return {
      attempted: true,
      galleryId: gallery.id,
      ok: false,
      reason: `worker_${response.status}`,
    };
  }

  const body = (await response.json()) as { uploadId: string; expectedParts: number };
  await prisma.gallery.update({
    where: { id: gallery.id },
    data: {
      zipUploadId: body.uploadId,
      zipObjectKey: objectKey,
      zipPartsExpected: body.expectedParts,
    },
  });

  return { attempted: true, galleryId: gallery.id, ok: true };
}

/**
 * A BUILDING gallery whose Worker-side build never reported back (crashed
 * Queue consumer, Worker redeploy mid-build, a part that exhausted its
 * retries) would otherwise sit there forever — nothing re-queues it once it
 * leaves NONE/PENDING.
 *
 * It is recorded as FAILED rather than dropped straight back to PENDING, so
 * that a hung build and a build the Worker actively reported as failed go
 * through the *same* backoff and attempt cap (`zip-build-policy.ts`). Two
 * different retry rules for two flavours of the same outcome is how one of
 * them ends up never being retried at all.
 *
 * The abandoned R2 multipart upload is the builder Worker's to abort — and
 * incomplete parts are billed as stored data, so a bucket lifecycle rule
 * backstops it (docs/SETUP.md §10).
 */
const STALE_BUILD_MINUTES = 60;

export async function failStaleZipBuilds(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_BUILD_MINUTES * 60_000);
  const { count } = await prisma.gallery.updateMany({
    where: { zipStatus: "BUILDING", updatedAt: { lt: cutoff } },
    data: {
      zipStatus: "FAILED",
      zipAttempts: { increment: 1 },
      zipUploadId: null,
      zipPartsExpected: null,
    },
  });
  return count;
}
