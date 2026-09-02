/**
 * Which gallery the background ZIP cron should build next, and which it should
 * leave alone (docs/TODO.md §7).
 *
 * Pure on purpose. The old version of this lived inline in a Prisma
 * `findFirst` with `orderBy: { updatedAt: "asc" }`, and two of its rules were
 * only true in the comment above it:
 *
 *  - A gallery with a photo missing `crc32`/`sizeBytes` returned early without
 *    writing anything. Its `updatedAt` therefore never moved, so the very next
 *    tick selected the same row again, and the one after that — **no other
 *    gallery in the system could ever be built**. The comment claimed the
 *    ordering prevented exactly this.
 *  - `FAILED` was terminal. Nothing moved a gallery out of it except a fresh
 *    photo upload, so a single failed build meant "Připravujeme archiv"
 *    forever.
 *
 * Both are now decisions taken over a list of candidates rather than by a
 * query that can only return one row, which is what makes them testable.
 */

export const ZIP_BUILD_CANDIDATE_LIMIT = 20;

/**
 * How long a gallery must go without a change to its photos before its archive
 * is worth building. Every confirmed upload **and every delete** invalidates
 * the archive, so building before a gallery has settled means hundreds of part
 * messages for an archive that is stale before it finishes — during a wedding
 * while guests are still uploading, and equally while the photographer is
 * culling a delivery down to the set they actually want to hand over.
 */
export const QUIET_PERIOD_MS = 20 * 60 * 1000;

/** A build that failed this many times is a bug to look at, not to retry. */
export const MAX_BUILD_ATTEMPTS = 5;

const RETRY_BASE_MS = 30 * 60 * 1000;
const RETRY_CAP_MS = 6 * 60 * 60 * 1000;

/** Exponential backoff after a failed build: 30m, 1h, 2h, 4h, then capped. */
export function retryDelayMs(attempts: number): number {
  const exponent = Math.max(0, attempts - 1);
  return Math.min(RETRY_BASE_MS * 2 ** exponent, RETRY_CAP_MS);
}

export type ZipStatusName = "NONE" | "PENDING" | "BUILDING" | "READY" | "FAILED";

export interface ZipBuildCandidate {
  id: string;
  zipStatus: ZipStatusName;
  /** Consecutive failed builds; reset to 0 whenever one succeeds. */
  zipAttempts: number;
  /** Last write to the gallery row — the clock the retry backoff runs on. */
  updatedAt: Date;
  /**
   * When the photo set last changed, including a delete. Null on rows that
   * predate the column, which is why {@link settledSince} falls back rather
   * than trusting it alone.
   */
  photosChangedAt: Date | null;
  /** Newest confirmed photo, or null when the gallery has none. */
  newestPhotoAt: Date | null;
  /** Confirmed photos with no `crc32` or no `sizeBytes`. */
  photosMissingChecksum: number;
}

export type SkipReason =
  | "no_photos"
  | "missing_checksum"
  | "quiet_period"
  | "retry_backoff"
  | "attempts_exhausted"
  | "not_pending";

export interface ZipBuildChoice {
  pick: ZipBuildCandidate | null;
  /** Every candidate that was passed over, and why — this is what the cron
   * reports, so "nothing happened" is never indistinguishable from "nothing
   * to do". */
  skipped: { id: string; reason: SkipReason }[];
}

/** Why this candidate cannot be built right now, or null if it can. */
export function skipReasonFor(candidate: ZipBuildCandidate, now: Date): SkipReason | null {
  if (candidate.zipStatus !== "NONE" && candidate.zipStatus !== "PENDING") {
    if (candidate.zipStatus !== "FAILED") return "not_pending";
    if (candidate.zipAttempts >= MAX_BUILD_ATTEMPTS) return "attempts_exhausted";
    if (now.getTime() - candidate.updatedAt.getTime() < retryDelayMs(candidate.zipAttempts)) {
      return "retry_backoff";
    }
  }

  if (candidate.newestPhotoAt === null) return "no_photos";

  // A photo with no checksum cannot go into the archive, and silently leaving
  // it out would hand the couple an archive quietly missing photos. Wait for
  // reconcile/re-upload to fill it in — but wait *without* blocking anyone
  // else, which is the whole point of returning a reason instead of a row.
  if (candidate.photosMissingChecksum > 0) return "missing_checksum";

  if (now.getTime() - settledSince(candidate) < QUIET_PERIOD_MS) return "quiet_period";

  return null;
}

/**
 * The most recent moment this gallery's contents are known to have changed.
 *
 * The newest photo's `createdAt` is not enough on its own: deleting photos
 * changes the archive and can only move that timestamp *backwards*, so a
 * gallery being culled would look more settled with every deletion — the exact
 * opposite of the truth. `photosChangedAt` is the real clock; the newest photo
 * is the fallback for rows written before that column existed, and the two are
 * maxed rather than preferred so neither can drag the answer backwards.
 */
function settledSince(candidate: ZipBuildCandidate): number {
  return Math.max(
    candidate.photosChangedAt?.getTime() ?? 0,
    candidate.newestPhotoAt?.getTime() ?? 0,
  );
}

/**
 * Picks the gallery that has been waiting longest among those that can
 * actually be built. Ties break on id so the choice is deterministic, which
 * matters for tests and for reasoning about a stuck queue.
 */
export function chooseZipBuild(
  candidates: readonly ZipBuildCandidate[],
  now: Date = new Date(),
): ZipBuildChoice {
  const skipped: { id: string; reason: SkipReason }[] = [];
  const eligible: ZipBuildCandidate[] = [];

  for (const candidate of candidates) {
    const reason = skipReasonFor(candidate, now);
    if (reason) skipped.push({ id: candidate.id, reason });
    else eligible.push(candidate);
  }

  eligible.sort(
    (a, b) =>
      a.updatedAt.getTime() - b.updatedAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  return { pick: eligible[0] ?? null, skipped };
}
