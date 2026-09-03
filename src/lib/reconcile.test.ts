import { describe, expect, it } from "vitest";
import {
  classifyKey,
  exceedsBlastRadius,
  liveIndex,
  selectOrphans,
  selectPurgeCandidates,
  sweepIsNoteworthy,
  type SweepResult,
} from "./reconcile";
import type { StoredObject } from "./r2";

const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 21, 12, 0, 0);

const PREFIX = "galleries/528e9d02e905fedb1b96659594962800";
const UUID_A = "2956e1cf-4a03-4017-af00-6f81ddc28418";
const UUID_B = "7c1f0b4e-9d2a-4c11-8b3e-0a5d6f7e8c90";

function obj(key: string, ageHours: number, sizeBytes = 1024): StoredObject {
  return { key, sizeBytes, lastModified: new Date(NOW - ageHours * HOUR) };
}

describe("classifyKey", () => {
  it("reads an original back to its stem", () => {
    expect(classifyKey(`${PREFIX}/${UUID_A}.jpg`)).toEqual({
      kind: "original",
      owner: `${PREFIX}/${UUID_A}`,
    });
  });

  it("resolves a thumbnail to the original's stem, not to itself", () => {
    // The whole point: nothing here consults Photo.thumbObjectKey, so a
    // thumbnail cannot be orphaned by a column somebody forgot to add.
    expect(classifyKey(`${PREFIX}/${UUID_A}.thumb.webp`)).toEqual({
      kind: "thumbnail",
      owner: `${PREFIX}/${UUID_A}`,
    });
    expect(classifyKey(`${PREFIX}/${UUID_A}.thumb.jpg`).owner).toBe(`${PREFIX}/${UUID_A}`);
  });

  it("resolves an archive to the gallery prefix that owns it", () => {
    expect(classifyKey(`${PREFIX}/_archive.zip`)).toEqual({ kind: "archive", owner: PREFIX });
  });

  it("calls anything it does not recognise unknown, rather than guessing", () => {
    for (const key of [
      `${PREFIX}/notes.txt`,
      `${PREFIX}/IMG_1234.jpg`,
      `${PREFIX}/${UUID_A}`,
      `${PREFIX}/nested/${UUID_A}.jpg`,
      `backups/2026-09-01/${UUID_A}.jpg`,
    ]) {
      expect(classifyKey(key)).toEqual({ kind: "unknown", owner: null });
    }
  });
});

describe("liveIndex", () => {
  it("keys photos on the stem, so the thumbnail beside them resolves", () => {
    const live = liveIndex([{ objectKey: `${PREFIX}/${UUID_A}.jpg` }], []);
    expect(live.photoStems.has(`${PREFIX}/${UUID_A}`)).toBe(true);
  });

  it("ignores an unset key instead of adding an empty one", () => {
    const live = liveIndex([{ objectKey: null }], [{ storagePrefix: null }]);
    expect(live.photoStems.size).toBe(0);
    expect(live.galleryPrefixes.size).toBe(0);
  });
});

describe("selectOrphans", () => {
  const cutoff = NOW - 24 * HOUR;
  const live = liveIndex([{ objectKey: `${PREFIX}/${UUID_A}.jpg` }], [{ storagePrefix: PREFIX }]);
  const empty = liveIndex([], []);

  it("spares every object a live gallery owns — original, thumbnail, archive", () => {
    // The 2026-09-01 regression, as a test: the thumbnail and the archive were
    // deleted while the photo they belong to was perfectly alive.
    const { orphans } = selectOrphans(
      [
        obj(`${PREFIX}/${UUID_A}.jpg`, 500),
        obj(`${PREFIX}/${UUID_A}.thumb.webp`, 500),
        obj(`${PREFIX}/_archive.zip`, 500),
        obj(`${PREFIX}/_archive-0123456789abcdef0123456789abcdef.zip`, 500),
      ],
      live,
      cutoff,
    );
    expect(orphans).toEqual([]);
  });

  it("selects an old original whose row is gone", () => {
    const { orphans } = selectOrphans([obj(`${PREFIX}/${UUID_B}.jpg`, 48)], live, cutoff);
    expect(orphans.map((o) => o.key)).toEqual([`${PREFIX}/${UUID_B}.jpg`]);
  });

  it("selects a thumbnail once its own photo is gone", () => {
    const { orphans } = selectOrphans([obj(`${PREFIX}/${UUID_B}.thumb.webp`, 48)], live, cutoff);
    expect(orphans.map((o) => o.key)).toEqual([`${PREFIX}/${UUID_B}.thumb.webp`]);
  });

  it("resolves a per-build archive to the same owner", () => {
    // Since 2026-09-03 every build writes its own object, so a superseded build
    // finishing late cannot overwrite the archive the gallery is serving. The
    // sweep must recognise the new shape — an unrecognised key is `unknown`,
    // which is safe, but a *recognised* one is what keeps the live archive
    // spared and lets a dead gallery's archives be reclaimed.
    const key = `${PREFIX}/_archive-0123456789abcdef0123456789abcdef.zip`;
    expect(classifyKey(key)).toEqual({ kind: "archive", owner: PREFIX });
  });

  it("does not mistake a photo named like an archive for one", () => {
    expect(classifyKey(`${PREFIX}/_archive-nothex.zip`).kind).toBe("unknown");
    expect(classifyKey(`${PREFIX}/_archive-0123456789abcdef0123456789abcdef.jpg`).kind).toBe(
      "unknown",
    );
  });

  it("selects an archive once its gallery is gone", () => {
    const { orphans } = selectOrphans([obj(`${PREFIX}/_archive.zip`, 48)], empty, cutoff);
    expect(orphans.map((o) => o.key)).toEqual([`${PREFIX}/_archive.zip`]);
  });

  it("never selects an unrecognised key, however old, and counts it instead", () => {
    const { orphans, skippedUnknown } = selectOrphans(
      [obj(`${PREFIX}/whatever-this-is.bin`, 24 * 365)],
      empty,
      cutoff,
    );
    expect(orphans).toEqual([]);
    expect(skippedUnknown).toBe(1);
  });

  it("spares a recent object with no row — its row may still be in flight", () => {
    const { orphans, skippedTooRecent } = selectOrphans(
      [obj(`${PREFIX}/${UUID_B}.jpg`, 1)],
      empty,
      cutoff,
    );
    expect(orphans).toEqual([]);
    expect(skippedTooRecent).toBe(1);
  });

  it("keeps a live object even when it is far past the cutoff", () => {
    const { orphans } = selectOrphans([obj(`${PREFIX}/${UUID_A}.jpg`, 24 * 365)], live, cutoff);
    expect(orphans).toEqual([]);
  });

  it("separates orphans from live objects in a mixed bucket", () => {
    const { orphans, skippedTooRecent } = selectOrphans(
      [
        obj(`${PREFIX}/${UUID_A}.jpg`, 100),
        obj(`${PREFIX}/${UUID_B}.jpg`, 100, 4096),
        obj(`${PREFIX}/aa11bb22-cc33-4d44-8e55-ff6677889900.jpg`, 2),
      ],
      live,
      cutoff,
    );
    expect(orphans.map((o) => o.key)).toEqual([`${PREFIX}/${UUID_B}.jpg`]);
    expect(orphans[0]!.sizeBytes).toBe(4096);
    expect(skippedTooRecent).toBe(1);
  });

  it("treats an object exactly at the cutoff as old enough", () => {
    const { orphans } = selectOrphans([obj(`${PREFIX}/${UUID_B}.jpg`, 24)], empty, cutoff);
    expect(orphans).toHaveLength(1);
  });
});

describe("exceedsBlastRadius", () => {
  it("stops a run that would clear most of the bucket", () => {
    expect(exceedsBlastRadius(8_000, 8_100)).toBe(true);
  });

  it("lets ordinary debris through, which is what the job is for", () => {
    expect(exceedsBlastRadius(12, 8_000)).toBe(false);
  });

  it("lets a small bucket be cleaned even at a high ratio", () => {
    // Both bounds have to trip: 40 of 60 is most of the bucket, but 40 objects
    // is not a scale worth waking anyone for.
    expect(exceedsBlastRadius(40, 60)).toBe(false);
  });

  it("lets a big absolute number through when it is a small share", () => {
    expect(exceedsBlastRadius(500, 100_000)).toBe(false);
  });
});

describe("sweepIsNoteworthy", () => {
  const quiet: SweepResult = {
    objectsListed: 900,
    orphansFound: 0,
    orphansDeleted: 0,
    bytesReclaimed: 0,
    skippedTooRecent: 3,
    skippedUnknown: 0,
    refused: null,
    failures: [],
  };

  it("stays quiet on the boring run, so the loud one gets read", () => {
    expect(sweepIsNoteworthy(quiet)).toBe(false);
  });

  it("speaks up for a refusal, a deletion, a failure, or an unknown key", () => {
    expect(sweepIsNoteworthy({ ...quiet, refused: "too much" })).toBe(true);
    expect(sweepIsNoteworthy({ ...quiet, orphansDeleted: 1 })).toBe(true);
    expect(sweepIsNoteworthy({ ...quiet, failures: ["boom"] })).toBe(true);
    expect(sweepIsNoteworthy({ ...quiet, skippedUnknown: 1 })).toBe(true);
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
