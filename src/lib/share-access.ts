import "server-only";
import { hashShareToken } from "@/lib/share-token";
import { isUnlocked } from "@/lib/share-unlock";
import { prisma } from "@/lib/db";

export type ShareAccessDenial = "NOT_FOUND" | "REVOKED" | "EXPIRED" | "PASSWORD_REQUIRED";

export type ShareAccess =
  { ok: true; shareLink: ResolvedShareLink } | { ok: false; reason: ShareAccessDenial };

export interface ResolvedShareLink {
  id: string;
  galleryId: string;
  allowDownload: boolean;
  allowReactions: boolean;
  hasPassword: boolean;
}

interface ShareLinkRecord {
  id: string;
  galleryId: string;
  allowDownload: boolean;
  allowReactions: boolean;
  passwordHash: string | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  gallery: { status: string };
}

async function findShareLink(token: string): Promise<ShareLinkRecord | null> {
  if (!token || token.length > 128) return null;

  return prisma.shareLink.findUnique({
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
}

function checkValidity(link: ShareLinkRecord | null): ShareAccessDenial | null {
  if (!link || link.gallery.status !== "PUBLISHED") return "NOT_FOUND";
  if (link.revokedAt) return "REVOKED";
  if (link.expiresAt && link.expiresAt.getTime() < Date.now()) return "EXPIRED";
  return null;
}

function toResolved(link: ShareLinkRecord): ResolvedShareLink {
  return {
    id: link.id,
    galleryId: link.galleryId,
    allowDownload: link.allowDownload,
    allowReactions: link.allowReactions,
    hasPassword: link.passwordHash !== null,
  };
}

/**
 * Full server-side gate for a share token: existence, publication state,
 * revocation, expiry, AND the password unlock cookie.
 *
 * Must be called on EVERY surface a share token can reach — the gallery page,
 * the activity beacon, favorites, and downloads (docs/PLAN.md §4). Anything
 * that skips it is an unauthenticated hole into a private gallery.
 */
export async function resolveShareLink(token: string): Promise<ShareAccess> {
  const link = await findShareLink(token);

  const denial = checkValidity(link);
  if (denial || !link) return { ok: false, reason: denial ?? "NOT_FOUND" };

  if (link.passwordHash && !(await isUnlocked(link.id, link.passwordHash))) {
    return { ok: false, reason: "PASSWORD_REQUIRED" };
  }

  return { ok: true, shareLink: toResolved(link) };
}

/**
 * Password verification for the unlock form. Kept separate from
 * `resolveShareLink` so the gate itself never takes a password argument and
 * can't be accidentally bypassed by passing one.
 */
export async function verifySharePassword(
  token: string,
  password: string,
): Promise<{ ok: true; shareLinkId: string; passwordHash: string } | { ok: false }> {
  const link = await findShareLink(token);
  if (checkValidity(link) || !link?.passwordHash) return { ok: false };

  const { verifyPassword } = await import("@/lib/share-token");
  if (!(await verifyPassword(password, link.passwordHash))) return { ok: false };

  return { ok: true, shareLinkId: link.id, passwordHash: link.passwordHash };
}
