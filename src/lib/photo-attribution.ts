import type { PhotoSource } from "@/generated/prisma/enums";

/**
 * Who a guest photo is credited to, as every viewer of the gallery sees it
 * (docs/GUEST-GALLERIES.md §6).
 *
 * The guest volunteered this name on the promise that it "appears with the
 * photos you add", so it is shown to everyone who can open the gallery — and
 * nothing else about them is: never the `anonKey`, never the `Viewer` id.
 * The photographer's own photos carry no credit; the gallery is theirs.
 */
export const UPLOADER_SELECT = {
  source: true,
  uploadedBy: { select: { displayName: true, optedOut: true } },
} as const;

export function uploaderNameOf(photo: {
  source: PhotoSource;
  uploadedBy: { displayName: string | null; optedOut: boolean } | null;
}): string | null {
  if (photo.source !== "GUEST" || !photo.uploadedBy) return null;
  // Opting out means "keep no record of me" — a name set before that must not
  // keep appearing on their photos afterwards.
  if (photo.uploadedBy.optedOut) return null;
  const name = photo.uploadedBy.displayName?.trim();
  return name ? name : null;
}
