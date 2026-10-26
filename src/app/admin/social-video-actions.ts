"use server";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth-guard";
import { idSchema } from "@/lib/id-schema";
import { socialVideoDraftSchema } from "@/lib/social-video/draft";
import { photoFacesSchema, storedFaces } from "@/lib/social-video/faces";

// Server Actions are publicly reachable POST endpoints — every one of them
// re-verifies the session internally (CLAUDE.md invariant #3), and every write
// is scoped by the gallery's `ownerId`. docs/SOCIAL-VIDEO.md is the authority.

/**
 * Keeps the studio's draft on the gallery, so another device continues it and
 * the admin grid can filter by it (docs/ADMIN-FILTERS.md).
 */
export async function saveSocialVideoDraft(galleryId: string, draft: unknown): Promise<void> {
  const session = await requireAdmin();
  const id = idSchema.parse(galleryId);
  const data = socialVideoDraftSchema.parse(draft);
  await prisma.gallery.updateMany({
    where: { id, ownerId: session.user.id },
    data: { socialVideoDraft: data },
  });
}

/** The most photos one call saves — a 30 s video holds about thirteen. */
const MAX_ENTRIES = 50;

const saveFacesInput = z.object({
  galleryId: idSchema,
  entries: z
    .array(z.object({ photoId: idSchema, faces: photoFacesSchema }))
    .min(1)
    .max(MAX_ENTRIES),
});

/**
 * Stores the faces the admin's browser found on a gallery's photos. Rows of
 * another gallery, or of a gallery that is not the caller's, are skipped, not
 * written. Returns how many were saved.
 */
export async function saveFaces(
  galleryId: string,
  entries: { photoId: string; faces: unknown }[],
): Promise<number> {
  const session = await requireAdmin();

  const input = saveFacesInput.safeParse({ galleryId, entries });
  if (!input.success) throw new Error("INVALID_INPUT");

  const owned = await prisma.photo.findMany({
    where: {
      id: { in: input.data.entries.map((e) => e.photoId) },
      galleryId: input.data.galleryId,
      gallery: { ownerId: session.user.id },
    },
    select: { id: true, faces: true },
  });
  const before = new Map(owned.map((p) => [p.id, storedFaces(p.faces)?.faces ?? null]));
  const writes = input.data.entries.filter((e) => before.has(e.photoId));
  await prisma.$transaction(
    writes.map((e) =>
      prisma.photo.update({
        where: { id: e.photoId },
        // New faces can raise new flags: a photo kept in the photo check is
        // put back on its list (docs/SOCIAL-VIDEO.md §4) — unless only the
        // sharp part was added and the faces are the same.
        data: {
          faces: e.faces,
          ...(JSON.stringify(before.get(e.photoId)) === JSON.stringify(e.faces.faces)
            ? {}
            : { checkKeptAt: null }),
        },
      }),
    ),
  );
  return writes.length;
}
