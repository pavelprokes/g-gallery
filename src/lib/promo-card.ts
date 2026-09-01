/**
 * The photographer's own credit tile, rendered inside the photo grid as if it
 * were one landscape photo.
 *
 * Shared by the server (which loads placements) and the client grid (which
 * lays them out), so this module must stay free of both `server-only` and any
 * React import.
 *
 * The whole design rests on one rule: **a promo is never a photo**. It is
 * inserted into the *layout* stream only. The `photos` array that drives the
 * lightbox, keyboard navigation, selection, favourites, print marks and the
 * ZIP manifest never sees it, which is why none of those needed a special
 * case — see `src/lib/gallery-grid.ts`.
 */

/**
 * A promo tile is laid out as a landscape photo, so a row containing one packs
 * exactly as it would have with a photo in that place — no bespoke row height,
 * no gap in the rhythm. 3:2 is the same ratio `FALLBACK_ASPECT` uses in
 * `src/components/gallery-view.tsx` and what comes out of every full-frame and
 * APS-C body held sideways.
 */
export const PROMO_ASPECT = 1.5;

/** Slots are 1-based: `slot = 5` means "be the 5th tile in the grid". */
export const MIN_PROMO_SLOT = 1;

/**
 * Past this the card is deep enough into an 800-photo wedding that nobody
 * reaches it, and the number is more likely a typo than an intent. Not a
 * correctness bound — `promoInsertIndex` clamps to the gallery's real length
 * anyway — just the range the admin will accept.
 */
export const MAX_PROMO_SLOT = 500;

export type PromoTheme = "LIGHT" | "DARK" | "BRAND";

export const PROMO_THEMES: readonly PromoTheme[] = ["LIGHT", "DARK", "BRAND"];

export function isPromoTheme(value: unknown): value is PromoTheme {
  return typeof value === "string" && (PROMO_THEMES as readonly string[]).includes(value);
}

/** Exactly what the client grid needs — no owner id, no admin-only `name`. */
export interface GalleryPromo {
  /** The placement id, not the card id: two galleries showing the same card
   * are two different tiles with two different slots. */
  id: string;
  slot: number;
  eyebrow: string | null;
  headline: string;
  body: string | null;
  ctaLabel: string | null;
  ctaUrl: string;
  theme: PromoTheme;
}

/**
 * Where a 1-based slot lands in a 0-based photo stream.
 *
 * Clamped to `photoCount` rather than dropped: a card placed at slot 5 in a
 * gallery that currently holds two photos still belongs in the grid — at the
 * end — because the gallery is very often still being uploaded when the card
 * is placed, and a tile that silently vanishes below a threshold is the kind
 * of thing nobody notices until a client asks where the credit went.
 */
export function promoInsertIndex(slot: number, photoCount: number): number {
  return Math.min(Math.max(Math.trunc(slot), MIN_PROMO_SLOT) - 1, photoCount);
}

/**
 * Only absolute `http(s)` URLs are accepted.
 *
 * This is a stored string rendered as an `href` into pages held by people who
 * are not its author, so `javascript:` and `data:` must never survive a round
 * trip — even though today's only author is the single admin. Validated on
 * write (the server action) *and* checked again on read, because a row that
 * predates a validation rule is a thing that happens.
 */
export function isSafePromoUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === "https:" || url.protocol === "http:";
}

/**
 * The link's own label when the owner left `ctaLabel` empty — the bare host,
 * which is what a person would have typed anyway ("svatebni-fotograf-cechy.cz").
 * `www.` is dropped: it is noise on a card this small.
 */
export function promoCtaFallback(ctaUrl: string): string {
  try {
    return new URL(ctaUrl).host.replace(/^www\./, "");
  } catch {
    return ctaUrl;
  }
}
