import "server-only";
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
          // Cover: the newest confirmed photo. `Gallery.coverPhotoId` exists
          // but is not set anywhere yet, so honouring it would be a second
          // query for a field nothing writes — revisit when it does.
          photos: {
            where: { status: "CONFIRMED" },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 1,
            select: { objectKey: true, placeholder: true, createdAt: true },
          },
        },
      },
    },
  });
  if (!event) return null;

  const rows: EventCard[] = event.galleries.map((gallery) => ({
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
    cover: gallery.photos[0]
      ? { objectKey: gallery.photos[0].objectKey, placeholder: gallery.photos[0].placeholder }
      : null,
    latestPhotoAt: gallery.photos[0]?.createdAt ?? null,
  }));

  return {
    id: event.id,
    title: event.title,
    eventDate: event.eventDate,
    venue: event.venue,
    slug: event.slug,
    cards: visibleEventCards(rows, new Date()),
  };
}
