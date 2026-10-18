import { describe, expect, it } from "vitest";
import { FORMATS, type Shot } from "@/lib/social-video/camera";
import {
  averageColor,
  backdropColor,
  drawFrame,
  type FrameContext,
  type FrameImage,
  type FramePlan,
} from "@/lib/social-video/frame";
import { buildTimeline, FIRST_SECONDS, FADE_SECONDS } from "@/lib/social-video/timeline";

/** A context that records what was drawn, and at what opacity. */
function recorder() {
  const calls: { image: unknown; args: number[]; alpha: number }[] = [];
  const ctx = {
    globalAlpha: 1,
    fillStyle: "",
    imageSmoothingEnabled: false,
    imageSmoothingQuality: "low",
    filter: "none",
    fillRect() {
      // A fill is recorded by its colour; the frame's own black is left out.
      if (ctx.fillStyle !== "#000")
        calls.push({ image: ctx.fillStyle, args: [], alpha: ctx.globalAlpha });
    },
    drawImage(image: unknown, ...args: number[]) {
      calls.push({ image: String(image), args, alpha: ctx.globalAlpha });
    },
  };
  return { ctx: ctx as unknown as FrameContext & { filter: string }, calls };
}

/** The recorder compares images by name; `width` is the decoded size. */
const image = (name: string, width = 0) =>
  ({ name, width, height: 0, toString: () => name }) as unknown as FrameImage;

const WIDE = FORMATS["16:9"];
const push: Shot = {
  kind: "push",
  from: { x: 0, y: 0, w: 3000, h: 1687.5 },
  to: { x: 500, y: 300, w: 2400, h: 1350 },
};
const fit: Shot = {
  kind: "fit",
  from: { x: 0, y: 0, w: 2000, h: 3000 },
  to: { x: 0, y: 0, w: 2000, h: 3000 },
};

const plan: FramePlan = {
  format: WIDE,
  timeline: buildTimeline(2, 6),
  slides: [
    { image: image("first", 3000), width: 3000, height: 2000, shot: push },
    {
      image: image("second", 2000),
      width: 2000,
      height: 3000,
      shot: fit,
      backdrop: "rgb(20, 18, 16)",
    },
  ],
};

describe("drawFrame", () => {
  it("crops the photo by the camera into the whole frame", () => {
    const { ctx, calls } = recorder();
    drawFrame(ctx, plan, 0);
    expect(calls).toEqual([
      { image: "first", args: [0, 0, 3000, 1687.5, 0, 0, 1920, 1080], alpha: 1 },
    ]);
  });

  it("scales the shot to a bitmap fetched smaller than the photo", () => {
    const { ctx, calls } = recorder();
    const half = { ...plan, slides: [{ ...plan.slides[0]!, image: image("first", 1500) }] };
    drawFrame(ctx, half, 0);
    expect(calls[0]!.args).toEqual([0, 0, 1500, 843.75, 0, 0, 1920, 1080]);
  });

  it("skips a slide whose photo is not decoded yet", () => {
    const { ctx, calls } = recorder();
    drawFrame(ctx, { ...plan, slides: [{ ...plan.slides[0]!, image: null }] }, 0);
    expect(calls).toEqual([]);
  });

  it("fades the next slide in over the one still moving underneath", () => {
    const { ctx, calls } = recorder();
    drawFrame(ctx, plan, FIRST_SECONDS + FADE_SECONDS / 2);
    expect(calls.map((c) => [c.image, c.alpha])).toEqual([
      ["first", 1],
      ["rgb(20, 18, 16)", expect.closeTo(0.5)],
      ["second", expect.closeTo(0.5)],
    ]);
    expect(ctx.globalAlpha).toBe(1);
  });

  it("shows a fit slide whole, centred over its backdrop", () => {
    const { ctx, calls } = recorder();
    drawFrame(ctx, plan, plan.timeline.duration);
    const photo = calls.find((c) => c.image === "second")!;
    const [x, , w, h] = photo.args;
    expect(h).toBeLessThanOrEqual(1080 * 1.03 + 1e-9);
    expect(x! + w! / 2).toBeCloseTo(960);
  });
});

describe("backdropColor", () => {
  const hsl = (rgb: string) => {
    const [r, g, b] = rgb.match(/\d+/g)!.map((n) => Number(n) / 255) as [number, number, number];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
    return { s, l };
  };

  it("keeps a hint of the photo's tone, dark and nearly grey", () => {
    const wall = backdropColor([214, 196, 170]);
    expect(hsl(wall).l).toBeLessThanOrEqual(0.17);
    expect(hsl(wall).s).toBeLessThanOrEqual(0.16);
    const [r, , b] = wall.match(/\d+/g)!.map(Number);
    // Still warm: a sandstone wall does not turn blue.
    expect(r!).toBeGreaterThan(b!);
  });

  it("never lets a vivid photo through vivid, nor a white one through light", () => {
    expect(hsl(backdropColor([230, 20, 40])).s).toBeLessThanOrEqual(0.16);
    expect(hsl(backdropColor([255, 255, 255])).l).toBeLessThanOrEqual(0.17);
    expect(backdropColor([0, 0, 0])).toBe("rgb(15, 15, 15)");
  });
});

describe("averageColor", () => {
  it("averages the pixels, alpha ignored", () => {
    expect(averageColor([0, 100, 200, 255, 100, 100, 0, 0])).toEqual([50, 100, 100]);
    expect(averageColor([])).toEqual([0, 0, 0]);
  });
});
