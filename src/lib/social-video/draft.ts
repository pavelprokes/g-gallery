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
  order: z.array(idSchema).max(100),
});
export type SocialVideoDraft = z.infer<typeof socialVideoDraftSchema>;

/** The stored draft, or null when there is none or it no longer parses. */
export function parseSocialVideoDraft(value: unknown): SocialVideoDraft | null {
  const parsed = socialVideoDraftSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
