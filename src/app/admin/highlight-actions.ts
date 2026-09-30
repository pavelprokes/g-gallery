"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth-guard";
import { idSchema } from "@/lib/id-schema";
import { MAX_PINNED } from "@/lib/gallery-highlights";

// Server Actions are publicly reachable POST endpoints — every one of them
// re-verifies the session internally (CLAUDE.md invariant #3), and every write
// is scoped by the gallery's `ownerId`. docs/HIGHLIGHTS.md is the authority
// for what the highlights are.

/** Pins a photo into the highlights (true), keeps it out (false), or hands it
 * back to the automatic fill (null). */
export async function setHighlightPin(photoId: string, pin: boolean | null) {
  const session = await requireAdmin();

  const input = z.object({ photoId: idSchema, pin: z.boolean().nullable() }).safeParse({
    photoId,
    pin,
  });
  if (!input.success) throw new Error("INVALID_INPUT");

  const photo = await prisma.photo.findFirst({
    where: { id: input.data.photoId, gallery: { ownerId: session.user.id } },
    select: { id: true, galleryId: true },
  });
  if (!photo) throw new Error("NOT_FOUND");

  // The section shows MAX_PINNED at most; a pin past it would push out
  // another one without a word (docs/HIGHLIGHTS.md).
  if (input.data.pin === true) {
    const pinned = await prisma.photo.count({
      where: {
        galleryId: photo.galleryId,
        highlightPin: true,
        status: "CONFIRMED",
        NOT: { id: photo.id },
      },
    });
    if (pinned >= MAX_PINNED) throw new Error("HIGHLIGHTS_FULL");
  }

  await prisma.photo.update({ where: { id: photo.id }, data: { highlightPin: input.data.pin } });
  revalidatePath(`/admin/g/${photo.galleryId}`);
}

/** Shows or hides the highlights for the gallery's guests. */
export async function setHighlightsEnabled(galleryId: string, enabled: boolean) {
  const session = await requireAdmin();

  const input = z.object({ galleryId: idSchema, enabled: z.boolean() }).safeParse({
    galleryId,
    enabled,
  });
  if (!input.success) throw new Error("INVALID_INPUT");

  const updated = await prisma.gallery.updateMany({
    where: { id: input.data.galleryId, ownerId: session.user.id },
    data: { highlightsEnabled: input.data.enabled },
  });
  if (updated.count === 0) throw new Error("NOT_FOUND");
  revalidatePath(`/admin/g/${input.data.galleryId}`);
}

/** Hands every photo kept out of the highlights back to the automatic fill. */
export async function clearHighlightExclusions(galleryId: string) {
  const session = await requireAdmin();

  const id = idSchema.safeParse(galleryId);
  if (!id.success) throw new Error("INVALID_INPUT");

  await prisma.photo.updateMany({
    where: { galleryId: id.data, highlightPin: false, gallery: { ownerId: session.user.id } },
    data: { highlightPin: null },
  });
  revalidatePath(`/admin/g/${id.data}`);
}
