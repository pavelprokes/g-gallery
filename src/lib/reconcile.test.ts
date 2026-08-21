import { describe, expect, it } from "vitest";
import { selectOrphans, selectPurgeCandidates } from "./reconcile";
import type { StoredObject } from "./r2";

const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 21, 12, 0, 0);

function obj(key: string, ageHours: number, sizeBytes = 1024): StoredObject {
  return { key, sizeBytes, lastModified: new Date(NOW - ageHours * HOUR) };
}

describe("selectOrphans", () => {
  const cutoff = NOW - 24 * HOUR;

  it("never selects a key that a Photo row points at", () => {
    const live = new Set(["galleries/a/1.jpg", "galleries/a/2.jpg"]);
    const { orphans } = selectOrphans(
      [obj("galleries/a/1.jpg", 500), obj("galleries/a/2.jpg", 500)],
      live,
      cutoff,
    );
    expect(orphans).toEqual([]);
  });

  it("selects an old object with no row", () => {
    const { orphans } = selectOrphans([obj("galleries/a/ghost.jpg", 48)], new Set(), cutoff);
    expect(orphans.map((o) => o.key)).toEqual(["galleries/a/ghost.jpg"]);
  });

  it("spares a recent object with no row — its row may still be in flight", () => {
    const { orphans, skippedTooRecent } = selectOrphans(
      [obj("galleries/a/inflight.jpg", 1)],
      new Set(),
      cutoff,
    );
    expect(orphans).toEqual([]);
    expect(skippedTooRecent).toBe(1);
  });

  it("keeps an old live key even when it is far past the cutoff", () => {
    const { orphans } = selectOrphans(
      [obj("galleries/a/ancient.jpg", 24 * 365)],
      new Set(["galleries/a/ancient.jpg"]),
      cutoff,
    );
    expect(orphans).toEqual([]);
  });

  it("deletes nothing when the live key set is complete", () => {
    const keys = Array.from({ length: 50 }, (_, i) => `galleries/a/${i}.jpg`);
    const { orphans } = selectOrphans(
      keys.map((k) => obj(k, 100)),
      new Set(keys),
      cutoff,
    );
    expect(orphans).toEqual([]);
  });

  it("separates orphans from live keys in a mixed bucket", () => {
    const { orphans, skippedTooRecent } = selectOrphans(
      [
        obj("galleries/a/live.jpg", 100),
        obj("galleries/a/orphan.jpg", 100, 4096),
        obj("galleries/a/fresh-orphan.jpg", 2),
      ],
      new Set(["galleries/a/live.jpg"]),
      cutoff,
    );
    expect(orphans.map((o) => o.key)).toEqual(["galleries/a/orphan.jpg"]);
    expect(orphans[0]!.sizeBytes).toBe(4096);
    expect(skippedTooRecent).toBe(1);
  });

  it("treats an object exactly at the cutoff as old enough", () => {
    const { orphans } = selectOrphans([obj("galleries/a/edge.jpg", 24)], new Set(), cutoff);
    expect(orphans).toHaveLength(1);
  });
});

describe("selectPurgeCandidates", () => {
  const NOW_DATE = new Date(NOW);
  const DAY = 24 * HOUR;

  function gallery(over: { id?: string; ownerId?: string; title?: string; purgeAt: Date | null }) {
    return { id: "g1", ownerId: "owner1", title: "Svatba", ...over };
  }

  it("selects a gallery whose purgeAt has passed", () => {
    const past = gallery({ purgeAt: new Date(NOW - DAY) });
    const candidates = selectPurgeCandidates([past], NOW_DATE);
    expect(candidates).toEqual([{ id: "g1", ownerId: "owner1", title: "Svatba" }]);
  });

  it("treats purgeAt exactly now as due", () => {
    const due = gallery({ purgeAt: NOW_DATE });
    expect(selectPurgeCandidates([due], NOW_DATE)).toHaveLength(1);
  });

  it("spares a gallery whose purgeAt is still in the future", () => {
    const future = gallery({ purgeAt: new Date(NOW + DAY) });
    expect(selectPurgeCandidates([future], NOW_DATE)).toEqual([]);
  });

  it("ignores a gallery that was never trashed", () => {
    const live = gallery({ purgeAt: null });
    expect(selectPurgeCandidates([live], NOW_DATE)).toEqual([]);
  });

  it("separates due and not-yet-due galleries in a mixed set", () => {
    const candidates = selectPurgeCandidates(
      [
        gallery({ id: "due", purgeAt: new Date(NOW - DAY) }),
        gallery({ id: "not-due", purgeAt: new Date(NOW + DAY) }),
        gallery({ id: "not-trashed", purgeAt: null }),
      ],
      NOW_DATE,
    );
    expect(candidates.map((c) => c.id)).toEqual(["due"]);
  });
});
