"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth-guard";
import { idSchema } from "@/lib/id-schema";

// The photographer's side of the corrections mode (docs/CORRECTIONS.md).
// Server Actions are public POST endpoints: the session is re-verified and
// every write is scoped by the gallery's owner (CLAUDE.md invariant #3).

/** Marks a correction done — or open again. A done one is read-only for the couple. */
export async function setCorrectionResolved(commentId: string, resolved: boolean): Promise<void> {
  const session = await requireAdmin();
  const comment = await prisma.photoComment.findFirst({
    where: { id: idSchema.parse(commentId), photo: { gallery: { ownerId: session.user.id } } },
    select: { id: true, photo: { select: { galleryId: true } } },
  });
  if (!comment) throw new Error("NOT_FOUND");
  await prisma.photoComment.update({
    where: { id: comment.id },
    data: { resolvedAt: resolved ? new Date() : null },
  });
  revalidatePath(`/admin/g/${comment.photo.galleryId}`);
}
