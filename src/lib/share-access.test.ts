import { describe, expect, it } from "vitest";
import {
  UNLOCK_ATTEMPT_LIMIT,
  UNLOCK_LOCKOUT_MS,
  isUnlockLocked,
  nextFailedUnlockState,
} from "./share-access";

// `verifySharePassword` itself talks to Prisma directly (no mocking setup for
// that exists in this repo yet), so these tests cover only the pure
// threshold/lockout arithmetic it delegates to — the part responsible for the
// per-ShareLink rate limit on the password unlock flow.
describe("share-access rate limiting", () => {
  describe("nextFailedUnlockState", () => {
    it("increments the attempt counter without locking below the threshold", () => {
      const result = nextFailedUnlockState(0, null, 1_000);
      expect(result.failedUnlockAttempts).toBe(1);
      expect(result.unlockLockedUntil).toBeNull();
    });

    it("keeps counting up to one below the threshold", () => {
      const result = nextFailedUnlockState(UNLOCK_ATTEMPT_LIMIT - 2, null, 1_000);
      expect(result.failedUnlockAttempts).toBe(UNLOCK_ATTEMPT_LIMIT - 1);
      expect(result.unlockLockedUntil).toBeNull();
    });

    it("locks out once the attempt count reaches the threshold", () => {
      const now = 1_000_000;
      const result = nextFailedUnlockState(UNLOCK_ATTEMPT_LIMIT - 1, null, now);
      expect(result.failedUnlockAttempts).toBe(UNLOCK_ATTEMPT_LIMIT);
      expect(result.unlockLockedUntil).toEqual(new Date(now + UNLOCK_LOCKOUT_MS));
    });

    it("keeps extending nothing further once already past the threshold", () => {
      const now = 5_000;
      const existingLock = new Date(now + UNLOCK_LOCKOUT_MS);
      const result = nextFailedUnlockState(UNLOCK_ATTEMPT_LIMIT, existingLock, now);
      expect(result.failedUnlockAttempts).toBe(UNLOCK_ATTEMPT_LIMIT + 1);
      // Once locked, a further wrong attempt (which verifySharePassword should
      // normally never reach, since isUnlockLocked short-circuits first) does
      // not push the lockout further out.
      expect(result.unlockLockedUntil).toEqual(existingLock);
    });
  });

  describe("isUnlockLocked", () => {
    it("is not locked when unlockLockedUntil is null", () => {
      expect(isUnlockLocked(null, 1_000)).toBe(false);
    });

    it("is locked while unlockLockedUntil is in the future", () => {
      expect(isUnlockLocked(new Date(2_000), 1_000)).toBe(true);
    });

    it("is not locked once unlockLockedUntil has passed", () => {
      expect(isUnlockLocked(new Date(1_000), 2_000)).toBe(false);
    });

    it("is not locked exactly at the boundary instant", () => {
      expect(isUnlockLocked(new Date(1_000), 1_000)).toBe(false);
    });
  });
});
