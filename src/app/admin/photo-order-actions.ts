"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth-guard";

// Server Actions are publicly reachable POST endpoints — this one re-verifies
// the session (CLAUDE.md invariant #3) and scopes the write by `ownerId`.
// docs/PHOTO-ORDER.md is the authority for what the orders mean.

const inputSchema = z.object({
  galleryId: z.string().min(1).max(64),
  order: z.enum(["TAKEN_AT", "FILE_NAME"]),
});

/** Shows the gallery's photos by capture time or by file name. */
export async function setPhotoOrder(galleryId: string, order: "TAKEN_AT" | "FILE_NAME") {
  const session = await requireAdmin();

  const input = inputSchema.safeParse({ galleryId, order });
  if (!input.success) throw new Error("INVALID_INPUT");

  // Nothing else to move: chapters store their start in both orders, and the
  // guests' pages read the order on every request. The pre-built archive
  // keeps its entry order until the next rebuild — the same files either way.
  const updated = await prisma.gallery.updateMany({
    where: { id: input.data.galleryId, ownerId: session.user.id },
    data: { photoOrder: input.data.order },
  });
  if (updated.count === 0) throw new Error("NOT_FOUND");
  revalidatePath(`/admin/g/${input.data.galleryId}`);
}
