/**
 * Keys for a gallery ordered by hand (docs/PHOTO-ORDER.md §Manual order).
 *
 * A photo's place is a string over [0-9a-z] — the same alphabet as
 * `fileOrderKey`, for the same reason: the grid compares keys as plain
 * JavaScript strings against an order Postgres produced, and for this alphabet
 * every collation agrees with that comparison. Moving a photo writes one row:
 * the new key falls between its new neighbours' keys, so nothing else moves.
 */

const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";
const BASE = DIGITS.length;

const digit = (key: string, i: number) => DIGITS.indexOf(key[i]!);

/**
 * The shortest key strictly between `before` and `after` (null for no
 * neighbour on that side), never ending in "0" — so there is always room for
 * another key before it. Null when there is no room: equal keys (two photos
 * that were never placed by hand can share one), or `after` being `before`
 * followed only by zeros. The caller then renumbers the gallery.
 */
export function keyBetween(before: string | null, after: string | null): string | null {
  const a = before ?? "";
  if (after !== null && a >= after) return null;
  let prefix = "";
  for (let i = 0; ; i++) {
    const lo = i < a.length ? digit(a, i) : -1;
    const hi = after === null ? BASE : i < after.length ? digit(after, i) : -1;
    if (hi === -1) return null; // `after` ran out first: it is a prefix of `before`.
    if (lo === hi) {
      prefix += DIGITS[lo];
      continue;
    }
    if (lo === -1) {
      // `before` has ended: any digit from 1 to just under `after`'s fits.
      if (hi >= 2) return prefix + DIGITS[Math.ceil(hi / 2)];
      // `after` has "1" here: "0" and anything after it fits below it.
      if (hi === 1) return prefix + "0" + DIGITS[BASE / 2];
      // `after` has "0" here: so must the key, and the room is further on.
      prefix += "0";
      continue;
    }
    if (hi - lo >= 2) return prefix + DIGITS[Math.floor((lo + hi) / 2)];
    // Neighbouring digits: keep `before`'s and go past the rest of it.
    return prefix + DIGITS[lo] + (keyBetween(a.slice(i + 1), null) ?? "");
  }
}

/**
 * `count` keys spread evenly, all the same length — what a gallery gets when
 * it is first switched to manual order, so that later moves have room on
 * every side of every photo.
 */
export function spreadKeys(count: number): string[] {
  if (count <= 0) return [];
  // Enough digits for ~36 free keys between neighbours before any grows.
  const width = Math.max(2, Math.ceil(Math.log(count + 1) / Math.log(BASE)) + 1);
  // Below "z": a photo uploaded later waits at the end on its provisional key,
  // "z" + its file-name key (PROVISIONAL_PREFIX), after every placed photo.
  const span = (BASE - 1) * BASE ** (width - 1);
  const step = span / (count + 1);
  return Array.from({ length: count }, (_, i) => {
    const value = Math.round((i + 1) * step);
    return value.toString(BASE).padStart(width, "0").replace(/0+$/, "");
  });
}

/**
 * What a photo's key is until it is placed by hand: this, then its file-name
 * key — written by a database trigger on insert, so new uploads line up at the
 * end in file-name order. Placed keys stay below it (`placeBetween`).
 */
export const PROVISIONAL_PREFIX = "z";

/**
 * The key for a photo dropped after `before` and before `after`. At the end
 * of the placed photos it stays below the provisional keys, so a photo
 * uploaded later still comes after it.
 */
export function placeBetween(before: string | null, after: string | null): string | null {
  const ceiling =
    after ?? (before === null || before < PROVISIONAL_PREFIX ? PROVISIONAL_PREFIX : null);
  return keyBetween(before, ceiling);
}

/** A well-formed manual key — what a cursor coming back from a client must carry. */
export function isManualKey(key: string): boolean {
  return /^[0-9a-z]+$/.test(key) && key.length <= 4096;
}
