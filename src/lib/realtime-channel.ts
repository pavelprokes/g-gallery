/**
 * Channel naming for Supabase Realtime presence (docs/PLAN.md §8).
 *
 * The topic is derived from the share token by hashing, never by using the
 * token itself: Realtime topics are visible to anyone on the channel and end
 * up in client logs and network panels, so a raw topic would leak the very
 * secret the link's security rests on. Hashing gives the same trust model as
 * the link — knowing the topic proves nothing you did not already have.
 *
 * Truncated to 16 hex characters (64 bits). That is far too little to resist a
 * brute-force *search*, but the attacker gains nothing by finding a topic:
 * presence carries only a display name the viewer typed in themselves, and the
 * photos are not reachable through the channel.
 */

const TOPIC_LENGTH = 16;

/**
 * Derived from the gallery, not from the token that reached it.
 *
 * Hashing the token used to be the rule, and it split presence the moment one
 * gallery had two ways in — two share links, or a share link and a wedding-page
 * card (docs/GUEST-GALLERIES.md §4). Two audiences of the same gallery then
 * counted each other as absent. The gallery id is not a secret that grants
 * anything on its own, and it is still hashed, so the topic reveals nothing.
 *
 * Runs in the browser (Web Crypto) and on the server (node:crypto webcrypto).
 */
export async function channelForGallery(galleryId: string): Promise<string> {
  const bytes = new TextEncoder().encode(`gallery:${galleryId}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `g:${hex.slice(0, TOPIC_LENGTH)}`;
}

/** Presence payload. Deliberately minimal — no ids, no IPs, no user agent. */
export interface PresenceState {
  /** Only ever a name the viewer typed in themselves; null stays anonymous. */
  name: string | null;
  /** Distinguishes tabs of the same person so the count is of people. */
  viewerKey: string;
}

/**
 * Realtime is optional: without both public env vars the gallery works exactly
 * as before, just without the "viewing now" strip.
 */
export function realtimeConfig(): { url: string; anonKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

/**
 * Collapses a presence map into distinct people.
 *
 * Supabase keys presence by connection, so one person with the gallery open in
 * three tabs appears three times. Counting connections would tell the owner
 * "3 people are viewing" when one is.
 */
export function distinctViewers(states: Record<string, PresenceState[]>): {
  count: number;
  names: string[];
} {
  const byViewer = new Map<string, string | null>();

  for (const entries of Object.values(states)) {
    for (const entry of entries) {
      if (!entry?.viewerKey) continue;
      // A named tab wins over an anonymous one for the same person.
      const existing = byViewer.get(entry.viewerKey);
      if (existing == null) byViewer.set(entry.viewerKey, entry.name ?? null);
    }
  }

  const names = [...byViewer.values()].filter((name): name is string => Boolean(name));
  return { count: byViewer.size, names };
}
