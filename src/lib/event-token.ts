/**
 * Composite viewer tokens: `"{eventToken}~{eventKey}"` addresses one gallery
 * *through* its wedding page (docs/GUEST-GALLERIES.md §4).
 *
 * It exists because raw share tokens are never stored — only their SHA-256
 * (invariant 5) — so the wedding page physically cannot rebuild a
 * `/g/{token}` URL for the galleries it lists. It addresses them with the one
 * secret it does hold, plus a per-wedding key.
 *
 * `~` is a safe separator: share tokens are `base64url`, whose alphabet is
 * `A-Z a-z 0-9 - _`, so the first `~` is always the boundary. It is also an
 * unreserved character in RFC 3986, so it needs no escaping in a path segment.
 *
 * Pure and dependency-free so both the server gate and the client can agree on
 * the format without importing a server-only module.
 */
export const EVENT_TOKEN_SEPARATOR = "~";

export interface CompositeToken {
  eventToken: string;
  eventKey: string;
}

/** Null when this is a plain share token rather than a composite one. */
export function splitEventToken(token: string): CompositeToken | null {
  const at = token.indexOf(EVENT_TOKEN_SEPARATOR);
  if (at < 0) return null;

  const eventToken = token.slice(0, at);
  const eventKey = token.slice(at + 1);
  // Both halves must be non-empty, and a second separator means the key is not
  // a key — refuse rather than guess.
  if (!eventToken || !eventKey) return null;
  if (eventKey.includes(EVENT_TOKEN_SEPARATOR)) return null;

  return { eventToken, eventKey };
}

export function compositeToken(eventToken: string, eventKey: string): string {
  return `${eventToken}${EVENT_TOKEN_SEPARATOR}${eventKey}`;
}
