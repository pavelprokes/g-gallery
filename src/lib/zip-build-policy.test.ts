import { describe, expect, it } from "vitest";
import {
  chooseZipBuild,
  MAX_BUILD_ATTEMPTS,
  QUIET_PERIOD_MS,
  retryDelayMs,
  skipReasonFor,
  type ZipBuildCandidate,
} from "./zip-build-policy";

const NOW = new Date("2026-09-02T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const HOUR = 60 * 60 * 1000;

function candidate(over: Partial<ZipBuildCandidate> = {}): ZipBuildCandidate {
  return {
    id: "g1",
    zipStatus: "PENDING",
    zipAttempts: 0,
    updatedAt: ago(4 * HOUR),
    photosChangedAt: ago(4 * HOUR),
    newestPhotoAt: ago(4 * HOUR),
    photosMissingChecksum: 0,
    ...over,
  };
}

describe("skipReasonFor", () => {
  it("builds a settled PENDING gallery", () => {
    expect(skipReasonFor(candidate(), NOW)).toBeNull();
  });

  it("builds a gallery that has never been asked for one", () => {
    expect(skipReasonFor(candidate({ zipStatus: "NONE" }), NOW)).toBeNull();
  });

  it("leaves READY and BUILDING alone", () => {
    expect(skipReasonFor(candidate({ zipStatus: "READY" }), NOW)).toBe("not_pending");
    expect(skipReasonFor(candidate({ zipStatus: "BUILDING" }), NOW)).toBe("not_pending");
  });

  describe("the quiet period", () => {
    it("waits while photos are still arriving", () => {
      const busy = candidate({
        newestPhotoAt: ago(QUIET_PERIOD_MS - 1000),
        photosChangedAt: ago(QUIET_PERIOD_MS - 1000),
      });
      expect(skipReasonFor(busy, NOW)).toBe("quiet_period");
    });

    it("builds once the gallery has settled", () => {
      const settled = candidate({
        newestPhotoAt: ago(QUIET_PERIOD_MS + 1000),
        photosChangedAt: ago(QUIET_PERIOD_MS + 1000),
      });
      expect(skipReasonFor(settled, NOW)).toBeNull();
    });

    it("waits while the photographer is still culling, not just uploading", () => {
      // A delete is a change to the archive that can only move the newest
      // photo's timestamp *backwards*. Reading the clock off the photos alone
      // would make a gallery being culled look more and more settled with
      // every deletion — so `photosChangedAt` has to be what decides.
      const culling = candidate({
        newestPhotoAt: ago(6 * HOUR),
        photosChangedAt: ago(60_000),
      });
      expect(skipReasonFor(culling, NOW)).toBe("quiet_period");
    });

    it("counts a delete of the newest photo as a change, not as settling down", () => {
      // Deleting the last photo added drags `newestPhotoAt` back hours. The
      // two clocks are maxed, so neither can pull the answer backwards.
      const deletedNewest = candidate({
        newestPhotoAt: ago(30 * HOUR),
        photosChangedAt: ago(QUIET_PERIOD_MS - 1000),
      });
      expect(skipReasonFor(deletedNewest, NOW)).toBe("quiet_period");
    });

    it("falls back to the newest photo for rows written before the column existed", () => {
      const legacyBusy = candidate({
        photosChangedAt: null,
        newestPhotoAt: ago(QUIET_PERIOD_MS - 1000),
      });
      expect(skipReasonFor(legacyBusy, NOW)).toBe("quiet_period");

      const legacySettled = candidate({
        photosChangedAt: null,
        newestPhotoAt: ago(QUIET_PERIOD_MS + 1000),
      });
      expect(skipReasonFor(legacySettled, NOW)).toBeNull();
    });
  });

  it("skips a gallery whose photos have no checksum yet", () => {
    expect(skipReasonFor(candidate({ photosMissingChecksum: 1 }), NOW)).toBe("missing_checksum");
  });

  it("skips a gallery with no confirmed photos", () => {
    expect(skipReasonFor(candidate({ newestPhotoAt: null }), NOW)).toBe("no_photos");
  });

  describe("FAILED is retried, not abandoned", () => {
    // The production bug: nothing ever moved a gallery out of FAILED, so one
    // bad build meant "Připravujeme archiv" until somebody uploaded a photo.
    it("retries once the backoff has elapsed", () => {
      const failed = candidate({
        zipStatus: "FAILED",
        zipAttempts: 1,
        updatedAt: ago(retryDelayMs(1) + 1000),
      });
      expect(skipReasonFor(failed, NOW)).toBeNull();
    });

    it("holds off while the backoff is still running", () => {
      const failed = candidate({
        zipStatus: "FAILED",
        zipAttempts: 1,
        updatedAt: ago(retryDelayMs(1) - 1000),
      });
      expect(skipReasonFor(failed, NOW)).toBe("retry_backoff");
    });

    it("stops retrying after the attempt limit, rather than spinning forever", () => {
      const exhausted = candidate({
        zipStatus: "FAILED",
        zipAttempts: MAX_BUILD_ATTEMPTS,
        updatedAt: ago(30 * HOUR),
      });
      expect(skipReasonFor(exhausted, NOW)).toBe("attempts_exhausted");
    });
  });
});

describe("retryDelayMs", () => {
  it("backs off exponentially and then caps", () => {
    expect(retryDelayMs(1)).toBe(30 * 60 * 1000);
    expect(retryDelayMs(2)).toBe(60 * 60 * 1000);
    expect(retryDelayMs(3)).toBe(2 * HOUR);
    expect(retryDelayMs(4)).toBe(4 * HOUR);
    expect(retryDelayMs(5)).toBe(6 * HOUR);
    expect(retryDelayMs(50)).toBe(6 * HOUR);
  });

  it("treats a zeroth attempt as the base delay", () => {
    expect(retryDelayMs(0)).toBe(30 * 60 * 1000);
  });
});

describe("chooseZipBuild", () => {
  it("takes the gallery that has been waiting longest", () => {
    const choice = chooseZipBuild(
      [
        candidate({ id: "recent", updatedAt: ago(1 * HOUR) }),
        candidate({ id: "oldest", updatedAt: ago(9 * HOUR) }),
        candidate({ id: "middle", updatedAt: ago(3 * HOUR) }),
      ],
      NOW,
    );
    expect(choice.pick?.id).toBe("oldest");
  });

  it("does not let one unbuildable gallery block every other one", () => {
    // The exact production failure: the blocker sorts first on `updatedAt`, is
    // skipped, and the old `findFirst` would have returned it (and only it)
    // every single tick, forever.
    const choice = chooseZipBuild(
      [
        candidate({ id: "blocker", updatedAt: ago(20 * HOUR), photosMissingChecksum: 3 }),
        candidate({ id: "buildable", updatedAt: ago(2 * HOUR) }),
      ],
      NOW,
    );
    expect(choice.pick?.id).toBe("buildable");
    expect(choice.skipped).toEqual([{ id: "blocker", reason: "missing_checksum" }]);
  });

  it("reports why it did nothing when nothing is eligible", () => {
    const choice = chooseZipBuild(
      [
        candidate({ id: "busy", newestPhotoAt: ago(60_000), photosChangedAt: ago(60_000) }),
        candidate({ id: "dead", zipStatus: "FAILED", zipAttempts: MAX_BUILD_ATTEMPTS }),
      ],
      NOW,
    );
    expect(choice.pick).toBeNull();
    expect(choice.skipped).toEqual([
      { id: "busy", reason: "quiet_period" },
      { id: "dead", reason: "attempts_exhausted" },
    ]);
  });

  it("is deterministic when two galleries have waited equally long", () => {
    const at = ago(5 * HOUR);
    const first = chooseZipBuild(
      [candidate({ id: "b", updatedAt: at }), candidate({ id: "a", updatedAt: at })],
      NOW,
    );
    const second = chooseZipBuild(
      [candidate({ id: "a", updatedAt: at }), candidate({ id: "b", updatedAt: at })],
      NOW,
    );
    expect(first.pick?.id).toBe("a");
    expect(second.pick?.id).toBe("a");
  });

  describe("one build at a time", () => {
    // docs/TODO.md always claimed this; only the tick rate enforced it, and a
    // 15-minute tick is shorter than a 7.6 GB build. The builder's queue has
    // four slots for *all* builds, so a second one halves each build's share
    // while both race the same 60-minute abandon window.
    it("starts nothing while a build is already running", () => {
      const choice = chooseZipBuild([candidate({ id: "waiting" })], NOW, 1);
      expect(choice.pick).toBeNull();
      expect(choice.blocked).toBe("build_in_flight");
    });

    it("does not enumerate skip reasons it never got round to checking", () => {
      const choice = chooseZipBuild([candidate({ id: "a" }), candidate({ id: "b" })], NOW, 1);
      expect(choice.skipped).toEqual([]);
    });

    it("starts one as soon as the queue is clear", () => {
      const choice = chooseZipBuild([candidate({ id: "waiting" })], NOW, 0);
      expect(choice.pick?.id).toBe("waiting");
      expect(choice.blocked).toBeUndefined();
    });

    it("defaults to unblocked when the caller does not say", () => {
      expect(chooseZipBuild([candidate({ id: "waiting" })], NOW).pick?.id).toBe("waiting");
    });
  });

  it("returns nothing, and no reasons, for an empty queue", () => {
    expect(chooseZipBuild([], NOW)).toEqual({ pick: null, skipped: [] });
  });
});
