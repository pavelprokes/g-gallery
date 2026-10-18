import { describe, expect, it } from "vitest";
import { FORMATS, type Shot } from "@/lib/social-video/camera";
import {
  drawFrame,
  makeBackdrop,
  type FrameContext,
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
    fillRect: () => {},
    drawImage(image: unknown, ...args: number[]) {
      calls.push({ image, args, alpha: ctx.globalAlpha });
    },
  };
  return { ctx: ctx as unknown as FrameContext & { filter: string }, calls };
}

/** The recorder only compares images by identity; a name stands in for one. */
const image = (name: string) => name as unknown as CanvasImageSource;

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
    { image: image("first"), width: 3000, height: 2000, shot: push },
    { image: image("second"), width: 2000, height: 3000, shot: fit, backdrop: image("blur") },
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

  it("fades the next slide in over the one still moving underneath", () => {
    const { ctx, calls } = recorder();
    drawFrame(ctx, plan, FIRST_SECONDS + FADE_SECONDS / 2);
    expect(calls.map((c) => [c.image, c.alpha])).toEqual([
      ["first", 1],
      ["blur", expect.closeTo(0.5)],
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

describe("makeBackdrop", () => {
  it("fills the canvas with the photo, blurred, and resets the filter", () => {
    const { ctx, calls } = recorder();
    const filters: string[] = [];
    const tracked = new Proxy(ctx, {
      set(target, key, value) {
        if (key === "filter") filters.push(value);
        return Reflect.set(target, key, value);
      },
    });
    makeBackdrop(image("photo"), 2000, 3000, {
      width: 480,
      height: 270,
      getContext: () => tracked,
    });
    const [x, y, w, h] = calls[0]!.args;
    expect(w! >= 480 && h! >= 270).toBe(true);
    expect(x! + w! / 2).toBeCloseTo(240);
    expect(y! + h! / 2).toBeCloseTo(135);
    expect(filters[0]).toContain("blur");
    expect(filters.at(-1)).toBe("none");
  });
});
