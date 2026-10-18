"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth-guard";
import { idSchema } from "@/lib/id-schema";
import { movePhoto } from "@/lib/manual-order-db";

// Server Actions are publicly reachable POST endpoints — this one re-verifies
// the session (CLAUDE.md invariant #3) and scopes the write by `ownerId`.
// docs/PHOTO-ORDER.md §Manual order is the authority.

const inputSchema = z.object({
  galleryId: idSchema,
  photoId: idSchema,
  afterId: idSchema.nullable(),
});

/**
 * Puts a photo right after another one (null: first) in a gallery arranged by
 * hand. The neighbours are read from the database, not taken from the
 * browser: two tabs dragging at once still end in a consistent order.
 */
export async function moveGalleryPhoto(galleryId: string, photoId: string, afterId: string | null) {
  const session = await requireAdmin();

  const input = inputSchema.safeParse({ galleryId, photoId, afterId });
  if (!input.success) throw new Error("INVALID_INPUT");

  const gallery = await prisma.gallery.findFirst({
    where: { id: input.data.galleryId, ownerId: session.user.id },
    select: { photoOrder: true },
  });
  if (!gallery) throw new Error("NOT_FOUND");
  // Only an arranged gallery shows this order; a move elsewhere would change
  // nothing a guest sees and only surprise the photographer later.
  if (gallery.photoOrder !== "MANUAL") throw new Error("NOT_MANUAL");

  await movePhoto(input.data.galleryId, input.data.photoId, input.data.afterId);
  revalidatePath(`/admin/g/${input.data.galleryId}`);
}
