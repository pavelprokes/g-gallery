import "server-only";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { generateCorrectionPin } from "@/lib/correction-session";
import { gallerySlug, slugify } from "@/lib/gallery-slug";
import { printEntries } from "@/lib/print-export";
import { printTotals } from "@/lib/print-selections";
import { presignDownload } from "@/lib/r2";
import {
  generateShareToken,
  generateStoragePrefix,
  hashPassword,
  hashShareToken,
} from "@/lib/share-token";
import { encryptToken } from "@/lib/token-cipher";

// The photographer's admin operations, scoped by owner. Two callers: the Server
// Actions in src/app/admin (which verify the session first, CLAUDE.md
// invariant #3) and the MCP tools (docs/MCP.md), which verify the bearer token
// first — one implementation, so Claude and the admin UI cannot drift apart.
// Input is already validated by the caller; a row that is not the owner's
// throws NOT_FOUND, exactly as the actions always did.

export interface GalleryFields {
  title: string;
  eventDate: Date | null;
  description?: string | null;
}

export async function createGalleryFor(ownerId: string, fields: GalleryFields): Promise<string> {
  const gallery = await prisma.gallery.create({
    data: {
      ownerId,
      title: fields.title,
      eventDate: fields.eventDate,
      description: fields.description ?? null,
      storagePrefix: generateStoragePrefix(),
    },
    select: { id: true },
  });

  revalidatePath("/admin");
  return gallery.id;
}

export async function publishGalleryFor(ownerId: string, galleryId: string): Promise<void> {
  await prisma.gallery.updateMany({
    where: { id: galleryId, ownerId },
    data: { status: "PUBLISHED", publishedAt: new Date() },
  });

  revalidatePath("/admin");
  revalidatePath(`/admin/g/${galleryId}`);
}

/**
 * Takes a gallery back to DRAFT.
 *
 * This is a real cut-off, not a cosmetic flag: every share surface refuses a
 * gallery that is not PUBLISHED, so every link to it — including a wedding-page
 * card — starts returning 404 immediately. That is the point, and it is why the
 * button asks first.
 */
export async function unpublishGalleryFor(ownerId: string, galleryId: string): Promise<void> {
  const gallery = await prisma.gallery.findFirst({
    where: { id: galleryId, ownerId },
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

/**
 * Renames a gallery, or fixes its date or description.
 *
 * Two things are deliberately **not** recomputed, for the same reason as
 * {@link updateEventFor}: `ShareLink.slug` (docs/TODO.md §6) and
 * `Gallery.eventKey` are frozen at creation. Both may already be in somebody's
 * inbox or on printed signage, and neither resolves anything — the token does.
 * A stale segment looks slightly wrong; a changed URL breaks.
 *
 * `translations` undefined leaves them as they are.
 */
export async function updateGalleryFor(
  ownerId: string,
  galleryId: string,
  fields: GalleryFields & { translations?: Prisma.InputJsonObject },
): Promise<void> {
  const gallery = await prisma.gallery.findFirst({
    where: { id: galleryId, ownerId },
    select: { id: true, eventId: true },
  });
  if (!gallery) throw new Error("NOT_FOUND");

  await prisma.gallery.update({
    where: { id: gallery.id },
    data: {
      title: fields.title,
      eventDate: fields.eventDate,
      description: fields.description ?? null,
      ...(fields.translations ? { translations: fields.translations } : {}),
    },
  });

  revalidatePath(`/admin/g/${gallery.id}`);
  revalidatePath("/admin");
  if (gallery.eventId) revalidatePath(`/admin/e/${gallery.eventId}`);
}

/**
 * Picks the photo a gallery leads with, or clears it with `null`.
 *
 * The chosen photo has to be a CONFIRMED photo of *this* gallery: a cover
 * pointing at a row whose bytes never landed would render an empty tile, and
 * one borrowed from another gallery would leak a frame across a share link that
 * was never given it.
 */
export async function setGalleryCoverFor(
  ownerId: string,
  galleryId: string,
  photoId: string | null,
): Promise<void> {
  const gallery = await prisma.gallery.findFirst({
    where: { id: galleryId, ownerId },
    select: { id: true, eventId: true },
  });
  if (!gallery) throw new Error("NOT_FOUND");

  if (photoId) {
    const photo = await prisma.photo.findFirst({
      where: { id: photoId, galleryId: gallery.id, status: "CONFIRMED" },
      select: { id: true },
    });
    if (!photo) throw new Error("NOT_FOUND");
  }

  await prisma.gallery.update({ where: { id: gallery.id }, data: { coverPhotoId: photoId } });

  revalidatePath(`/admin/g/${gallery.id}`);
  revalidatePath("/admin");
  if (gallery.eventId) revalidatePath(`/admin/e/${gallery.eventId}`);
}

/** The switches every viewer surface reads. Absent means off, everywhere. */
export interface ShareLinkPermissions {
  allowDownload?: boolean;
  allowReactions?: boolean;
  allowPrintSelection?: boolean;
  /** Opens an anonymous write path into the gallery (docs/GUEST-GALLERIES.md §6). */
  allowUpload?: boolean;
  /** The corrections mode behind a PIN (docs/CORRECTIONS.md). */
  allowCorrections?: boolean;
}

function permissionColumns(permissions: ShareLinkPermissions) {
  return {
    allowDownload: permissions.allowDownload ?? false,
    allowReactions: permissions.allowReactions ?? false,
    allowPrintSelection: permissions.allowPrintSelection ?? false,
    allowUpload: permissions.allowUpload ?? false,
    allowCorrections: permissions.allowCorrections ?? false,
  };
}

/** A new PIN for the corrections mode, as stored: hash to verify, cipher to show. */
export async function newCorrectionPin() {
  const pin = generateCorrectionPin();
  return { correctionPinHash: await hashPassword(pin), correctionPinCipher: encryptToken(pin) };
}

export interface ShareLinkInput extends ShareLinkPermissions {
  galleryId: string;
  label?: string;
  password?: string;
  expiresInDays?: number;
}

/**
 * Returns the raw token, and also stores it encrypted so the admin can show it
 * again later (`src/lib/token-cipher.ts`). Access still resolves only by the
 * SHA-256 hash. The slug is frozen here too (docs/TODO.md §6): a later rename
 * of the gallery doesn't reach links already handed out, matching
 * Notion/Figma's own trade-off.
 */
export async function createShareLinkFor(
  ownerId: string,
  input: ShareLinkInput,
): Promise<{ id: string; token: string; slug: string }> {
  const gallery = await prisma.gallery.findFirst({
    where: { id: input.galleryId, ownerId },
    select: { id: true, title: true, eventDate: true },
  });
  if (!gallery) throw new Error("NOT_FOUND");

  const token = generateShareToken();
  const slug = gallerySlug(gallery.title, gallery.eventDate);

  const link = await prisma.shareLink.create({
    data: {
      galleryId: gallery.id,
      tokenHash: hashShareToken(token),
      tokenCipher: encryptToken(token),
      label: input.label,
      passwordHash: input.password ? await hashPassword(input.password) : null,
      expiresAt: input.expiresInDays
        ? new Date(Date.now() + input.expiresInDays * 86_400_000)
        : null,
      ...permissionColumns(input),
      ...(input.allowCorrections ? await newCorrectionPin() : {}),
      slug,
    },
    select: { id: true },
  });

  revalidatePath(`/admin/g/${gallery.id}`);
  return { id: link.id, token, slug };
}

/**
 * Changes what an already-issued link may do.
 *
 * Without this the only way to turn a download off is to revoke and reissue,
 * which kills a URL the couple has already forwarded to eighty people. A link's
 * *identity* (token, slug, password, expiry) is deliberately untouched here —
 * only the switches move, so the address in everyone's inbox keeps working
 * and means something slightly different from the next request onwards.
 */
export async function setShareLinkPermissionsFor(
  ownerId: string,
  shareLinkId: string,
  permissions: ShareLinkPermissions,
): Promise<void> {
  const link = await prisma.shareLink.findFirst({
    where: { id: shareLinkId, gallery: { ownerId } },
    select: { id: true, galleryId: true, correctionPinHash: true },
  });
  if (!link) throw new Error("NOT_FOUND");

  await prisma.shareLink.update({
    where: { id: link.id },
    data: {
      ...permissionColumns(permissions),
      // The first time the mode is switched on, the link gets its PIN; later
      // switches keep it, so a PIN already handed over stays valid.
      ...(permissions.allowCorrections && !link.correctionPinHash ? await newCorrectionPin() : {}),
    },
  });

  revalidatePath(`/admin/g/${link.galleryId}`);
}

export interface EventFields {
  title: string;
  eventDate: Date | null;
  venue?: string | null;
}

/**
 * A *different secret* from any gallery's share token — that separation is what
 * keeps a forwarded gallery link from exposing the wedding page. Stored
 * encrypted alongside its hash so the address can be shown and copied from the
 * admin at any time.
 */
export async function createEventFor(
  ownerId: string,
  fields: EventFields,
): Promise<{ id: string; token: string; slug: string }> {
  const token = generateShareToken();
  const slug = gallerySlug(fields.title, fields.eventDate);

  const event = await prisma.event.create({
    data: {
      ownerId,
      title: fields.title,
      eventDate: fields.eventDate,
      venue: fields.venue ?? undefined,
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
 * Renames a wedding, or fixes its date or venue.
 *
 * The **slug is deliberately not recomputed**. It is frozen at creation for the
 * same reason a share link's is (docs/TODO.md §6): the address may already be
 * printed on signage, and silently changing the canonical URL after a typo fix
 * would be a worse outcome than a URL that still says `pavel-a-patricie` for
 * `Pavel a Petra`. The segment is cosmetic and never resolves anything, so a
 * stale one costs nothing but looks slightly wrong.
 *
 * `translations` undefined leaves them as they are.
 */
export async function updateEventFor(
  ownerId: string,
  eventId: string,
  fields: EventFields & { translations?: Prisma.InputJsonObject },
): Promise<void> {
  await prisma.event.updateMany({
    where: { id: eventId, ownerId },
    data: {
      title: fields.title,
      eventDate: fields.eventDate,
      venue: fields.venue ?? null,
      ...(fields.translations ? { translations: fields.translations } : {}),
    },
  });

  revalidatePath(`/admin/e/${eventId}`);
  revalidatePath("/admin");
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
 * Attaches a gallery to a wedding page and gives it the key its card is
 * addressed by (`/s/{token}/{slug}/{eventKey}`). The key is frozen here rather
 * than derived per render, for the same reason a share link's slug is
 * (docs/TODO.md §6): a later rename must not break a URL someone saved.
 */
export async function attachGalleryToEventFor(
  ownerId: string,
  eventId: string,
  galleryId: string,
): Promise<void> {
  const [event, gallery] = await Promise.all([
    prisma.event.findFirst({
      where: { id: eventId, ownerId },
      select: { id: true, galleries: { select: { eventKey: true, position: true } } },
    }),
    prisma.gallery.findFirst({
      where: { id: galleryId, ownerId },
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

/** The listing switch on its own — the gallery's own link is untouched. */
export async function setGalleryListedFor(
  ownerId: string,
  galleryId: string,
  listed: boolean,
): Promise<void> {
  const gallery = await prisma.gallery.findFirst({
    where: { id: galleryId, ownerId },
    select: { id: true, eventId: true },
  });
  if (!gallery) throw new Error("NOT_FOUND");

  await prisma.gallery.update({ where: { id: gallery.id }, data: { listedOnEvent: listed } });

  if (gallery.eventId) revalidatePath(`/admin/e/${gallery.eventId}`);
}

/**
 * Picks which of the gallery's share links the wedding-page card grants
 * through. A gallery can have several (one with a password, one without), and
 * the card must never grant more than the chosen one does — so the link has to
 * belong to this gallery, which is checked here rather than assumed.
 */
export async function setGalleryEventLinkFor(
  ownerId: string,
  galleryId: string,
  shareLinkId: string | null,
): Promise<void> {
  const gallery = await prisma.gallery.findFirst({
    where: { id: galleryId, ownerId },
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

  await prisma.gallery.update({ where: { id: gallery.id }, data: { eventLinkId: shareLinkId } });

  if (gallery.eventId) revalidatePath(`/admin/e/${gallery.eventId}`);
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
export async function createGalleryInEventFor(
  ownerId: string,
  eventId: string,
  fields: GalleryFields & { allowUpload: boolean },
): Promise<{ galleryId: string; shareLinkId: string; token: string; slug: string }> {
  const event = await prisma.event.findFirst({
    where: { id: eventId, ownerId },
    select: { id: true },
  });
  if (!event) throw new Error("NOT_FOUND");

  const galleryId = await createGalleryFor(ownerId, fields);
  await attachGalleryToEventFor(ownerId, event.id, galleryId);
  await publishGalleryFor(ownerId, galleryId);

  const token = generateShareToken();
  const slug = gallerySlug(fields.title, fields.eventDate);
  const link = await prisma.shareLink.create({
    data: {
      galleryId,
      tokenHash: hashShareToken(token),
      tokenCipher: encryptToken(token),
      slug,
      allowUpload: fields.allowUpload,
      label: fields.allowUpload ? "Pro hosty" : "Pro pár",
    },
    select: { id: true },
  });

  await prisma.gallery.update({
    where: { id: galleryId },
    data: {
      eventLinkId: link.id,
      listedOnEvent: false,
      // A guests' gallery is ordered by when its photos were taken: phones
      // name files by their own counters, which say nothing about the day
      // (docs/PHOTO-ORDER.md). Everything else defaults to file-name order.
      ...(fields.allowUpload ? { photoOrder: "TAKEN_AT" as const } : {}),
    },
  });

  revalidatePath(`/admin/e/${event.id}`);
  return { galleryId, shareLinkId: link.id, token, slug };
}

/**
 * Short-lived download links for every photo marked for print, each saved
 * under its print name ("5x_…" for several copies). The browser fetches the
 * bytes from R2 itself — nothing passes through Vercel, and no ZIP is built
 * for a few dozen files. `only` narrows it to those photo ids.
 */
export async function printDownloadsFor(
  ownerId: string,
  galleryId: string,
  only?: readonly string[],
): Promise<{ id: string; fileName: string; name: string; quantity: number; url: string }[]> {
  const gallery = await prisma.gallery.findFirst({
    where: { id: galleryId, ownerId },
    select: { id: true },
  });
  if (!gallery) throw new Error("NOT_FOUND");

  const quantities = await printTotals(gallery.id);
  if (only) {
    const keep = new Set(only);
    for (const id of [...quantities.keys()]) if (!keep.has(id)) quantities.delete(id);
  }
  const photos = await prisma.photo.findMany({
    where: { id: { in: [...quantities.keys()] }, galleryId: gallery.id, status: "CONFIRMED" },
    select: { id: true, objectKey: true, fileName: true },
  });
  const byId = new Map(photos.map((photo) => [photo.id, photo]));

  // Same names, same order as the list the admin copies (printList).
  const entries = printEntries(
    photos.map((photo) => ({
      id: photo.id,
      fileName: photo.fileName,
      quantity: quantities.get(photo.id) ?? 0,
    })),
  );
  return Promise.all(
    entries.map(async (entry) => ({
      id: entry.id,
      fileName: byId.get(entry.id)!.fileName,
      name: entry.name,
      quantity: entry.quantity,
      url: await presignDownload(byId.get(entry.id)!.objectKey, entry.name),
    })),
  );
}

/** Marks a correction done — or open again. A done one is read-only for the couple. */
export async function setCorrectionResolvedFor(
  ownerId: string,
  commentId: string,
  resolved: boolean,
): Promise<void> {
  const comment = await prisma.photoComment.findFirst({
    where: { id: commentId, photo: { gallery: { ownerId } } },
    select: { id: true, photo: { select: { galleryId: true } } },
  });
  if (!comment) throw new Error("NOT_FOUND");
  await prisma.photoComment.update({
    where: { id: comment.id },
    data: { resolvedAt: resolved ? new Date() : null },
  });
  revalidatePath(`/admin/g/${comment.photo.galleryId}`);
}
