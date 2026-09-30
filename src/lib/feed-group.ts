import type { ActivityType } from "@/generated/prisma/enums";

/** One feed row as {@link groupFeed} needs it (a subset of `FeedEntry`). */
export interface GroupableEntry {
  id: string;
  type: ActivityType;
  createdAt: Date;
  galleryId: string;
  galleryTitle: string;
  viewerId: string | null;
  viewerName: string | null;
  photoObjectKey: string | null;
}

export interface FeedGroup {
  /** The newest entry's id — stable across renders. */
  id: string;
  type: ActivityType;
  galleryId: string;
  galleryTitle: string;
  viewerName: string | null;
  count: number;
  /** Newest and oldest entry in the group. */
  latest: Date;
  earliest: Date;
  /** Up to {@link MAX_THUMBS} photos, newest first, no repeats. */
  photos: string[];
}

/** How far apart two actions may be and still read as one sitting. */
export const GROUP_GAP_MS = 30 * 60 * 1000;
export const MAX_THUMBS = 6;

/**
 * Folds a newest-first feed into runs: the same person doing the same thing in
 * the same gallery, each action within {@link GROUP_GAP_MS} of the previous.
 * Twenty "Někdo stáhl fotku" rows from one morning become one row with twenty.
 * Anonymous viewers are told apart by `viewerId`, never merged across people.
 */
export function groupFeed(entries: readonly GroupableEntry[]): FeedGroup[] {
  const groups: FeedGroup[] = [];
  let lastViewer: string | null = null;
  for (const entry of entries) {
    const group = groups.at(-1);
    if (
      group &&
      group.type === entry.type &&
      group.galleryId === entry.galleryId &&
      lastViewer === entry.viewerId &&
      group.earliest.getTime() - entry.createdAt.getTime() <= GROUP_GAP_MS
    ) {
      group.count += 1;
      group.earliest = entry.createdAt;
      const key = entry.photoObjectKey;
      if (key && group.photos.length < MAX_THUMBS && !group.photos.includes(key)) {
        group.photos.push(key);
      }
      continue;
    }
    lastViewer = entry.viewerId;
    groups.push({
      id: entry.id,
      type: entry.type,
      galleryId: entry.galleryId,
      galleryTitle: entry.galleryTitle,
      viewerName: entry.viewerName,
      count: 1,
      latest: entry.createdAt,
      earliest: entry.createdAt,
      photos: entry.photoObjectKey ? [entry.photoObjectKey] : [],
    });
  }
  return groups;
}
