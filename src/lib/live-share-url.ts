/**
 * The link a guest can open right now: the newest share link that is neither
 * revoked nor expired, on a published gallery (a draft resolves to not-found
 * for everyone). Null when there is none, or its token cannot be shown.
 */
export function newestLiveShareUrl(
  links: { url: string | null; revokedAt: Date | null; expiresAt: Date | null }[],
  published: boolean,
  now: Date,
): string | null {
  if (!published) return null;
  return (
    links.find((link) => link.url && !link.revokedAt && (!link.expiresAt || link.expiresAt > now))
      ?.url ?? null
  );
}
