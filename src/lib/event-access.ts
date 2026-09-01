import "server-only";
import type { PhotoStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { hashShareToken } from "@/lib/share-token";
import { visibleEventCards, type EventGalleryRow } from "@/lib/event-cards";

/**
 * The wedding page's own gate (docs/GUEST-GALLERIES.md §2).
 *
 * The event token is a separate secret from any gallery's share token — that
 * separation is the whole access model: forwarding a gallery link never
 * exposes the wedding page, because the recipient was never given this token.
 * As with share links, only the SHA-256 is stored (invariant 5).
 */
export interface EventCard extends EventGalleryRow {
  photoCount: number;
  cover: { objectKey: string; placeholder: string | null } | null;
  storagePrefix: string;
  latestPhotoAt: Date | null;
}

/**
 * Which photo a gallery leads with, everywhere it is represented by one tile.
 *
 * `Gallery.coverPhotoId` is the photographer's deliberate choice and always
 * wins; newest-first is the fallback for a gallery nobody has chosen for yet.
 * A chosen photo that has been deleted cannot linger (the FK is `SetNull`), but
 * one that is not CONFIRMED still has to be skipped — its bytes may never have
 * reached R2, and an empty tile is worse than the wrong photo.
 */
export function pickCover<T extends { status: PhotoStatus }>(
  chosen: T | null | undefined,
  newest: T | null | undefined,
): T | null {
  if (chosen && chosen.status === "CONFIRMED") return chosen;
  return newest ?? null;
}

export interface ResolvedEvent {
  id: string;
  title: string;
  eventDate: Date | null;
  venue: string | null;
  slug: string;
  /** Only the galleries a holder of this token may actually open. */
  cards: EventCard[];
}

export async function resolveEvent(eventToken: string): Promise<ResolvedEvent | null> {
  if (!eventToken || eventToken.length > 128) return null;

  const event = await prisma.event.findUnique({
    // A trashed wedding is on its way to permanent deletion; its page stops
    // resolving immediately rather than showing cards that are about to vanish.
    where: { tokenHash: hashShareToken(eventToken), trashedAt: null },
    select: {
      id: true,
      title: true,
      eventDate: true,
      venue: true,
      slug: true,
      galleries: {
        select: {
          id: true,
          title: true,
          eventKey: true,
          position: true,
          listedOnEvent: true,
          status: true,
          trashedAt: true,
          storagePrefix: true,
          eventLink: { select: { revokedAt: true, expiresAt: true } },
          _count: { select: { photos: { where: { status: "CONFIRMED" } } } },
          // The photographer's pick, when there is one ({@link pickCover}).
          coverPhoto: { select: { objectKey: true, placeholder: true, status: true } },
          // Still fetched even with a cover chosen: `latestPhotoAt` is the
          // card's "last updated" line, which is a different question.
          photos: {
            where: { status: "CONFIRMED" },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 1,
            select: { objectKey: true, placeholder: true, status: true, createdAt: true },
          },
        },
      },
    },
  });
  if (!event) return null;

  const rows: EventCard[] = event.galleries.map((gallery) => {
    const cover = pickCover(gallery.coverPhoto, gallery.photos[0]);
    return {
      id: gallery.id,
      title: gallery.title,
      eventKey: gallery.eventKey,
      position: gallery.position,
      listedOnEvent: gallery.listedOnEvent,
      status: gallery.status,
      trashedAt: gallery.trashedAt,
      eventLink: gallery.eventLink,
      storagePrefix: gallery.storagePrefix,
      photoCount: gallery._count.photos,
      cover: cover ? { objectKey: cover.objectKey, placeholder: cover.placeholder } : null,
      latestPhotoAt: gallery.photos[0]?.createdAt ?? null,
    };
  });

  return {
    id: event.id,
    title: event.title,
    eventDate: event.eventDate,
    venue: event.venue,
    slug: event.slug,
    cards: visibleEventCards(rows, new Date()),
  };
}
