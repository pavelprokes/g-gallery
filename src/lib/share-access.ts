import "server-only";
import { hashShareToken } from "@/lib/share-token";
import { prisma } from "@/lib/db";

export type ShareAccessDenial =
  "NOT_FOUND" | "REVOKED" | "EXPIRED" | "PASSWORD_REQUIRED" | "PASSWORD_INVALID";

export type ShareAccess =
  { ok: true; shareLink: ResolvedShareLink } | { ok: false; reason: ShareAccessDenial };

export interface ResolvedShareLink {
  id: string;
  galleryId: string;
  allowDownload: boolean;
  allowReactions: boolean;
  hasPassword: boolean;
}

/**
 * Server-side enforcement of link validity. Must be called on EVERY surface
 * that a share token can reach: the gallery page, the view beacon, favorites,
 * and downloads (docs/PLAN.md §4).
 *
 * Password verification is deliberately NOT done here — the page flow unlocks
 * a link once and carries a signed cookie; this function reports whether a
 * password is required so callers can gate on it.
 */
export async function resolveShareLink(token: string): Promise<ShareAccess> {
  if (!token || token.length > 128) return { ok: false, reason: "NOT_FOUND" };

  const shareLink = await prisma.shareLink.findUnique({
    where: { tokenHash: hashShareToken(token) },
    select: {
      id: true,
      galleryId: true,
      allowDownload: true,
      allowReactions: true,
      passwordHash: true,
      expiresAt: true,
      revokedAt: true,
      gallery: { select: { status: true } },
    },
  });

  if (!shareLink || shareLink.gallery.status !== "PUBLISHED") {
    return { ok: false, reason: "NOT_FOUND" };
  }
  if (shareLink.revokedAt) return { ok: false, reason: "REVOKED" };
  if (shareLink.expiresAt && shareLink.expiresAt.getTime() < Date.now()) {
    return { ok: false, reason: "EXPIRED" };
  }

  return {
    ok: true,
    shareLink: {
      id: shareLink.id,
      galleryId: shareLink.galleryId,
      allowDownload: shareLink.allowDownload,
      allowReactions: shareLink.allowReactions,
      hasPassword: shareLink.passwordHash !== null,
    },
  };
}
