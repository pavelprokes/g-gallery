import { z } from "zod";
import { idSchema } from "@/lib/id-schema";

/**
 * What the "Video pro sítě" studio is working on (docs/SOCIAL-VIDEO.md), kept
 * on the gallery: another device continues it, and the admin grid filters by
 * it (docs/ADMIN-FILTERS.md).
 */
export const socialVideoDraftSchema = z.object({
  aspect: z.enum(["9:16", "16:9"]),
  length: z.union([z.literal(15), z.literal(30)]),
  // Generous: the studio adds without a limit, and a refused save is a stale draft.
  order: z.array(idSchema).max(1000),
  /** When it was last changed (ms) — the newer of the gallery's and the browser's copy wins. */
  savedAt: z.number().int().nonnegative().optional(),
});
export type SocialVideoDraft = z.infer<typeof socialVideoDraftSchema>;

/** The stored draft, or null when there is none or it no longer parses. */
export function parseSocialVideoDraft(value: unknown): SocialVideoDraft | null {
  const parsed = socialVideoDraftSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
