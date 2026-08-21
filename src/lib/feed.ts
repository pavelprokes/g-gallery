import "server-only";
import { prisma } from "@/lib/db";
import type { ActivityType } from "@/generated/prisma/enums";

/**
 * The owner's Updates feed — the in-app half of the notification pipeline
 * (docs/PLAN.md §8). Google Photos shows activity in-app and emails only for a
 * new album; this is the in-app surface, with push and the digest layered on it.
 */

/** Nobody reads a feed of heartbeats, so page size stays small and recent. */
const DEFAULT_LIMIT = 40;

/** Beyond this the badge reads "99+" rather than a number nobody acts on. */
export const BADGE_CAP = 99;

export interface FeedEntry {
  id: string;
  type: ActivityType;
  createdAt: Date;
  galleryId: string;
  galleryTitle: string;
  photoId: string | null;
  photoObjectKey: string | null;
  /** Only ever a name the viewer typed in themselves. */
  viewerName: string | null;
}

/**
 * Which events are worth the owner's attention.
 *
 * GALLERY_VIEW is excluded on purpose: the share page posts one on load and
 * again every 5 minutes as a heartbeat, so including it would bury every real
 * interaction under a wall of repeat visits. Session counts already answer
 * "how many views" in the dashboard.
 */
const FEED_TYPES: ActivityType[] = ["REACTION", "FAVORITE", "DOWNLOAD", "VISITOR_IDENTIFIED"];

/** Recent activity across every gallery this user owns. */
export async function ownerFeed(ownerId: string, limit = DEFAULT_LIMIT): Promise<FeedEntry[]> {
  const events = await prisma.activityEvent.findMany({
    where: { type: { in: FEED_TYPES }, gallery: { ownerId } },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      type: true,
      createdAt: true,
      galleryId: true,
      gallery: { select: { title: true } },
      photoId: true,
      photo: { select: { objectKey: true } },
      viewer: { select: { displayName: true } },
    },
  });

  return events.map((event) => ({
    id: event.id,
    type: event.type,
    createdAt: event.createdAt,
    galleryId: event.galleryId,
    galleryTitle: event.gallery.title,
    photoId: event.photoId,
    photoObjectKey: event.photo?.objectKey ?? null,
    viewerName: event.viewer?.displayName ?? null,
  }));
}

/**
 * How many feed-worthy events arrived since the owner last opened the feed.
 * Counted, not derived from the page above, so the badge stays correct when
 * more than one page of events is unread.
 */
export async function unreadCount(ownerId: string): Promise<number> {
  const user = await prisma.user.findUnique({
    where: { id: ownerId },
    select: { feedLastReadAt: true },
  });

  return prisma.activityEvent.count({
    where: {
      type: { in: FEED_TYPES },
      gallery: { ownerId },
      // A never-opened feed counts everything rather than nothing.
      ...(user?.feedLastReadAt ? { createdAt: { gt: user.feedLastReadAt } } : {}),
    },
  });
}

/** Marks the feed read. Idempotent; the timestamp only ever moves forward. */
export async function markFeedRead(ownerId: string): Promise<void> {
  await prisma.user.update({
    where: { id: ownerId },
    data: { feedLastReadAt: new Date() },
  });
}
