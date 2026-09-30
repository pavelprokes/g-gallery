import type { ActivityType } from "@/generated/prisma/enums";

/** One feed row as {@link groupFeed} needs it (a subset of `FeedEntry`). */
export interface GroupableEntry {
  id: string;
  type: ActivityType;
  createdAt: Date;
  galleryId: string;
  galleryTitle: string;
  photoId: string | null;
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
  viewerId: string | null;
  viewerName: string | null;
  /** Events folded in. */
  events: number;
  /** Distinct photos they touched — a reaction changed three times is one. */
  photoCount: number;
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
 * A viewer with no id cannot be told from another, so such events are never
 * merged — except downloads: the archive route records none of them with a
 * viewer, and the row then only claims how many downloads there were.
 */
export function groupFeed(entries: readonly GroupableEntry[]): FeedGroup[] {
  const groups: FeedGroup[] = [];
  const seen = new Map<FeedGroup, Set<string>>();
  for (const entry of entries) {
    const group = groups.at(-1);
    if (
      group &&
      group.type === entry.type &&
      group.galleryId === entry.galleryId &&
      group.viewerId === entry.viewerId &&
      (entry.viewerId !== null || entry.type === "DOWNLOAD") &&
      group.earliest.getTime() - entry.createdAt.getTime() <= GROUP_GAP_MS
    ) {
      group.events += 1;
      group.earliest = entry.createdAt;
      const photos = seen.get(group)!;
      const photo = entry.photoId ?? entry.id;
      if (!photos.has(photo)) {
        photos.add(photo);
        group.photoCount += 1;
      }
      const key = entry.photoObjectKey;
      if (key && group.photos.length < MAX_THUMBS && !group.photos.includes(key)) {
        group.photos.push(key);
      }
      continue;
    }
    const next: FeedGroup = {
      id: entry.id,
      type: entry.type,
      galleryId: entry.galleryId,
      galleryTitle: entry.galleryTitle,
      viewerId: entry.viewerId,
      viewerName: entry.viewerName,
      events: 1,
      photoCount: 1,
      latest: entry.createdAt,
      earliest: entry.createdAt,
      photos: entry.photoObjectKey ? [entry.photoObjectKey] : [],
    };
    seen.set(next, new Set([entry.photoId ?? entry.id]));
    groups.push(next);
  }
  return groups;
}
