import { afterEach, describe, expect, it, vi } from "vitest";
import {
  correctionDraftKey,
  correctionsBarTop,
  pinFromInput,
  readCorrectionDraft,
  writeCorrectionDraft,
} from "@/components/corrections/corrections-helpers";

describe("pinFromInput", () => {
  it("takes typed digits up to six", () => {
    expect(pinFromInput("")).toBe("");
    expect(pinFromInput("12")).toBe("12");
    expect(pinFromInput("123456")).toBe("123456");
    expect(pinFromInput("1234567")).toBe("123456");
  });

  it("finds the PIN in the admin's copied line", () => {
    expect(pinFromInput("PIN pro připomínky k fotkám: 123456")).toBe("123456");
    expect(pinFromInput("PIN pro připomínky k fotkám: 012345\n")).toBe("012345");
  });

  it("joins a spaced or dashed PIN", () => {
    expect(pinFromInput("123 456")).toBe("123456");
    expect(pinFromInput(" 12-34-56 ")).toBe("123456");
  });

  it("prefers a six-digit run over other numbers around it", () => {
    expect(pinFromInput("Svatba 2026, PIN 654321")).toBe("654321");
  });

  it("falls back to the last six digits", () => {
    expect(pinFromInput("a1b2c3d4e5f6g7")).toBe("234567");
    expect(pinFromInput("PIN")).toBe("");
  });
});

describe("correctionsBarTop", () => {
  it("matches the print summary's offsets when alone", () => {
    expect(correctionsBarTop({ belowChapters: false, printSummary: "none" })).toBe("0.5rem");
    expect(correctionsBarTop({ belowChapters: true, printSummary: "none" })).toBe("4rem");
  });

  it("moves below the print summary when both show", () => {
    expect(correctionsBarTop({ belowChapters: false, printSummary: "short" })).toBe(
      "calc(0.5rem + 4.5rem)",
    );
    expect(correctionsBarTop({ belowChapters: true, printSummary: "tall" })).toBe(
      "calc(4rem + 6rem)",
    );
  });
});

describe("correction drafts", () => {
  afterEach(() => {
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("keeps a draft per gallery and photo", () => {
    const a = correctionDraftKey("g1", "p1");
    const b = correctionDraftKey("g1", "p2");
    writeCorrectionDraft(a, "Prosím vyretušovat pupínek");
    expect(readCorrectionDraft(a)).toBe("Prosím vyretušovat pupínek");
    expect(readCorrectionDraft(b)).toBe("");
    expect(readCorrectionDraft(correctionDraftKey("g2", "p1"))).toBe("");
  });

  it("drops a draft that is cleared or only whitespace", () => {
    const key = correctionDraftKey("g1", "p1");
    writeCorrectionDraft(key, "text");
    writeCorrectionDraft(key, "  ");
    expect(window.sessionStorage.getItem(key)).toBeNull();
  });

  it("survives storage that throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => writeCorrectionDraft("k", "text")).not.toThrow();
    expect(readCorrectionDraft("k")).toBe("");
  });
});
