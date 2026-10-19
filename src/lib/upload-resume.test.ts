import { describe, expect, it } from "vitest";
import {
  countResumed,
  matchResumeTargets,
  replaceCandidates,
  shotKey,
  slotter,
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
    expect(shotKey("svatba_0412_PPR57923.jpg")).toBe("ppr57923.jpg");
    expect(shotKey("svatba_001_PPR57923.JPEG")).toBe("ppr57923.jpg");
    expect(shotKey("kamila-a-petr-2026-09-05_0001_PPR57923.jpg")).toBe("ppr57923.jpg");
  });

  it("keeps a camera name with an underscore, and sees through a Photoshop edit", () => {
    expect(shotKey("svatba_0001_DSC_1234.jpg")).toBe("dsc_1234.jpg");
    expect(shotKey("svatba_001_PPR57923-Edit.jpg")).toBe("ppr57923.jpg");
    expect(shotKey("PPR57923-Edit-2.jpg")).toBe("ppr57923.jpg");
  });

  it("takes a bare camera name from a picked file, never from a delivered one", () => {
    expect(shotKey("PPR55013.jpg")).toBe("ppr55013.jpg");
    expect(shotKey("PPR55013.jpg", { bare: false })).toBeNull();
    // A delivery named by sequence alone has no shot to pair with.
    expect(shotKey("svatba_0001.jpg", { bare: false })).toBeNull();
  });

  it("never keys on a bare number", () => {
    expect(shotKey("2026-09-05_0412.jpg")).toBeNull();
    expect(shotKey("IMG_4821-2.jpg")).toBeNull();
  });

  it("keeps the extension apart", () => {
    expect(shotKey("svatba_1_PPR1.png")).not.toBe(shotKey("svatba_1_PPR1.jpg"));
  });
});

describe("replaceCandidates", () => {
  const existing = [
    { id: "a", fileName: "svatba_0001_PPR1001.jpg" },
    { id: "b", fileName: "svatba_0002_PPR1002.jpg" },
  ];
  const file = (name: string) => ({ name, size: 1 });

  it("pairs a corrected export, bare or re-numbered, with its photo", () => {
    expect(
      replaceCandidates([file("PPR1001.jpg"), file("svatba_001_PPR1002.jpg")], existing),
    ).toEqual([["a"], ["b"]]);
    expect(replaceCandidates([file("svatba_002_PPR9999.jpg")], existing)).toEqual([[]]);
  });

  it("offers every virtual copy of a shot to choose from", () => {
    const copies = [
      { id: "colour", fileName: "svatba_0215_PPR55013.jpg" },
      { id: "bw", fileName: "svatba_0216_PPR55013.jpg" },
    ];
    expect(replaceCandidates([file("PPR55013.jpg")], copies)).toEqual([["colour", "bw"]]);
  });

  it("does not pair a second batch numbered by sequence alone", () => {
    const bySequence = [{ id: "s", fileName: "svatba_0001.jpg" }];
    expect(replaceCandidates([file("svatba_0001.jpg")], bySequence)).toEqual([[]]);
  });

  it("pairs nothing for two picked files with one key, or a resumed file", () => {
    expect(
      replaceCandidates([file("x_1_PPR1002.jpg"), file("PPR1002-Edit.jpg")], existing),
    ).toEqual([[], []]);
    expect(replaceCandidates([file("PPR1001.jpg")], existing, ["p1"])).toEqual([[]]);
  });
});

describe("slotter", () => {
  const slot = slotter([
    { id: "a", fileName: "svatba_0384_PPR56511.jpg" },
    { id: "b", fileName: "svatba_0385_PPR56600-Edit.jpg" },
    { id: "c", fileName: "svatba_0386_DSC_0100.jpg" },
  ]);

  it("files a new shot under the same camera's nearest lower number", () => {
    expect(slot("PPR56518.jpg")).toEqual({
      name: "svatba_0384_PPR56518.jpg",
      after: "svatba_0384_PPR56511.jpg",
    });
    expect(slot("PPR56700-Edit.jpg")?.after).toBe("svatba_0385_PPR56600-Edit.jpg");
    expect(slot("DSC_0200.jpg")?.name).toBe("svatba_0386_DSC_0200.jpg");
  });

  it("leaves a sequenced name, a delivered number, or a shot before everything alone", () => {
    expect(slot("svatba_001_PPR56518.jpg")).toBeNull();
    expect(slot("PPR56511-Edit.jpg")).toBeNull();
    expect(slot("PPR10000.jpg")).toBeNull();
    expect(slot("IMG_0001.jpg")).toBeNull();
  });
});
