import "server-only";
import { prisma } from "@/lib/db";
import type { ReactionKind } from "@/generated/prisma/enums";
import type { PhotoReactionState } from "@/lib/reactions-shared";

/**
 * Reactions are the anonymous-viewer substitute for Google Photos' likes, which
 * require a Google Account (docs/PLAN.md §8). Identity is the first-party
 * anonKey the viewer's own browser generated — nothing else is stored.
 *
 * The vocabulary itself lives in `reactions-shared.ts` so the gallery Client
 * Component can import it without pulling Prisma into the browser bundle.
 */

export type PhotoReactions = PhotoReactionState;

/**
 * Sets, changes, or clears this viewer's reaction to a photo.
 *
 * Passing the kind that is already set clears it, so the same tap toggles —
 * matching how the heart already behaves. Returns the resulting state so the
 * client never has to guess after an optimistic update.
 */
export async function toggleReaction(
  photoId: string,
  viewerId: string,
  kind: ReactionKind,
): Promise<ReactionKind | null> {
  const existing = await prisma.reaction.findUnique({
    where: { photoId_viewerId: { photoId, viewerId } },
    select: { kind: true },
  });

  if (existing?.kind === kind) {
    await prisma.reaction.delete({ where: { photoId_viewerId: { photoId, viewerId } } });
    return null;
  }

  await prisma.reaction.upsert({
    where: { photoId_viewerId: { photoId, viewerId } },
    create: { photoId, viewerId, kind },
    update: { kind },
  });
  return kind;
}

/**
 * Tallies for a whole gallery in one grouped query rather than one per photo —
 * a 500-photo gallery would otherwise issue 500 round trips on every render.
 */
export async function galleryReactions(
  galleryId: string,
  viewerId?: string,
): Promise<Map<string, PhotoReactions>> {
  const [grouped, mine] = await Promise.all([
    prisma.reaction.groupBy({
      by: ["photoId", "kind"],
      where: { photo: { galleryId } },
      _count: { _all: true },
    }),
    viewerId
      ? prisma.reaction.findMany({
          where: { viewerId, photo: { galleryId } },
          select: { photoId: true, kind: true },
        })
      : Promise.resolve([]),
  ]);

  const byPhoto = new Map<string, PhotoReactions>();
  for (const row of grouped) {
    const entry = byPhoto.get(row.photoId) ?? { counts: {}, mine: null };
    entry.counts[row.kind] = row._count._all;
    byPhoto.set(row.photoId, entry);
  }
  for (const row of mine) {
    const entry = byPhoto.get(row.photoId) ?? { counts: {}, mine: null };
    entry.mine = row.kind;
    byPhoto.set(row.photoId, entry);
  }
  return byPhoto;
}

/** Total reactions per photo, for the admin grid. */
export async function reactionTotals(galleryId: string): Promise<Map<string, number>> {
  const grouped = await prisma.reaction.groupBy({
    by: ["photoId"],
    where: { photo: { galleryId } },
    _count: { _all: true },
  });
  return new Map(grouped.map((row) => [row.photoId, row._count._all]));
}
