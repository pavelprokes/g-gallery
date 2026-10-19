import { describe, expect, it } from "vitest";
import {
  countResumed,
  matchReplaceTargets,
  matchResumeTargets,
  shotKey,
  type PendingUpload,
} from "./upload-resume";

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

describe("shotKey", () => {
  it("drops the export's sequence, whatever it restarted from", () => {
    expect(shotKey("svatba_0412_PPR57923.jpg")).toBe("ppr57923");
    expect(shotKey("svatba_001_PPR57923.JPG")).toBe("ppr57923");
    expect(shotKey("kamila-a-petr-2026-09-05_0001_PPR57923.jpg")).toBe("ppr57923");
  });

  it("keeps a camera name that has an underscore of its own", () => {
    expect(shotKey("svatba_0001_DSC_1234.jpg")).toBe("dsc_1234");
  });

  it("is the whole name when there is no sequence", () => {
    expect(shotKey("IMG_4821.jpg")).toBe("img_4821");
    expect(shotKey("svatba_0001.jpg")).toBe("svatba_0001");
  });
});

describe("matchReplaceTargets", () => {
  const existing = [
    { id: "a", fileName: "svatba_0001_PPR1001.jpg" },
    { id: "b", fileName: "svatba_0002_PPR1002.jpg" },
  ];
  const file = (name: string) => ({ name, size: 1 });

  it("pairs a corrected export with the photo it replaces", () => {
    expect(
      matchReplaceTargets(
        [file("svatba_001_PPR1002.jpg"), file("svatba_002_PPR9999.jpg")],
        existing,
      ),
    ).toEqual(["b", undefined]);
  });

  it("refuses to guess between two photos or two files with one key", () => {
    const twoBodies = [...existing, { id: "c", fileName: "svatba_0003_PPR1001.jpg" }];
    expect(matchReplaceTargets([file("x_1_PPR1001.jpg")], twoBodies)).toEqual([undefined]);
    expect(
      matchReplaceTargets([file("x_1_PPR1002.jpg"), file("y_7_PPR1002.jpg")], existing),
    ).toEqual([undefined, undefined]);
  });

  it("leaves a file that resumes a pending row alone", () => {
    expect(matchReplaceTargets([file("x_1_PPR1001.jpg")], existing, ["p1"])).toEqual([undefined]);
  });
});
