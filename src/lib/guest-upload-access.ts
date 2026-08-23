import "server-only";
import { prisma } from "@/lib/db";
import { resolveShareLink } from "@/lib/share-access";

/**
 * The server-side gate for everything a guest does on the upload path
 * (docs/GUEST-GALLERIES.md §6).
 *
 * Guest uploads reuse the owner's presigned-PUT pipeline unchanged — the only
 * difference is what authorises it. The share token is the sole authority, and
 * it is re-checked here on presign *and* on confirm, never once on the page and
 * then trusted. `resolveShareLink` already covers existence, publication state,
 * revocation, expiry and the password cookie; this adds the two things specific
 * to writing: the link must carry `allowUpload`, and the gallery must not be in
 * the trash.
 */
export type GuestUploadDenial =
  "NOT_FOUND" | "REVOKED" | "EXPIRED" | "PASSWORD_REQUIRED" | "UPLOAD_NOT_ALLOWED";

export interface GuestUploadContext {
  shareLinkId: string;
  galleryId: string;
  storagePrefix: string;
  /**
   * Null when the guest opted out of being identified (or has no storage): the
   * upload still goes through, it just carries no attribution. The per-viewer
   * quota then cannot apply to them and only the per-gallery cap does — the
   * same hole a guest gets by clearing site data, which `src/lib/guest-quota.ts`
   * documents rather than pretends away.
   */
  viewerId: string | null;
}

export type GuestUploadAccess =
  { ok: true; context: GuestUploadContext } | { ok: false; reason: GuestUploadDenial };

/** HTTP status for a denial — 404 for anything that must not confirm a link exists. */
export function denialStatus(reason: GuestUploadDenial): number {
  switch (reason) {
    case "PASSWORD_REQUIRED":
      return 401;
    case "UPLOAD_NOT_ALLOWED":
    case "REVOKED":
    case "EXPIRED":
      return 403;
    default:
      return 404;
  }
}

export async function resolveGuestUpload(
  token: string,
  anonKey: string | null,
): Promise<GuestUploadAccess> {
  const access = await resolveShareLink(token);
  if (!access.ok) return { ok: false, reason: access.reason };
  if (!access.shareLink.allowUpload) return { ok: false, reason: "UPLOAD_NOT_ALLOWED" };

  // `resolveShareLink` checks `gallery.status === "PUBLISHED"` but not the
  // trash: a trashed gallery is on its way to permanent deletion, so accepting
  // new bytes into its prefix would upload straight into the purge job's path.
  const gallery = await prisma.gallery.findFirst({
    where: { id: access.shareLink.galleryId, trashedAt: null },
    select: { id: true, storagePrefix: true },
  });
  if (!gallery) return { ok: false, reason: "NOT_FOUND" };

  return {
    ok: true,
    context: {
      shareLinkId: access.shareLink.id,
      galleryId: gallery.id,
      storagePrefix: gallery.storagePrefix,
      viewerId: anonKey ? await ensureViewerId(gallery.id, access.shareLink.id, anonKey) : null,
    },
  };
}

/**
 * The `Viewer` row a guest's uploads are attributed to — the same row their
 * favourites and reactions already use, keyed by the first-party `anonKey`.
 * Nothing else about the guest is stored (docs/PLAN.md §8: no IP, no UA).
 *
 * A viewer who opted out gets no attribution: opting out means "do not keep a
 * record of me", and an upload is not a reason to overrule that.
 */
async function ensureViewerId(
  galleryId: string,
  shareLinkId: string,
  anonKey: string,
): Promise<string | null> {
  const viewer = await prisma.viewer.upsert({
    where: { galleryId_anonKey: { galleryId, anonKey } },
    create: { galleryId, shareLinkId, anonKey },
    update: { lastSeenAt: new Date() },
    select: { id: true, optedOut: true },
  });
  return viewer.optedOut ? null : viewer.id;
}
