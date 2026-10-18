import { describe, expect, it } from "vitest";
import {
  checkPhoto,
  CLOSED_FROM,
  eyeRegion,
  eyeSharpness,
  facesToAnalyse,
  MAX_ANALYSED,
  MIN_EYE_PX,
  SOFT_BELOW,
} from "@/lib/photo-check";
import type { Face } from "@/lib/social-video/faces";

const face = (over: Partial<Face> = {}): Face => ({
  x: 0.4,
  y: 0.2,
  w: 0.1,
  h: 0.15,
  score: 0.9,
  le: [0.42, 0.25],
  re: [0.48, 0.25],
  blink: 0.05,
  sharp: 0.8,
  ...over,
});

/** `n` faces in a row, the same size. */
const row = (n: number, over: (i: number) => Partial<Face> = () => ({})) =>
  Array.from({ length: n }, (_, i) => face({ x: i * 0.11, ...over(i) }));

describe("facesToAnalyse", () => {
  it("takes the sure, sizeable faces, largest first, and only so many", () => {
    const big = face({ w: 0.2, h: 0.3 });
    const weak = face({ score: 0.65 });
    const tiny = face({ w: 0.02, h: 0.03 });
    expect(facesToAnalyse([face(), weak, tiny, big])).toEqual([big, face()]);
    expect(facesToAnalyse(row(40))).toHaveLength(MAX_ANALYSED);
  });
});

describe("eyeRegion", () => {
  it("is centred between the eyes, twice their distance wide", () => {
    const region = eyeRegion(face(), 1000, 1000)!;
    expect(region.x + region.w / 2).toBeCloseTo(450);
    expect(region.y + region.h / 2).toBeCloseTo(250);
    expect(region.w).toBeCloseTo(120);
  });

  it("gives up on eyes too small to judge", () => {
    const apart = (MIN_EYE_PX - 1) / 1000;
    expect(eyeRegion(face({ le: [0.4, 0.25], re: [0.4 + apart, 0.25] }), 1000, 1000)).toBeNull();
  });
});

describe("eyeSharpness", () => {
  const W = 16;
  const H = 8;
  const image = (grey: (x: number, y: number) => number) => {
    const rgba = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const v = grey(x, y);
        rgba.set([v, v, v, 255], (y * W + x) * 4);
      }
    return rgba;
  };

  it("rates a hard edge above the same edge blurred, and a flat patch at nothing", () => {
    const hard = eyeSharpness(
      image((x) => (x < 8 ? 60 : 200)),
      W,
      H,
    )!;
    const soft = eyeSharpness(
      image((x) => 60 + (140 * Math.min(1, Math.max(0, x - 4))) / 8),
      W,
      H,
    )!;
    expect(hard).toBeGreaterThan(soft);
    expect(
      eyeSharpness(
        image(() => 128),
        W,
        H,
      ),
    ).toBe(0);
  });

  it("does not judge eyes in deep shadow", () => {
    expect(
      eyeSharpness(
        image((x) => (x < 8 ? 5 : 40)),
        W,
        H,
      ),
    ).toBeNull();
  });
});

describe("checkPhoto", () => {
  const shut = { blink: CLOSED_FROM + 0.2 };

  it("flags one guest blinking in a group", () => {
    const group = row(5, (i) => (i === 2 ? shut : {}));
    expect(checkPhoto(group).closed).toEqual([group[2]]);
  });

  it("leaves a couple with their eyes shut — a kiss — but not one of them blinking", () => {
    expect(checkPhoto(row(2, () => shut)).closed).toEqual([]);
    const couple = row(2, (i) => (i === 0 ? shut : {}));
    expect(checkPhoto(couple).closed).toEqual([couple[0]]);
  });

  it("flags a soft main face, not a soft face in the second row or one it could not judge", () => {
    const soft = { sharp: SOFT_BELOW / 2 };
    const main = face({ w: 0.2, h: 0.3, ...soft });
    expect(checkPhoto([main]).soft).toEqual([main]);
    const sharpCouple = face({ w: 0.2, h: 0.3 });
    const behind = face({ x: 0.7, w: 0.1, h: 0.15, ...soft });
    expect(checkPhoto([sharpCouple, behind]).soft).toEqual([]);
    expect(checkPhoto([face({ sharp: null }), face({ sharp: undefined })]).soft).toEqual([]);
  });
});
