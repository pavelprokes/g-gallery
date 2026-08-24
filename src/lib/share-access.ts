import "server-only";
import { hashShareToken } from "@/lib/share-token";
import { splitEventToken } from "@/lib/event-token";
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
  /** Guests holding this link may add photos (docs/GUEST-GALLERIES.md §6). */
  allowUpload: boolean;
  allowPrintSelection: boolean;
  hasPassword: boolean;
}

interface ShareLinkRecord {
  id: string;
  galleryId: string;
  allowDownload: boolean;
  allowReactions: boolean;
  allowUpload: boolean;
  allowPrintSelection: boolean;
  passwordHash: string | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  failedUnlockAttempts: number;
  unlockLockedUntil: Date | null;
  gallery: { status: string };
}

// After this many consecutive wrong-password attempts, the link is locked out.
export const UNLOCK_ATTEMPT_LIMIT = 5;
// Length of the lockout once the limit is hit.
export const UNLOCK_LOCKOUT_MS = 15 * 60 * 1000;

/**
 * Pure computation of the next failed-attempt state after a wrong password,
 * split out from `verifySharePassword` so the threshold/lockout arithmetic is
 * unit-testable without a database. `now` is injected for testability.
 */
export function nextFailedUnlockState(
  currentAttempts: number,
  currentLockedUntil: Date | null,
  now: number = Date.now(),
): { failedUnlockAttempts: number; unlockLockedUntil: Date | null } {
  const attempts = currentAttempts + 1;
  return {
    failedUnlockAttempts: attempts,
    unlockLockedUntil:
      attempts >= UNLOCK_ATTEMPT_LIMIT ? new Date(now + UNLOCK_LOCKOUT_MS) : currentLockedUntil,
  };
}

/** Pure check: is the link currently within an active lockout window? */
export function isUnlockLocked(unlockLockedUntil: Date | null, now: number = Date.now()): boolean {
  return unlockLockedUntil !== null && unlockLockedUntil.getTime() > now;
}

const LINK_FIELDS = {
  id: true,
  galleryId: true,
  allowDownload: true,
  allowReactions: true,
  allowUpload: true,
  allowPrintSelection: true,
  passwordHash: true,
  expiresAt: true,
  revokedAt: true,
  failedUnlockAttempts: true,
  unlockLockedUntil: true,
  gallery: { select: { status: true } },
} as const;

/**
 * Resolves a viewer token to the share link that governs access.
 *
 * Two token shapes reach this, and both end at a `ShareLink` row so that
 * expiry, revocation, the password gate and the per-link permission flags have
 * exactly one implementation:
 *
 * 1. A plain share token — one gallery, the link the owner handed out.
 * 2. `"{eventToken}~{eventKey}"` — a gallery reached *through* its wedding page
 *    (docs/GUEST-GALLERIES.md §4). The composite exists because raw share
 *    tokens are never stored (invariant 5), so the wedding page cannot rebuild
 *    a `/g/{token}` URL for its own cards; it addresses galleries by the event
 *    token it already holds plus a per-wedding key. Permissions still come from
 *    the `ShareLink` the owner designated for that card (`Gallery.eventLink`),
 *    so a card can never grant more than the gallery's own link does.
 *
 * `~` is safe as a separator: share tokens are base64url, which cannot contain
 * it.
 */
async function findShareLink(token: string): Promise<ShareLinkRecord | null> {
  if (!token || token.length > 256) return null;

  const composite = splitEventToken(token);
  if (!composite) {
    return prisma.shareLink.findUnique({
      where: { tokenHash: hashShareToken(token) },
      select: LINK_FIELDS,
    });
  }

  const gallery = await prisma.gallery.findFirst({
    where: {
      eventKey: composite.eventKey,
      // Un-listing a gallery closes this door and nothing else: its own share
      // link keeps working for whoever was given it directly.
      listedOnEvent: true,
      trashedAt: null,
      event: { tokenHash: hashShareToken(composite.eventToken), trashedAt: null },
    },
    select: { id: true, eventLink: { select: LINK_FIELDS } },
  });

  const link = gallery?.eventLink ?? null;
  // A card with no designated link is not reachable — and a designated link
  // belonging to a different gallery would be a mis-set pointer granting
  // access to the wrong photos, so it is refused rather than followed.
  if (!link || link.galleryId !== gallery?.id) return null;

  return link;
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
    allowUpload: link.allowUpload,
    allowPrintSelection: link.allowPrintSelection,
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
 *
 * Rate-limited per ShareLink (not per visitor — no viewer identifier is ever
 * involved, per CLAUDE.md's "never store viewer IPs" invariant): after
 * `UNLOCK_ATTEMPT_LIMIT` consecutive wrong passwords, the link is locked out
 * for `UNLOCK_LOCKOUT_MS` and further attempts are rejected *before* touching
 * `verifyPassword` — that's what actually kills the scrypt CPU-amplification
 * angle, not just the UX throttle.
 */
export async function verifySharePassword(
  token: string,
  password: string,
): Promise<{ ok: true; shareLinkId: string; passwordHash: string } | { ok: false }> {
  const link = await findShareLink(token);
  if (checkValidity(link) || !link?.passwordHash) return { ok: false };

  if (isUnlockLocked(link.unlockLockedUntil)) return { ok: false };

  const { verifyPassword } = await import("@/lib/share-token");
  if (!(await verifyPassword(password, link.passwordHash))) {
    await prisma.shareLink.update({
      where: { id: link.id },
      data: nextFailedUnlockState(link.failedUnlockAttempts, link.unlockLockedUntil),
    });
    return { ok: false };
  }

  await prisma.shareLink.update({
    where: { id: link.id },
    data: { failedUnlockAttempts: 0, unlockLockedUntil: null },
  });

  return { ok: true, shareLinkId: link.id, passwordHash: link.passwordHash };
}
