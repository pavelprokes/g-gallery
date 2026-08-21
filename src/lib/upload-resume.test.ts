import { describe, expect, it } from "vitest";
import { countResumed, matchResumeTargets, type PendingUpload } from "./upload-resume";

const pending: PendingUpload[] = [
  { id: "p1", fileName: "a.jpg", sizeBytes: 1000 },
  { id: "p2", fileName: "b.jpg", sizeBytes: 2000 },
];

describe("matchResumeTargets", () => {
  it("matches a re-picked file back onto its row", () => {
    expect(matchResumeTargets([{ name: "a.jpg", size: 1000 }], pending)).toEqual(["p1"]);
  });

  it("treats a same-name file of a different size as new", () => {
    // A re-export must not overwrite the object of the previous version.
    expect(matchResumeTargets([{ name: "a.jpg", size: 999 }], pending)).toEqual([undefined]);
  });

  it("leaves unrelated files unmatched", () => {
    expect(matchResumeTargets([{ name: "c.jpg", size: 3000 }], pending)).toEqual([undefined]);
  });

  it("claims each row at most once", () => {
    const files = [
      { name: "a.jpg", size: 1000 },
      { name: "a.jpg", size: 1000 },
    ];
    expect(matchResumeTargets(files, pending)).toEqual(["p1", undefined]);
  });

  it("consumes distinct rows for genuinely duplicated pending entries", () => {
    const dupes: PendingUpload[] = [
      { id: "p1", fileName: "a.jpg", sizeBytes: 1000 },
      { id: "p2", fileName: "a.jpg", sizeBytes: 1000 },
    ];
    const files = [
      { name: "a.jpg", size: 1000 },
      { name: "a.jpg", size: 1000 },
    ];
    expect(matchResumeTargets(files, dupes)).toEqual(["p1", "p2"]);
  });

  it("ignores rows with an unknown size rather than guessing", () => {
    const unsized: PendingUpload[] = [{ id: "p9", fileName: "a.jpg", sizeBytes: null }];
    expect(matchResumeTargets([{ name: "a.jpg", size: 1000 }], unsized)).toEqual([undefined]);
  });

  it("preserves order and mixes resumed with new files", () => {
    const files = [
      { name: "new.jpg", size: 50 },
      { name: "b.jpg", size: 2000 },
      { name: "a.jpg", size: 1000 },
    ];
    const matches = matchResumeTargets(files, pending);
    expect(matches).toEqual([undefined, "p2", "p1"]);
    expect(countResumed(matches)).toBe(2);
  });

  it("returns nothing to resume when there are no pending rows", () => {
    expect(matchResumeTargets([{ name: "a.jpg", size: 1 }], [])).toEqual([undefined]);
  });
});
