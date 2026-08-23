"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth-guard";
import {
  generateShareToken,
  generateStoragePrefix,
  hashPassword,
  hashShareToken,
} from "@/lib/share-token";
import { gallerySlug, slugify } from "@/lib/gallery-slug";
import { deleteObject } from "@/lib/r2";
import { encryptToken } from "@/lib/token-cipher";

// Server Actions are publicly reachable POST endpoints — every one of them
// re-verifies the session internally (CLAUDE.md invariant #3).

const createGallerySchema = z.object({
  title: z.string().min(1).max(200),
  eventDate: z.string().optional(),
});

export async function createGallery(formData: FormData) {
  const session = await requireAdmin();

  const parsed = createGallerySchema.safeParse({
    title: formData.get("title"),
    eventDate: formData.get("eventDate") || undefined,
  });
  if (!parsed.success) throw new Error("INVALID_INPUT");

  const gallery = await prisma.gallery.create({
    data: {
      ownerId: session.user.id,
      title: parsed.data.title,
      eventDate: parsed.data.eventDate ? new Date(parsed.data.eventDate) : null,
      storagePrefix: generateStoragePrefix(),
    },
    select: { id: true },
  });

  revalidatePath("/admin");
  return gallery.id;
}

export async function publishGallery(galleryId: string) {
  const session = await requireAdmin();

  await prisma.gallery.updateMany({
    where: { id: galleryId, ownerId: session.user.id },
    data: { status: "PUBLISHED", publishedAt: new Date() },
  });

  revalidatePath("/admin");
  revalidatePath(`/admin/g/${galleryId}`);
}

const createShareLinkSchema = z.object({
  galleryId: z.string().min(1),
  label: z.string().max(200).optional(),
  password: z.string().min(4).max(200).optional(),
  expiresInDays: z.coerce.number().int().positive().max(3650).optional(),
  /**
   * Guests holding this link may add photos (docs/GUEST-GALLERIES.md §6).
   * Off unless the checkbox was ticked: this opens an anonymous write path
   * into the gallery's R2 prefix, so it is never a side effect of anything.
   */
  allowUpload: z.coerce.boolean().optional(),
});

/**
 * Returns the raw token, and also stores it encrypted so the admin can show it
 * again later (`src/lib/token-cipher.ts`). Access still resolves only by the
 * SHA-256 hash. The slug is frozen here too (docs/TODO.md §6): a later rename
 * of the gallery doesn't reach links already handed out, matching
 * Notion/Figma's own trade-off.
 */
export async function createShareLink(
  formData: FormData,
): Promise<{ token: string; slug: string }> {
  const session = await requireAdmin();

  const parsed = createShareLinkSchema.safeParse({
    galleryId: formData.get("galleryId"),
    label: formData.get("label") || undefined,
    password: formData.get("password") || undefined,
    expiresInDays: formData.get("expiresInDays") || undefined,
    allowUpload: formData.get("allowUpload") ? true : undefined,
  });
  if (!parsed.success) throw new Error("INVALID_INPUT");

  const gallery = await prisma.gallery.findFirst({
    where: { id: parsed.data.galleryId, ownerId: session.user.id },
    select: { id: true, title: true, eventDate: true },
  });
  if (!gallery) throw new Error("NOT_FOUND");

  const token = generateShareToken();
  const slug = gallerySlug(gallery.title, gallery.eventDate);

  await prisma.shareLink.create({
    data: {
      galleryId: gallery.id,
      tokenHash: hashShareToken(token),
      tokenCipher: encryptToken(token),
      label: parsed.data.label,
      passwordHash: parsed.data.password ? await hashPassword(parsed.data.password) : null,
      expiresAt: parsed.data.expiresInDays
        ? new Date(Date.now() + parsed.data.expiresInDays * 86_400_000)
        : null,
      allowUpload: parsed.data.allowUpload ?? false,
      slug,
    },
  });

  revalidatePath(`/admin/g/${gallery.id}`);
  return { token, slug };
}

/** Revoking is the only true way to cut off access to an already-shared link. */
export async function revokeShareLink(shareLinkId: string) {
  const session = await requireAdmin();

  const link = await prisma.shareLink.findFirst({
    where: { id: shareLinkId, gallery: { ownerId: session.user.id } },
    select: { id: true, galleryId: true },
  });
  if (!link) throw new Error("NOT_FOUND");

  await prisma.shareLink.update({
    where: { id: link.id },
    data: { revokedAt: new Date() },
  });

  revalidatePath(`/admin/g/${link.galleryId}`);
}

/**
 * Removes a single photo, bytes and all.
 *
 * This is the couple's veto (docs/GUEST-GALLERIES.md §7 / §13.7): once guests
 * can add photos, "get that one out of the album" has to be one click and take
 * effect immediately, not an email to support the way the Czech competitors
 * handle it. Applies to the photographer's own uploads too — there was no
 * per-photo delete before this.
 *
 * Deliberately not reversible: a trash tier for individual photos would need
 * its own retention, purge job and UI, and the gallery-level trash already
 * covers the "I deleted the wrong thing entirely" case.
 */
export async function deletePhoto(photoId: string) {
  const session = await requireAdmin();

  const photo = await prisma.photo.findFirst({
    where: { id: photoId, gallery: { ownerId: session.user.id } },
    select: { id: true, objectKey: true, galleryId: true },
  });
  if (!photo) throw new Error("NOT_FOUND");

  // Row first: an orphaned object is swept up by the weekly reconcile job
  // (src/lib/reconcile.ts), whereas an orphaned row would keep rendering a
  // tile whose bytes are gone.
  await prisma.photo.delete({ where: { id: photo.id } });
  await deleteObject(photo.objectKey);

  // Same staleness rule as a new upload: the pre-built archive no longer
  // matches the gallery's contents (docs/TODO.md §7).
  await prisma.gallery.updateMany({
    where: { id: photo.galleryId, zipStatus: { in: ["READY", "BUILDING", "FAILED"] } },
    data: { zipStatus: "PENDING" },
  });

  revalidatePath(`/admin/g/${photo.galleryId}`);
}

/** How long a trashed gallery is recoverable before the purge cron deletes it for good. */
const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Moves a gallery to trash: hidden from the admin list, R2 objects untouched,
 * and every share link that was still live gets cut off immediately — trash
 * is meant to stop access, not just admin-list visibility, and every already
 * -issued link stays otherwise-valid (`status` untouched) for the whole
 * recovery window. Recoverable via {@link restoreGallery} until `purgeAt`
 * passes. `revokedAt` is stamped with the same instant as `trashedAt` so
 * `restoreGallery` can tell these apart from links revoked independently
 * beforehand, which must stay dead.
 */
export async function trashGallery(galleryId: string) {
  const session = await requireAdmin();

  const now = new Date();
  await prisma.$transaction([
    prisma.gallery.updateMany({
      where: { id: galleryId, ownerId: session.user.id },
      data: { trashedAt: now, purgeAt: new Date(now.getTime() + TRASH_RETENTION_MS) },
    }),
    prisma.shareLink.updateMany({
      where: { galleryId, gallery: { ownerId: session.user.id }, revokedAt: null },
      data: { revokedAt: now },
    }),
  ]);

  revalidatePath("/admin");
  revalidatePath(`/admin/g/${galleryId}`);
}

/**
 * Pulls a gallery back out of trash before the purge cron gets to it, and
 * un-revokes exactly the share links {@link trashGallery} revoked — matched
 * by `revokedAt` equalling the gallery's own `trashedAt`, so a link the owner
 * had already revoked before trashing (a different timestamp) stays revoked.
 */
export async function restoreGallery(galleryId: string) {
  const session = await requireAdmin();

  const gallery = await prisma.gallery.findFirst({
    where: { id: galleryId, ownerId: session.user.id },
    select: { trashedAt: true },
  });
  if (!gallery) throw new Error("NOT_FOUND");

  await prisma.$transaction([
    prisma.gallery.updateMany({
      where: { id: galleryId, ownerId: session.user.id },
      data: { trashedAt: null, purgeAt: null },
    }),
    ...(gallery.trashedAt
      ? [
          prisma.shareLink.updateMany({
            where: { galleryId, revokedAt: gallery.trashedAt },
            data: { revokedAt: null },
          }),
        ]
      : []),
  ]);

  revalidatePath("/admin");
  revalidatePath(`/admin/g/${galleryId}`);
}

// ---------------------------------------------------------------------------
// Wedding pages (docs/GUEST-GALLERIES.md §2)
// ---------------------------------------------------------------------------

const createEventSchema = z.object({
  title: z.string().min(1).max(200),
  eventDate: z.string().optional(),
  venue: z.string().max(200).optional(),
});

/**
 * A *different secret* from any gallery's share token — that separation is what
 * keeps a forwarded gallery link from exposing the wedding page. Stored
 * encrypted alongside its hash so the address can be shown and copied from the
 * admin at any time.
 */
export async function createEvent(
  formData: FormData,
): Promise<{ id: string; token: string; slug: string }> {
  const session = await requireAdmin();

  const parsed = createEventSchema.safeParse({
    title: formData.get("title"),
    eventDate: formData.get("eventDate") || undefined,
    venue: formData.get("venue") || undefined,
  });
  if (!parsed.success) throw new Error("INVALID_INPUT");

  const eventDate = parsed.data.eventDate ? new Date(parsed.data.eventDate) : null;
  const token = generateShareToken();
  const slug = gallerySlug(parsed.data.title, eventDate);

  const event = await prisma.event.create({
    data: {
      ownerId: session.user.id,
      title: parsed.data.title,
      eventDate,
      venue: parsed.data.venue,
      tokenHash: hashShareToken(token),
      tokenCipher: encryptToken(token),
      slug,
    },
    select: { id: true },
  });

  revalidatePath("/admin");
  return { id: event.id, token, slug };
}

/**
 * Attaches a gallery to a wedding page and gives it the key its card is
 * addressed by (`/s/{token}/{slug}/{eventKey}`). The key is frozen here rather
 * than derived per render, for the same reason a share link's slug is
 * (docs/TODO.md §6): a later rename must not break a URL someone saved.
 */
export async function attachGalleryToEvent(eventId: string, galleryId: string) {
  const session = await requireAdmin();

  const [event, gallery] = await Promise.all([
    prisma.event.findFirst({
      where: { id: eventId, ownerId: session.user.id },
      select: { id: true, galleries: { select: { eventKey: true, position: true } } },
    }),
    prisma.gallery.findFirst({
      where: { id: galleryId, ownerId: session.user.id },
      select: { id: true, title: true },
    }),
  ]);
  if (!event || !gallery) throw new Error("NOT_FOUND");

  const taken = new Set(
    event.galleries.map((g) => g.eventKey).filter((key): key is string => Boolean(key)),
  );
  const nextPosition = Math.max(0, ...event.galleries.map((g) => g.position + 1), 0);

  await prisma.gallery.update({
    where: { id: gallery.id },
    data: {
      eventId: event.id,
      eventKey: uniqueEventKey(gallery.title, taken),
      position: nextPosition,
    },
  });

  revalidatePath(`/admin/e/${event.id}`);
  revalidatePath(`/admin/g/${gallery.id}`);
}

/** Suffixes until free. Keys only need to be unique within one wedding. */
function uniqueEventKey(title: string, taken: Set<string>): string {
  const base = slugify(title) || "galerie";
  if (!taken.has(base)) return base;
  for (let n = 2; n < 100; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error("NO_FREE_EVENT_KEY");
}

/**
 * Removes the card from the wedding page. Deliberately leaves the gallery's own
 * share links alone: the two switches are independent, and someone the couple
 * sent a gallery link to keeps their access (docs/GUEST-GALLERIES.md §3).
 */
export async function detachGalleryFromEvent(galleryId: string) {
  const session = await requireAdmin();

  const gallery = await prisma.gallery.findFirst({
    where: { id: galleryId, ownerId: session.user.id },
    select: { id: true, eventId: true },
  });
  if (!gallery) throw new Error("NOT_FOUND");

  await prisma.gallery.update({
    where: { id: gallery.id },
    data: { eventId: null, eventKey: null, eventLinkId: null, position: 0 },
  });

  if (gallery.eventId) revalidatePath(`/admin/e/${gallery.eventId}`);
  revalidatePath(`/admin/g/${gallery.id}`);
}

/** The listing switch on its own — the gallery's own link is untouched. */
export async function setGalleryListed(galleryId: string, listed: boolean) {
  const session = await requireAdmin();

  const gallery = await prisma.gallery.findFirst({
    where: { id: galleryId, ownerId: session.user.id },
    select: { id: true, eventId: true },
  });
  if (!gallery) throw new Error("NOT_FOUND");

  await prisma.gallery.update({
    where: { id: gallery.id },
    data: { listedOnEvent: listed },
  });

  if (gallery.eventId) revalidatePath(`/admin/e/${gallery.eventId}`);
}

/**
 * Picks which of the gallery's share links the wedding-page card grants
 * through. A gallery can have several (one with a password, one without), and
 * the card must never grant more than the chosen one does — so the link has to
 * belong to this gallery, which is checked here rather than assumed.
 */
export async function setGalleryEventLink(galleryId: string, shareLinkId: string | null) {
  const session = await requireAdmin();

  const gallery = await prisma.gallery.findFirst({
    where: { id: galleryId, ownerId: session.user.id },
    select: { id: true, eventId: true },
  });
  if (!gallery) throw new Error("NOT_FOUND");

  if (shareLinkId) {
    const link = await prisma.shareLink.findFirst({
      where: { id: shareLinkId, galleryId: gallery.id },
      select: { id: true },
    });
    if (!link) throw new Error("NOT_FOUND");
  }

  await prisma.gallery.update({
    where: { id: gallery.id },
    data: { eventLinkId: shareLinkId },
  });

  if (gallery.eventId) revalidatePath(`/admin/e/${gallery.eventId}`);
}

/**
 * Moves a wedding page to trash. Mirrors {@link trashGallery}: the page stops
 * resolving at once (`resolveEvent` refuses a trashed event) and the purge cron
 * deletes it after the recovery window. The galleries themselves are NOT
 * trashed — they are the photographer's work and have their own lifecycle;
 * only the page that listed them goes away.
 */
export async function trashEvent(eventId: string) {
  const session = await requireAdmin();

  const now = new Date();
  await prisma.event.updateMany({
    where: { id: eventId, ownerId: session.user.id },
    data: { trashedAt: now, purgeAt: new Date(now.getTime() + TRASH_RETENTION_MS) },
  });

  revalidatePath("/admin");
}

export async function restoreEvent(eventId: string) {
  const session = await requireAdmin();

  await prisma.event.updateMany({
    where: { id: eventId, ownerId: session.user.id },
    data: { trashedAt: null, purgeAt: null },
  });

  revalidatePath("/admin");
}

/**
 * Creates a gallery already wired into a wedding page: attached, published, and
 * with a share link the card grants through.
 *
 * Doing all four steps by hand is where the flow used to go wrong — a gallery
 * created, attached and listed, but with no designated link, produces no card
 * and no error. Here the only remaining step is the deliberate one.
 *
 * It is created **not listed**. Everything is ready, but nothing appears on the
 * rozcestník until someone presses "Zobrazit na stránce" — in a product whose
 * whole point is that the couple decides what is shared, a new gallery must not
 * publish itself to eighty people as a side effect of being created.
 */
export async function createGalleryForEvent(eventId: string, formData: FormData) {
  const session = await requireAdmin();

  const event = await prisma.event.findFirst({
    where: { id: eventId, ownerId: session.user.id },
    select: { id: true },
  });
  if (!event) throw new Error("NOT_FOUND");

  const galleryId = await createGallery(formData);
  await attachGalleryToEvent(event.id, galleryId);
  await publishGallery(galleryId);

  const gallery = await prisma.gallery.findFirstOrThrow({
    where: { id: galleryId },
    select: { title: true, eventDate: true },
  });

  const token = generateShareToken();
  const link = await prisma.shareLink.create({
    data: {
      galleryId,
      tokenHash: hashShareToken(token),
      tokenCipher: encryptToken(token),
      slug: gallerySlug(gallery.title, gallery.eventDate),
      allowUpload: formData.get("allowUpload") ? true : false,
      label: formData.get("allowUpload") ? "Pro hosty" : "Pro pár",
    },
    select: { id: true },
  });

  await prisma.gallery.update({
    where: { id: galleryId },
    data: { eventLinkId: link.id, listedOnEvent: false },
  });

  revalidatePath(`/admin/e/${event.id}`);
}

const updateEventSchema = z.object({
  title: z.string().min(1).max(200),
  eventDate: z.string().optional(),
  venue: z.string().max(200).optional(),
});

/**
 * Renames a wedding, or fixes its date or venue.
 *
 * The **slug is deliberately not recomputed**. It is frozen at creation for the
 * same reason a share link's is (docs/TODO.md §6): the address may already be
 * printed on signage, and silently changing the canonical URL after a typo fix
 * would be a worse outcome than a URL that still says `pavel-a-patricie` for
 * `Pavel a Petra`. The segment is cosmetic and never resolves anything, so a
 * stale one costs nothing but looks slightly wrong.
 */
export async function updateEvent(eventId: string, formData: FormData) {
  const session = await requireAdmin();

  const parsed = updateEventSchema.safeParse({
    title: formData.get("title"),
    eventDate: formData.get("eventDate") || undefined,
    venue: formData.get("venue") || undefined,
  });
  if (!parsed.success) throw new Error("INVALID_INPUT");

  await prisma.event.updateMany({
    where: { id: eventId, ownerId: session.user.id },
    data: {
      title: parsed.data.title,
      eventDate: parsed.data.eventDate ? new Date(parsed.data.eventDate) : null,
      venue: parsed.data.venue ?? null,
    },
  });

  revalidatePath(`/admin/e/${eventId}`);
  revalidatePath("/admin");
}

/**
 * Moves a card one place up or down on the wedding page.
 *
 * Swaps the two positions rather than renumbering the list, so concurrent edits
 * cannot leave a gap, and writes both in one transaction so a half-applied swap
 * cannot duplicate a position.
 */
export async function moveGalleryInEvent(galleryId: string, direction: "up" | "down") {
  const session = await requireAdmin();

  const gallery = await prisma.gallery.findFirst({
    where: { id: galleryId, ownerId: session.user.id, eventId: { not: null } },
    select: { id: true, eventId: true, position: true, title: true },
  });
  if (!gallery?.eventId) throw new Error("NOT_FOUND");

  const siblings = await prisma.gallery.findMany({
    where: { eventId: gallery.eventId },
    orderBy: [{ position: "asc" }, { title: "asc" }],
    select: { id: true, position: true },
  });

  const index = siblings.findIndex((sibling) => sibling.id === gallery.id);
  const target = siblings[direction === "up" ? index - 1 : index + 1];
  // Already at the end it can move to — nothing to do, and not an error.
  if (index < 0 || !target) return;

  // Ties on position are legal (everything attached in one go starts at 0), so
  // a plain swap of equal numbers would be a no-op. Renumber the pair from the
  // list order instead, which is what the page actually sorts by.
  await prisma.$transaction([
    prisma.gallery.update({ where: { id: gallery.id }, data: { position: target.position } }),
    prisma.gallery.update({
      where: { id: target.id },
      data: {
        position: gallery.position === target.position ? target.position + 1 : gallery.position,
      },
    }),
  ]);

  revalidatePath(`/admin/e/${gallery.eventId}`);
}

/**
 * Takes a gallery back to DRAFT.
 *
 * This is a real cut-off, not a cosmetic flag: every share surface refuses a
 * gallery that is not PUBLISHED, so every link to it — including a wedding-page
 * card — starts returning 404 immediately. That is the point, and it is why the
 * button asks first.
 */
export async function unpublishGallery(galleryId: string) {
  const session = await requireAdmin();

  const gallery = await prisma.gallery.findFirst({
    where: { id: galleryId, ownerId: session.user.id },
    select: { id: true, eventId: true },
  });
  if (!gallery) throw new Error("NOT_FOUND");

  await prisma.gallery.update({
    where: { id: gallery.id },
    data: { status: "DRAFT", publishedAt: null },
  });

  revalidatePath(`/admin/g/${gallery.id}`);
  if (gallery.eventId) revalidatePath(`/admin/e/${gallery.eventId}`);
}
