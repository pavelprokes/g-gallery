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
 * number to order, not a per-person breakdown. The gallery shows the same sum,
 * minus the guest's own, so whoever comes back to the selection (or opens it
 * on another device) sees what has already been picked.
 */
export async function printTotals(
  galleryId: string,
  /** Leave one viewer out — the guest's own marks are sent separately. */
  excludeViewerId?: string,
): Promise<Map<string, number>> {
  const grouped = await prisma.printSelection.groupBy({
    by: ["photoId"],
    where: {
      photo: { galleryId },
      ...(excludeViewerId ? { viewerId: { not: excludeViewerId } } : {}),
    },
    _sum: { quantity: true },
  });
  return new Map(grouped.map((row) => [row.photoId, row._sum.quantity ?? 0]));
}

/**
 * Who marked what, one row per viewer — the admin's answer to "the bride says
 * fifty, the total says twenty-eight": a hub link is marked by several
 * guests, and one person on two devices is two viewers.
 */
export async function printTotalsByViewer(
  galleryId: string,
): Promise<{ viewerId: string; displayName: string | null; photos: number; pieces: number }[]> {
  const grouped = await prisma.printSelection.groupBy({
    by: ["viewerId"],
    where: { photo: { galleryId, status: "CONFIRMED" } },
    _count: { _all: true },
    _sum: { quantity: true },
  });
  const viewers = await prisma.viewer.findMany({
    where: { id: { in: grouped.map((row) => row.viewerId) } },
    select: { id: true, displayName: true },
  });
  const names = new Map(viewers.map((viewer) => [viewer.id, viewer.displayName]));
  return grouped
    .map((row) => ({
      viewerId: row.viewerId,
      displayName: names.get(row.viewerId) ?? null,
      photos: row._count._all,
      pieces: row._sum.quantity ?? 0,
    }))
    .sort((a, b) => b.pieces - a.pieces);
}
