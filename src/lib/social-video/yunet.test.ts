import { describe, expect, it } from "vitest";
import {
  CHECK_CONTEXT,
  checkWindow,
  confirmed,
  decodeOutputs,
  inputFor,
  MAX_EDGE,
  mapCandidate,
  suppress,
  toBgrPlanar,
  toFace,
  type Candidate,
} from "@/lib/social-video/yunet";

const candidate = (over: Partial<Candidate> = {}): Candidate => ({
  x: 100,
  y: 100,
  w: 20,
  h: 30,
  score: 0.9,
  eyes: [
    [105, 110],
    [115, 110],
  ],
  ...over,
});

describe("inputFor", () => {
  it("pads a small photo to multiples of 32 and leaves it unscaled", () => {
    expect(inputFor(1500, 1000)).toEqual({
      scale: 1,
      drawWidth: 1500,
      drawHeight: 1000,
      width: 1504,
      height: 1024,
    });
  });

  it("scales a larger one down to the long-edge cap", () => {
    expect(inputFor(MAX_EDGE * 2, MAX_EDGE)).toMatchObject({
      scale: 0.5,
      drawWidth: MAX_EDGE,
      width: MAX_EDGE,
      height: MAX_EDGE / 2,
    });
  });
});

describe("toBgrPlanar", () => {
  it("splits RGBA pixels into blue, green and red planes", () => {
    const rgba = [10, 20, 30, 255, 40, 50, 60, 255];
    expect([...toBgrPlanar(rgba, 2, 1)]).toEqual([30, 60, 20, 50, 10, 40]);
  });
});

describe("decodeOutputs", () => {
  // A 32×32 input: 16 anchors at stride 8, 4 at 16, 1 at 32.
  const outputs = (cls: number) => {
    const out: Record<string, { data: Float32Array }> = {};
    for (const [stride, n] of [
      [8, 16],
      [16, 4],
      [32, 1],
    ] as const) {
      out[`cls_${stride}`] = { data: new Float32Array(n) };
      out[`obj_${stride}`] = { data: new Float32Array(n) };
      out[`bbox_${stride}`] = { data: new Float32Array(n * 4) };
      out[`kps_${stride}`] = { data: new Float32Array(n * 10) };
    }
    // Stride 8, row 1, column 2.
    const i = 6;
    out.cls_8!.data[i] = cls;
    out.obj_8!.data[i] = 1;
    out.bbox_8!.data.set([0.5, 0.5, Math.log(2), Math.log(3)], i * 4);
    out.kps_8!.data.set([0, 0, 1, 0], i * 10);
    return out;
  };

  it("turns an anchor into a box and two eyes in the input's pixels", () => {
    const [c, ...rest] = decodeOutputs(outputs(0.81), 32, 32);
    expect(rest).toEqual([]);
    expect(c!.score).toBeCloseTo(0.9);
    expect(c!.x).toBeCloseTo(12);
    expect(c!.y).toBeCloseTo(0);
    expect(c!.w).toBeCloseTo(16);
    expect(c!.h).toBeCloseTo(24);
    expect(c!.eyes).toEqual([
      [16, 8],
      [24, 8],
    ]);
  });

  it("skips an anchor below the score, and refuses outputs that are not there", () => {
    expect(decodeOutputs(outputs(0.25), 32, 32)).toEqual([]);
    expect(() => decodeOutputs({}, 32, 32)).toThrow("YUNET_OUTPUT_cls_8");
  });
});

describe("suppress", () => {
  it("keeps the best of overlapping boxes and every separate one", () => {
    const kept = suppress([
      candidate({ score: 0.7 }),
      candidate({ x: 102, score: 0.95 }),
      candidate({ x: 300, score: 0.8 }),
    ]);
    expect(kept.map((c) => c.score)).toEqual([0.95, 0.8]);
  });
});

describe("the second look", () => {
  it("sees a square around the box, its context times the longer side", () => {
    const win = checkWindow(candidate());
    expect(win.w).toBe(30 * CHECK_CONTEXT);
    expect(win.h).toBe(win.w);
    expect(win.x + win.w / 2).toBe(110);
    expect(win.y + win.h / 2).toBe(115);
  });

  it("maps its detections back into the photo", () => {
    const back = mapCandidate(candidate({ x: 10, y: 20, w: 4, h: 6 }), 0.5, 100, 200);
    expect(back).toMatchObject({ x: 105, y: 210, w: 2, h: 3 });
    expect(back.eyes[0]).toEqual([152.5, 255]);
  });

  it("confirms a box only where the model sees the same face again, sure enough", () => {
    const box = candidate();
    expect(confirmed(box, [candidate({ x: 102, score: 0.7 })])).toBe(true);
    expect(confirmed(box, [candidate({ x: 102, score: 0.5 })])).toBe(false);
    expect(confirmed(box, [candidate({ x: 200, score: 0.9 })])).toBe(false);
    expect(confirmed(box, [])).toBe(false);
  });
});

describe("toFace", () => {
  it("stores 0–1 coordinates with the eyes left to right, cut at the photo's edge", () => {
    const face = toFace(
      candidate({
        x: -10,
        y: 50,
        w: 40,
        h: 40,
        eyes: [
          [20, 60],
          [5, 60],
        ],
      }),
      200,
      100,
    );
    expect(face).toEqual({
      x: 0,
      y: 0.5,
      w: 0.15,
      h: 0.4,
      score: 0.9,
      le: [0.025, 0.6],
      re: [0.1, 0.6],
      blink: null,
    });
  });
});
