import { describe, expect, it } from "vitest";
import { fileProblem, MAX_BYTES, MAX_PHOTOS, MIN_BYTES, room, sizeProblem } from "./limits";

describe("fileProblem", () => {
  it("takes JPEG, PNG and WebP within the size bounds", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp"]) {
      expect(fileProblem({ type, size: 2_000_000 })).toBeNull();
    }
  });

  it("names what is wrong", () => {
    expect(fileProblem({ type: "image/heic", size: 2_000_000 })).toBe("type");
    expect(fileProblem({ type: "video/mp4", size: 2_000_000 })).toBe("type");
    expect(fileProblem({ type: "image/jpeg", size: MIN_BYTES - 1 })).toBe("tooSmallFile");
    expect(fileProblem({ type: "image/jpeg", size: MAX_BYTES + 1 })).toBe("tooLargeFile");
  });
});

describe("sizeProblem", () => {
  it("takes a phone photo and a 61 MP full frame", () => {
    expect(sizeProblem(4032, 3024)).toBeNull();
    expect(sizeProblem(9504, 6336)).toBeNull();
  });

  it("measures the shorter side, in either orientation", () => {
    expect(sizeProblem(1600, 999)).toBe("tooFewPixels");
    expect(sizeProblem(999, 1600)).toBe("tooFewPixels");
    expect(sizeProblem(1000, 1500)).toBeNull();
  });

  it("refuses what a phone could not decode", () => {
    expect(sizeProblem(10_000, 7_000)).toBe("tooManyPixels");
    expect(sizeProblem(12_001, 1_200)).toBe("tooManyPixels");
  });
});

describe("room", () => {
  it("lets in only what fits", () => {
    expect(room(0, 10)).toBe(10);
    expect(room(MAX_PHOTOS - 2, 10)).toBe(2);
    expect(room(MAX_PHOTOS, 10)).toBe(0);
  });
});
