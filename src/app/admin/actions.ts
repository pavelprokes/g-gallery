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
import { gallerySlug } from "@/lib/gallery-slug";

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
});

/**
 * Returns the raw token exactly once — only its SHA-256 hash is persisted, so
 * it can never be recovered or displayed again. The slug is frozen here too
 * (docs/TODO.md §6): a later rename of the gallery doesn't reach links
 * already handed out, matching Notion/Figma's own trade-off.
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
      label: parsed.data.label,
      passwordHash: parsed.data.password ? await hashPassword(parsed.data.password) : null,
      expiresAt: parsed.data.expiresInDays
        ? new Date(Date.now() + parsed.data.expiresInDays * 86_400_000)
        : null,
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
