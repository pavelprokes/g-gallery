import "server-only";
import { prisma } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import {
  signBuildManifest,
  BUILD_MANIFEST_TTL_SECONDS,
  type BuildManifest,
} from "@/lib/zip-build-manifest";
import { uniqueNames } from "@/lib/zip-manifest";

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
  | { attempted: false }
  | { attempted: true; galleryId: string; ok: true }
  | { attempted: true; galleryId: string; ok: false; reason: string };

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

export async function kickoffPendingZipBuild(): Promise<KickoffResult> {
  const env = serverEnv();
  if (!env.ZIP_BUILDER_WORKER_URL || !env.ZIP_BUILD_SIGNING_SECRET) {
    return { attempted: false };
  }

  const gallery = await prisma.gallery.findFirst({
    where: {
      status: "PUBLISHED",
      trashedAt: null,
      zipStatus: { in: ["NONE", "PENDING"] },
      photos: { some: { status: "CONFIRMED" } },
    },
    // Oldest-waiting first, so one gallery being repeatedly re-queued (e.g.
    // missing checksums) never starves the others.
    orderBy: { updatedAt: "asc" },
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
  if (!gallery) return { attempted: false };

  const missing = gallery.photos.findIndex((p) => !p.crc32 || !p.sizeBytes);
  if (missing >= 0) {
    // Leave it PENDING — a later tick retries once reconcile/upload catches
    // the photo up, rather than silently excluding it from the archive.
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
 * Queue consumer, Worker redeploy mid-build, whatever) would otherwise block
 * that gallery forever — nothing else re-queues it once it leaves
 * NONE/PENDING. Anything still BUILDING after this long gets a fresh attempt
 * rather than a permanent stall; the old multipart upload is abandoned
 * (R2 has no cost for an incomplete one sitting unfinished, but the builder
 * Worker's own cron also aborts it explicitly once it notices).
 */
const STALE_BUILD_MINUTES = 60;

export async function resetStaleZipBuilds(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_BUILD_MINUTES * 60_000);
  const { count } = await prisma.gallery.updateMany({
    where: { zipStatus: "BUILDING", updatedAt: { lt: cutoff } },
    data: { zipStatus: "PENDING", zipUploadId: null, zipPartsExpected: null },
  });
  return count;
}
