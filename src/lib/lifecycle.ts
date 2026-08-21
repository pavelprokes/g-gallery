import "server-only";
import { prisma } from "@/lib/db";

/**
 * Retention tiering (docs/PLAN.md, decision #4): originals move to R2
 * Infrequent Access N months after delivery. **Nothing is ever deleted** — a
 * wedding gallery is irreplaceable, and the saving from deleting it would be
 * cents.
 *
 * IA is cheaper to store and more expensive to read, which is exactly the
 * shape of an old gallery: viewed heavily for a fortnight, then almost never.
 * R2 charges a per-object Class A operation for the transition, so this runs
 * monthly and in bounded batches.
 */

/** Months after publication before originals are considered cold. */
const DEFAULT_AGE_MONTHS = Number(process.env.IA_AFTER_MONTHS ?? 6);

/**
 * R2 bills a minimum 30-day storage duration for IA. Moving an object that is
 * about to be read again would cost more than it saves, so recently viewed
 * galleries are left alone regardless of age.
 */
const RECENT_ACTIVITY_DAYS = 30;

/** Bounded so one run cannot blow the function's time budget. */
const MAX_PER_RUN = 500;

export interface LifecycleResult {
  galleriesConsidered: number;
  photosTiered: number;
  skippedRecentlyViewed: number;
  failures: string[];
}

export interface TierCandidate {
  galleryId: string;
  title: string;
  photoIds: string[];
}

/**
 * Which galleries are cold enough to tier. Pure, so the age and
 * recent-activity rules are testable without a database.
 */
export function selectColdGalleries(
  galleries: {
    id: string;
    title: string;
    publishedAt: Date | null;
    lastActivityAt: Date | null;
    photoIds: string[];
  }[],
  now: Date,
  ageMonths = DEFAULT_AGE_MONTHS,
): { cold: TierCandidate[]; skippedRecentlyViewed: number } {
  const ageCutoff = new Date(now);
  ageCutoff.setMonth(ageCutoff.getMonth() - ageMonths);
  const activityCutoff = new Date(now.getTime() - RECENT_ACTIVITY_DAYS * 24 * 60 * 60 * 1000);

  const cold: TierCandidate[] = [];
  let skippedRecentlyViewed = 0;

  for (const gallery of galleries) {
    // An unpublished gallery was never delivered, so the clock has not started.
    if (!gallery.publishedAt || gallery.publishedAt > ageCutoff) continue;
    if (gallery.photoIds.length === 0) continue;

    if (gallery.lastActivityAt && gallery.lastActivityAt > activityCutoff) {
      skippedRecentlyViewed += 1;
      continue;
    }

    cold.push({ galleryId: gallery.id, title: gallery.title, photoIds: gallery.photoIds });
  }

  return { cold, skippedRecentlyViewed };
}

/**
 * Marks cold originals as IA.
 *
 * Only the `Photo.storageTier` column is written here. R2 exposes no
 * "change storage class" call for an existing object — the transition is
 * driven by a bucket lifecycle rule keyed on object age, configured once in
 * the dashboard (docs/SETUP.md §11). This job records what the bucket policy
 * will do so the admin and the cost model stay honest about it, and so a
 * future restore path knows which objects are slow to read.
 */
export async function tierColdGalleries({
  dryRun = false,
  now = new Date(),
  ageMonths = DEFAULT_AGE_MONTHS,
} = {}): Promise<LifecycleResult> {
  const galleries = await prisma.gallery.findMany({
    where: { status: "PUBLISHED", photos: { some: { storageTier: "STANDARD" } } },
    select: {
      id: true,
      title: true,
      publishedAt: true,
      photos: {
        where: { storageTier: "STANDARD", status: "CONFIRMED" },
        select: { id: true },
        take: MAX_PER_RUN,
      },
      sessions: {
        orderBy: { lastActivityAt: "desc" },
        take: 1,
        select: { lastActivityAt: true },
      },
    },
  });

  const { cold, skippedRecentlyViewed } = selectColdGalleries(
    galleries.map((gallery) => ({
      id: gallery.id,
      title: gallery.title,
      publishedAt: gallery.publishedAt,
      lastActivityAt: gallery.sessions[0]?.lastActivityAt ?? null,
      photoIds: gallery.photos.map((photo) => photo.id),
    })),
    now,
    ageMonths,
  );

  const failures: string[] = [];
  let photosTiered = 0;

  for (const candidate of cold) {
    if (dryRun) {
      photosTiered += candidate.photoIds.length;
      continue;
    }
    try {
      const { count } = await prisma.photo.updateMany({
        where: { id: { in: candidate.photoIds } },
        data: { storageTier: "INFREQUENT_ACCESS" },
      });
      photosTiered += count;
    } catch (error) {
      failures.push(`${candidate.title}: ${(error as Error).message}`);
    }
  }

  return {
    galleriesConsidered: galleries.length,
    photosTiered,
    skippedRecentlyViewed,
    failures,
  };
}
