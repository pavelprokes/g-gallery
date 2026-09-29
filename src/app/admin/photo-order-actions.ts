"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth-guard";
import { PHOTO_ORDERS, type PhotoOrder } from "@/lib/photo-order";
import { refreshWovenOrder } from "@/lib/woven-order-db";

// Server Actions are publicly reachable POST endpoints — this one re-verifies
// the session (CLAUDE.md invariant #3) and scopes the write by `ownerId`.
// docs/PHOTO-ORDER.md is the authority for what the orders mean.

const inputSchema = z.object({
  galleryId: z.string().min(1).max(64),
  order: z.enum(PHOTO_ORDERS as [PhotoOrder, ...PhotoOrder[]]),
});

/** Shows the gallery's photos by capture time, by file name, or by file name
 * with guests' photos woven in by capture time. */
export async function setPhotoOrder(galleryId: string, order: PhotoOrder) {
  const session = await requireAdmin();

  const input = inputSchema.safeParse({ galleryId, order });
  if (!input.success) throw new Error("INVALID_INPUT");

  const owned = await prisma.gallery.findFirst({
    where: { id: input.data.galleryId, ownerId: session.user.id },
    select: { id: true },
  });
  if (!owned) throw new Error("NOT_FOUND");

  // The woven order reads `wovenAt`, which is only kept up to date while a
  // gallery uses it — so it is written, for every photo and chapter start,
  // before the switch that makes guests' pages read it.
  if (input.data.order === "FILE_NAME_GUESTS_BY_TIME") {
    await refreshWovenOrder(owned.id, { force: true });
  }

  // Nothing else to move: chapters store their start in every order, and the
  // guests' pages read the order on every request. The pre-built archive
  // keeps its entry order until the next rebuild — the same files either way.
  const updated = await prisma.gallery.updateMany({
    where: { id: input.data.galleryId, ownerId: session.user.id },
    data: { photoOrder: input.data.order },
  });
  if (updated.count === 0) throw new Error("NOT_FOUND");
  // Once more after the switch: a photo confirmed between the two writes was
  // skipped by its own refresh (the order was not woven yet when it ran).
  if (input.data.order === "FILE_NAME_GUESTS_BY_TIME") await refreshWovenOrder(owned.id);
  revalidatePath(`/admin/g/${input.data.galleryId}`);
}
