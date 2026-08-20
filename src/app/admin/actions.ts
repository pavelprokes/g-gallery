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
 * it can never be recovered or displayed again.
 */
export async function createShareLink(formData: FormData): Promise<string> {
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
    select: { id: true },
  });
  if (!gallery) throw new Error("NOT_FOUND");

  const token = generateShareToken();

  await prisma.shareLink.create({
    data: {
      galleryId: gallery.id,
      tokenHash: hashShareToken(token),
      label: parsed.data.label,
      passwordHash: parsed.data.password ? await hashPassword(parsed.data.password) : null,
      expiresAt: parsed.data.expiresInDays
        ? new Date(Date.now() + parsed.data.expiresInDays * 86_400_000)
        : null,
    },
  });

  revalidatePath(`/admin/g/${gallery.id}`);
  return token;
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
