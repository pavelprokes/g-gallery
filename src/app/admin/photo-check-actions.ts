"use server";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth-guard";
import { idSchema } from "@/lib/id-schema";

// Server Actions are publicly reachable POST endpoints — every one of them
// re-verifies the session internally (CLAUDE.md invariant #3), and every write
// is scoped by the gallery's `ownerId`. docs/SOCIAL-VIDEO.md §4 ("The photo
// check") is the authority.

const keepInput = z.object({ photoId: idSchema, kept: z.boolean() });

/**
 * Records that the photographer looked at a flagged photo and kept it — or,
 * with `kept: false`, puts it back on the check's list.
 */
export async function keepCheckedPhoto(photoId: string, kept: boolean): Promise<void> {
  const session = await requireAdmin();

  const input = keepInput.safeParse({ photoId, kept });
  if (!input.success) throw new Error("INVALID_INPUT");

  const { count } = await prisma.photo.updateMany({
    where: { id: input.data.photoId, gallery: { ownerId: session.user.id } },
    data: { checkKeptAt: input.data.kept ? new Date() : null },
  });
  if (count === 0) throw new Error("NOT_FOUND");
}
