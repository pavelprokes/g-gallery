"use server";

import { requireAdmin } from "@/lib/auth-guard";
import { setCorrectionResolvedFor } from "@/lib/gallery-admin";
import { idSchema } from "@/lib/id-schema";

// The photographer's side of the corrections mode (docs/CORRECTIONS.md).
// Server Actions are public POST endpoints: the session is re-verified and
// every write is scoped by the gallery's owner (CLAUDE.md invariant #3).

/** Marks a correction done — or open again. A done one is read-only for the couple. */
export async function setCorrectionResolved(commentId: string, resolved: boolean): Promise<void> {
  const session = await requireAdmin();
  await setCorrectionResolvedFor(session.user.id, idSchema.parse(commentId), resolved);
}
