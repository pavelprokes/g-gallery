import { describe, expect, it } from "vitest";
import { parseAspect, planCrop, shrink, type CropRequest } from "@/lib/photo-crop";

const LANDSCAPE = { width: 3000, height: 2000 };
const PORTRAIT = { width: 2000, height: 3000 };

const request: CropRequest = {
  aspect: 4 / 5,
  gravity: "center",
  rect: null,
  maxWidth: 1080,
  maxHeight: null,
  allowUpscale: false,
};

describe("parseAspect", () => {
  it("reads named, custom and original aspects", () => {
    expect(parseAspect("4:5")).toBeCloseTo(0.8);
    expect(parseAspect("1.91:1")).toBeCloseTo(1.91);
    expect(parseAspect("5:4")).toBeCloseTo(1.25);
    expect(parseAspect("original")).toBeNull();
    for (const bad of ["abc", "10:1", "1:0", "4/5", "-1:2"]) {
      expect(() => parseAspect(bad)).toThrow();
    }
  });
});

describe("planCrop", () => {
  it("keeps the largest rectangle of the aspect, centred, sized to the output", () => {
    const plan = planCrop(LANDSCAPE, request);
    expect(plan.rect).toEqual({ x: 700, y: 0, w: 1600, h: 2000 });
    expect(plan.output).toEqual({ width: 1080, height: 1350 });
    expect(plan.warnings).toEqual([]);
  });

  it("places the crop by an edge or a point", () => {
    expect(planCrop(LANDSCAPE, { ...request, gravity: "left" }).rect.x).toBe(0);
    expect(planCrop(LANDSCAPE, { ...request, gravity: "right" }).rect.x).toBe(1400);
    expect(planCrop(PORTRAIT, { ...request, gravity: "top" }).rect).toEqual({
      x: 0,
      y: 0,
      w: 2000,
      h: 2500,
    });
    expect(planCrop(PORTRAIT, { ...request, gravity: "bottom" }).rect.y).toBe(500);
    // Centred on the point as far as the photo allows.
    expect(planCrop(LANDSCAPE, { ...request, gravity: { x: 0.7, y: 0.5 } }).rect.x).toBe(1300);
    expect(planCrop(LANDSCAPE, { ...request, gravity: { x: 0.95, y: 0.5 } }).rect.x).toBe(1400);
  });

  it("cuts an exact rectangle, trimmed to the aspect around its centre when asked", () => {
    const exact = planCrop(LANDSCAPE, {
      ...request,
      aspect: null,
      rect: { x: 0.5, y: 0.25, w: 0.25, h: 0.5 },
    });
    expect(exact.rect).toEqual({ x: 1500, y: 500, w: 750, h: 1000 });
    expect(exact.output).toEqual({ width: 750, height: 1000 });
    expect(exact.warnings[0]).toMatch(/nezvětšuji/);

    const square = planCrop(LANDSCAPE, {
      ...request,
      aspect: 1,
      rect: { x: 0.5, y: 0.25, w: 0.25, h: 0.5 },
    });
    expect(square.rect).toEqual({ x: 1500, y: 625, w: 750, h: 750 });
    expect(square.warnings.some((w) => w.includes("kolem svého středu"))).toBe(true);
  });

  it("keeps a rectangle inside the photo", () => {
    const plan = planCrop(LANDSCAPE, {
      ...request,
      aspect: null,
      rect: { x: 0.9, y: 0.9, w: 0.5, h: 0.5 },
      maxWidth: null,
    });
    expect(plan.rect).toEqual({ x: 2700, y: 1800, w: 300, h: 200 });
  });

  it("does not enlarge unless asked to", () => {
    const small = { width: 800, height: 1000 };
    const plan = planCrop(small, request);
    expect(plan.output).toEqual({ width: 800, height: 1000 });
    expect(plan.warnings[0]).toMatch(/nezvětšuji/);
    expect(planCrop(small, { ...request, allowUpscale: true }).output).toEqual({
      width: 1080,
      height: 1350,
    });
  });

  it("only resizes for the photo's own aspect, within either limit", () => {
    const big = { width: 6000, height: 4000 };
    const whole = planCrop(big, { ...request, aspect: null, maxWidth: 2048 });
    expect(whole.rect).toEqual({ x: 0, y: 0, w: 6000, h: 4000 });
    expect(whole.output).toEqual({ width: 2048, height: 1365 });
    const byHeight = planCrop(PORTRAIT, {
      ...request,
      aspect: 9 / 16,
      maxWidth: null,
      maxHeight: 1920,
    });
    expect(byHeight.output).toEqual({ width: 1080, height: 1920 });
    const untouched = planCrop(big, { ...request, aspect: null, maxWidth: null });
    expect(untouched.output).toEqual({ width: 6000, height: 4000 });
    expect(untouched.warnings).toEqual([]);
  });
});

describe("shrink", () => {
  it("keeps the aspect", () => {
    expect(shrink({ width: 1080, height: 1350 }, 0.5)).toEqual({ width: 540, height: 675 });
  });
});
