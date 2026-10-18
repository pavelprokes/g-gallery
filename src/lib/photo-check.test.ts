import { describe, expect, it } from "vitest";
import {
  centredInCrop,
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

  it("gives up on eyes cut by the frame", () => {
    expect(eyeRegion(face({ le: [0.01, 0.25], re: [0.06, 0.25] }), 1000, 1000)).toBeNull();
  });

  it("gives up on eyes too small to judge", () => {
    const apart = (MIN_EYE_PX - 1) / 1000;
    expect(eyeRegion(face({ le: [0.4, 0.25], re: [0.4 + apart, 0.25] }), 1000, 1000)).toBeNull();
  });
});

describe("centredInCrop", () => {
  const box = (cx: number, cy: number) => [
    { x: cx - 0.25, y: cy - 0.3 },
    { x: cx + 0.25, y: cy + 0.3 },
  ];

  it("takes the face the crop was cut around, not a neighbour at its edge", () => {
    expect(centredInCrop(box(0.5, 0.5))).toBe(true);
    expect(centredInCrop(box(0.85, 0.5))).toBe(false);
    expect(centredInCrop([])).toBe(false);
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
  const check = (faces: Face[]) => checkPhoto(faces, 1000, 1000);

  it("flags one guest blinking in a posed group", () => {
    const group = row(5, (i) => (i === 2 ? shut : {}));
    expect(check(group).closed).toEqual([group[2]]);
  });

  it("leaves shut eyes where they are a moment: a candid group, a couple, a portrait, a laugh", () => {
    // Half the group looking down: candid, not posed.
    expect(check(row(4, (i) => (i < 2 ? shut : {}))).closed).toEqual([]);
    expect(check(row(2, () => shut)).closed).toEqual([]);
    expect(check([face(shut)]).closed).toEqual([]);
    expect(check(row(5, (i) => (i === 2 ? { ...shut, smile: 0.9 } : {}))).closed).toEqual([]);
  });

  it("flags a soft main face looking at the camera", () => {
    const main = face({ w: 0.2, h: 0.3, le: [0.43, 0.3], re: [0.53, 0.3], sharp: SOFT_BELOW / 2 });
    expect(check([main]).soft).toEqual([main]);
  });

  it("does not judge a profile, a face the landmarker could not read, the second row", () => {
    const soft = { sharp: SOFT_BELOW / 2 };
    // Eyes 0.02 apart on a face 0.1 wide: a profile.
    expect(check([face({ ...soft, le: [0.44, 0.25], re: [0.46, 0.25] })]).soft).toEqual([]);
    expect(check([face({ ...soft, blink: null })]).soft).toEqual([]);
    const sharpCouple = face({ w: 0.2, h: 0.3 });
    const behind = face({ x: 0.7, w: 0.1, h: 0.15, ...soft });
    expect(check([sharpCouple, behind]).soft).toEqual([]);
    expect(check([face({ sharp: null }), face({ sharp: undefined })]).soft).toEqual([]);
  });
});
