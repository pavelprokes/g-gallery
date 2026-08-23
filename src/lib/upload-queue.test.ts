import { describe, expect, it } from "vitest";
import { isStale, QUEUE_MAX_AGE_MS } from "./upload-queue";

const NOW = 1_800_000_000_000;

describe("isStale", () => {
  it("keeps a fresh entry", () => {
    expect(isStale(NOW - 60_000, NOW)).toBe(false);
  });

  it("keeps an entry right up to the limit and drops it just past", () => {
    expect(isStale(NOW - QUEUE_MAX_AGE_MS, NOW)).toBe(false);
    expect(isStale(NOW - QUEUE_MAX_AGE_MS - 1, NOW)).toBe(true);
  });

  it("drops an entry stamped implausibly far in the future", () => {
    // A phone whose clock jumped forward and back would otherwise leave an
    // entry that never expires and re-uploads on every visit.
    expect(isStale(NOW + QUEUE_MAX_AGE_MS + 1, NOW)).toBe(true);
  });

  it("tolerates a small forward clock skew rather than discarding work", () => {
    expect(isStale(NOW + 30_000, NOW)).toBe(false);
  });
});
