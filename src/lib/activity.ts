import "server-only";
import { prisma } from "@/lib/db";
import type { ActivityType } from "@/generated/prisma/enums";

/** A viewer returning after this gap starts a new ViewSession (= one "view"). */
const SESSION_GAP_MS = 30 * 60 * 1000;

/** CNIL-aligned ceiling on how long a viewer identity may persist. */
export const VIEWER_MAX_AGE_DAYS = 395; // 13 months

interface RecordViewInput {
  galleryId: string;
  shareLinkId: string;
  /** First-party localStorage UUID — the ONLY viewer identifier we keep. */
  anonKey: string;
  photoId?: string;
  type: ActivityType;
}

export interface ViewerCounts {
  views: number;
  uniqueViewers: number;
}

/**
 * Records activity from an anonymous share-link viewer.
 *
 * GDPR (docs/PLAN.md §8): no IP address, no user agent, no cross-site
 * identifier is stored — only the first-party anonKey the viewer's own browser
 * generated, which also powers their favorites. Viewers who opted out are
 * recognised and silently skipped.
 */
export async function recordActivity(input: RecordViewInput): Promise<void> {
  const now = new Date();

  const viewer = await prisma.viewer.upsert({
    where: { galleryId_anonKey: { galleryId: input.galleryId, anonKey: input.anonKey } },
    create: {
      galleryId: input.galleryId,
      shareLinkId: input.shareLinkId,
      anonKey: input.anonKey,
      lastSeenAt: now,
    },
    update: { lastSeenAt: now },
    select: { id: true, optedOut: true },
  });

  if (viewer.optedOut) return;

  if (input.type === "GALLERY_VIEW") {
    const recent = await prisma.viewSession.findFirst({
      where: {
        viewerId: viewer.id,
        lastActivityAt: { gte: new Date(now.getTime() - SESSION_GAP_MS) },
      },
      orderBy: { lastActivityAt: "desc" },
      select: { id: true },
    });

    if (recent) {
      // Heartbeat within the same session — extend it, don't double-count.
      await prisma.viewSession.update({
        where: { id: recent.id },
        data: { lastActivityAt: now },
      });
      return;
    }

    await prisma.viewSession.create({
      data: { viewerId: viewer.id, galleryId: input.galleryId, lastActivityAt: now },
    });
  }

  await prisma.activityEvent.create({
    data: {
      galleryId: input.galleryId,
      photoId: input.photoId,
      viewerId: viewer.id,
      type: input.type,
    },
  });
}

/** Gallery-level totals for the admin dashboard. */
export async function galleryCounts(galleryId: string): Promise<ViewerCounts> {
  const [views, uniqueViewers] = await Promise.all([
    prisma.viewSession.count({ where: { galleryId } }),
    prisma.viewer.count({ where: { galleryId, optedOut: false } }),
  ]);
  return { views, uniqueViewers };
}

/**
 * Per-photo views and unique viewers, in one grouped query per metric rather
 * than N queries per photo.
 */
export async function photoCounts(galleryId: string): Promise<Map<string, ViewerCounts>> {
  const [views, uniques] = await Promise.all([
    prisma.activityEvent.groupBy({
      by: ["photoId"],
      where: { galleryId, type: "PHOTO_VIEW", photoId: { not: null } },
      _count: { _all: true },
    }),
    prisma.activityEvent.findMany({
      where: { galleryId, type: "PHOTO_VIEW", photoId: { not: null } },
      distinct: ["photoId", "viewerId"],
      select: { photoId: true },
    }),
  ]);

  const counts = new Map<string, ViewerCounts>();
  for (const row of views) {
    if (row.photoId) counts.set(row.photoId, { views: row._count._all, uniqueViewers: 0 });
  }
  for (const row of uniques) {
    if (!row.photoId) continue;
    const entry = counts.get(row.photoId) ?? { views: 0, uniqueViewers: 0 };
    entry.uniqueViewers += 1;
    counts.set(row.photoId, entry);
  }
  return counts;
}
