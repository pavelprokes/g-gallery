import "server-only";
import { prisma } from "@/lib/db";

/**
 * Print selection is the third per-viewer photo interaction, alongside
 * Favorite and Reaction (docs/PLAN.md §8) — same anonKey-only identity, same
 * no-IP guarantee, but a quantity (1-99) instead of a boolean or an enum.
 */

/** Sets this viewer's print quantity for a photo. 0 removes the selection. */
export async function setPrintQuantity(
  photoId: string,
  viewerId: string,
  quantity: number,
): Promise<number> {
  if (quantity <= 0) {
    await prisma.printSelection.deleteMany({ where: { photoId, viewerId } });
    return 0;
  }

  const selection = await prisma.printSelection.upsert({
    where: { photoId_viewerId: { photoId, viewerId } },
    create: { photoId, viewerId, quantity },
    update: { quantity },
    select: { quantity: true },
  });
  return selection.quantity;
}

/** This viewer's own print selections, to seed the UI after a reload. */
export async function viewerPrintSelections(
  galleryId: string,
  viewerId: string,
): Promise<Map<string, number>> {
  const rows = await prisma.printSelection.findMany({
    where: { viewerId, photo: { galleryId } },
    select: { photoId: true, quantity: true },
  });
  return new Map(rows.map((row) => [row.photoId, row.quantity]));
}

/**
 * Quantities summed across every viewer, for the admin grid — a wedding hub's
 * photo can be marked by more than one guest, and the photographer needs one
 * number to order, not a per-person breakdown.
 */
export async function printTotals(galleryId: string): Promise<Map<string, number>> {
  const grouped = await prisma.printSelection.groupBy({
    by: ["photoId"],
    where: { photo: { galleryId } },
    _sum: { quantity: true },
  });
  return new Map(grouped.map((row) => [row.photoId, row._sum.quantity ?? 0]));
}
