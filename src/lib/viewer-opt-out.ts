import "server-only";
import { prisma } from "@/lib/db";

/**
 * Undoes the name an upsert just wrote onto a viewer who turned out to be
 * opted out (docs/GUEST-GALLERIES.md §6).
 *
 * The heart, reaction and print routes upsert the `Viewer` row with the
 * volunteered name before they can see `optedOut` — a request still in flight
 * when "Nepočítat mě" commits, or one from a second device that took the
 * identity over by transfer code, would otherwise put back the very name the
 * opt-out removed. Conditional on `optedOut`, so it can never clear the name
 * of someone who is still opted in.
 */
export async function clearOptedOutName(galleryId: string, anonKey: string): Promise<void> {
  await prisma.viewer.updateMany({
    where: { galleryId, anonKey, optedOut: true },
    data: { displayName: null },
  });
}
