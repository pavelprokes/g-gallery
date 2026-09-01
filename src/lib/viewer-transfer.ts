/**
 * Moving one viewer's marks to another device (docs/PLAN.md §8a).
 *
 * Favourites, reactions and print marks all hang off `Viewer`, keyed by an
 * `anonKey` that lives in one browser's localStorage — so they are trapped
 * there. The bride goes through 700 photos on her phone across three evenings,
 * then they sit down at the laptop together to finish, and the laptop shows
 * nothing. Her mother, who wants six prints, is on a third device. Until this
 * existed, `PrintSelection` was a demo rather than a workflow.
 *
 * Pure functions only — no database, no `server-only` — so the code format and
 * the hashing rule can be unit-tested and shared with the client that renders
 * the code.
 */

/**
 * Crockford base32 minus the letters that get misread off a phone screen:
 * no I/L (vs 1), no O (vs 0), no U (vs V). What is left is 32 symbols that
 * survive being read aloud across a kitchen table, which is the actual
 * transport here.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Characters of entropy in a transfer code. */
const CODE_LENGTH = 8;

/**
 * 32^8 ≈ 1.1e12. The earlier sketch was six digits, which is 1e6 — small
 * enough that a script could walk the whole space inside the code's lifetime,
 * and defending that would have meant a per-gallery attempt counter and a
 * lockout, i.e. more moving parts than the feature itself. Two extra
 * characters remove the problem instead of managing it: at this size the
 * expiry below is a tidiness measure, not the security boundary.
 */
export const TRANSFER_CODE_LENGTH = CODE_LENGTH;

/** Long enough to walk to the laptop, short enough to be worthless if seen. */
export const TRANSFER_CODE_TTL_MS = 15 * 60 * 1000;

/**
 * Formats a code for display as two groups of four ("K7P2-M9XQ"). Purely
 * cosmetic — `normalizeTransferCode` accepts it with or without the dash.
 */
export function formatTransferCode(code: string): string {
  return code.length === CODE_LENGTH ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

/**
 * What the server compares against: upper-cased, dashes and spaces removed,
 * and the three confusable pairs folded to the symbol actually in the alphabet.
 *
 * Somebody reading a code aloud will say "oh" for zero and the person typing
 * will write the letter, every time. Rejecting that would be blaming the
 * viewer for a choice we made about the alphabet.
 *
 * Returns null when the result is not a well-formed code, so a caller never has
 * to decide what a partially-valid one means.
 */
export function normalizeTransferCode(input: string): string | null {
  const cleaned = input
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1")
    .replace(/U/g, "V");

  if (cleaned.length !== CODE_LENGTH) return null;
  for (const char of cleaned) if (!ALPHABET.includes(char)) return null;
  return cleaned;
}

/**
 * The material that gets hashed.
 *
 * Salted with the gallery id so a precomputed table has to be built per
 * gallery, and so a code minted in one gallery can never resolve in another —
 * the marks it carries are meaningless outside the gallery they were made in.
 */
export function transferCodeMaterial(galleryId: string, code: string): string {
  return `${galleryId}:${code}`;
}

/**
 * Draws a code from a caller-supplied random source.
 *
 * Rejection sampling rather than `% 32`: 256 is a whole multiple of 32 so a
 * modulo would in fact be unbiased here, but that is a property of this
 * particular alphabet length, and the next person to change `ALPHABET` would
 * silently introduce modulo bias. The loop cannot notice.
 */
export function generateTransferCode(randomBytes: (n: number) => Uint8Array): string {
  let out = "";
  while (out.length < CODE_LENGTH) {
    const chunk = randomBytes(CODE_LENGTH);
    for (const byte of chunk) {
      if (byte >= 256 - (256 % ALPHABET.length)) continue;
      out += ALPHABET[byte % ALPHABET.length];
      if (out.length === CODE_LENGTH) break;
    }
  }
  return out;
}
