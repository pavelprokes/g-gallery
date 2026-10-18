import { describe, expect, it } from "vitest";
import {
  cameraAt,
  directShots,
  eyesInSafeArea,
  FORMATS,
  planShot,
  sourceWidth,
  type PhotoForShot,
  type Rect,
  type Shot,
} from "@/lib/social-video/camera";
import type { Face } from "@/lib/social-video/faces";

const VERTICAL = FORMATS["9:16"];
const WIDE = FORMATS["16:9"];
const SECONDS = 2.95;

/** A face whose box is `w` × `w·1.33` of the photo's width, eyes a third down it. */
function face(cx: number, top: number, w: number, aspect: number): Face {
  const h = (w * 1.33 * aspect) / 1; // in the photo's height units
  return {
    x: cx - w / 2,
    y: top,
    w,
    h,
    score: 0.9,
    le: [cx - w / 4, top + h / 3],
    re: [cx + w / 4, top + h / 3],
    blink: null,
  };
}

/** A 3:2 landscape photo, 3000 × 2000. */
const landscape = (...faces: Face[]): PhotoForShot => ({ width: 3000, height: 2000, faces });
/** A 2:3 portrait photo, 2000 × 3000. */
const portrait = (...faces: Face[]): PhotoForShot => ({ width: 2000, height: 3000, faces });

function inside(rect: Rect, photo: PhotoForShot) {
  expect(rect.x).toBeGreaterThanOrEqual(-1e-6);
  expect(rect.y).toBeGreaterThanOrEqual(-1e-6);
  expect(rect.x + rect.w).toBeLessThanOrEqual(photo.width + 1e-6);
  expect(rect.y + rect.h).toBeLessThanOrEqual(photo.height + 1e-6);
}

const aspectOf = (r: Rect) => r.w / r.h;

describe("planShot", () => {
  it("frames an off-centre couple, eyes on the line, inside the photo", () => {
    // Two heads side by side in the right third of a landscape photo.
    const photo = landscape(face(0.68, 0.3, 0.05, 1.5), face(0.76, 0.32, 0.05, 1.5));
    const shot = planShot(photo, VERTICAL, SECONDS);
    expect(shot.kind).toBe("push");
    for (const r of [shot.from, shot.to]) {
      inside(r, photo);
      expect(aspectOf(r)).toBeCloseTo(9 / 16);
    }
    // The tight frame sits on the couple, not on the photo's centre.
    const cx = shot.to.x + shot.to.w / 2;
    expect(cx / photo.width).toBeGreaterThan(0.6);
    expect(eyesInSafeArea(photo, shot.to, VERTICAL)).toBe(true);
    // A zoom of at most the format's own limit.
    expect(shot.from.w / shot.to.w).toBeLessThanOrEqual(VERTICAL.maxZoom + 1e-9);
  });

  it("never cuts the top of the heads to keep the eye line", () => {
    // A face near the top edge: the eye line would put the frame above the photo.
    const photo = portrait(face(0.5, 0.05, 0.3, 2 / 3));
    const shot = planShot(photo, WIDE, SECONDS);
    inside(shot.to, photo);
    expect(shot.to.y).toBe(0);
  });

  it("frames a couple standing in a portrait photo for 16:9 by their heads", () => {
    // Faces a fifth of the width each: head and shoulders are taller than a
    // 16:9 strip of a portrait photo can be.
    // Large enough that the no-upscaling floor does not decide the zoom.
    const photo: PhotoForShot = {
      width: 4000,
      height: 6000,
      faces: [face(0.38, 0.2, 0.2, 2 / 3), face(0.62, 0.22, 0.2, 2 / 3)],
    };
    const shot = planShot(photo, WIDE, SECONDS);
    expect(shot.kind).toBe("push");
    expect(shot.from.w / shot.to.w).toBeGreaterThanOrEqual(1.06 - 1e-9);
    expect(shot.to.y).toBeLessThanOrEqual(0.2 * 6000);
  });

  it("pans between two people too far apart for a 9:16 crop", () => {
    const photo = landscape(face(0.25, 0.3, 0.06, 1.5), face(0.62, 0.3, 0.06, 1.5));
    const shot = planShot(photo, VERTICAL, SECONDS);
    expect(shot.kind).toBe("pan");
    expect(shot.from.w).toBeCloseTo(shot.to.w);
    expect(shot.from.x).toBeLessThan(shot.to.x);
    inside(shot.from, photo);
    inside(shot.to, photo);
  });

  it("shows a wide group whole rather than flying across it", () => {
    const group = [0.1, 0.25, 0.4, 0.55, 0.7, 0.85].map((cx) => face(cx, 0.35, 0.04, 1.5));
    expect(planShot(landscape(...group), VERTICAL, SECONDS).kind).toBe("fit");
    // The same group fits a 16:9 crop and is simply framed.
    expect(planShot(landscape(...group), WIDE, SECONDS).kind).toBe("push");
  });

  it("zooms gently on the centre when there is no face", () => {
    const photo = landscape();
    const shot = planShot(photo, WIDE, SECONDS);
    expect(shot.kind).toBe("push");
    expect(shot.from.x + shot.from.w / 2).toBeCloseTo(1500);
    expect(shot.to.x + shot.to.w / 2).toBeCloseTo(1500);
    expect(shot.from.w / shot.to.w).toBeLessThanOrEqual(1.12 + 1e-9);
  });

  it("ignores a small face in the background", () => {
    const couple = face(0.5, 0.3, 0.08, 1.5);
    const stranger = face(0.05, 0.1, 0.02, 1.5);
    const withStranger = planShot(landscape(couple, stranger), VERTICAL, SECONDS);
    const alone = planShot(landscape(couple), VERTICAL, SECONDS);
    expect(withStranger).toEqual(alone);
  });

  it("caps the zoom by the slide's length — a short slide zooms less", () => {
    const photo = landscape(face(0.5, 0.3, 0.04, 1.5));
    const short = planShot(photo, WIDE, 1);
    expect(short.from.w / short.to.w).toBeLessThanOrEqual(1.08 + 1e-9);
  });

  it("enlarges a small photo's pixels by 1.35× at most", () => {
    const small: PhotoForShot = { width: 1600, height: 1000, faces: [face(0.5, 0.3, 0.05, 1.6)] };
    const shot = planShot(small, WIDE, SECONDS);
    expect(WIDE.width / shot.to.w).toBeLessThanOrEqual(1.35 + 1e-9);
    // One already enlarged to fill the frame does not zoom at all.
    const tiny: PhotoForShot = { width: 1200, height: 800, faces: [face(0.5, 0.3, 0.05, 1.5)] };
    const still = planShot(tiny, WIDE, SECONDS);
    expect(still.to.w).toBeCloseTo(still.from.w);
  });
});

describe("sourceWidth", () => {
  it("fetches a landscape photo for 9:16 tall enough to fill the frame's height", () => {
    const w = sourceWidth({ width: 6000, height: 4000 }, VERTICAL);
    // Height at that width ≥ 1920.
    expect((w * 4000) / 6000).toBeGreaterThanOrEqual(1920);
    expect(w % 256).toBe(0);
  });

  it("fetches a landscape photo for 16:9 at about the output's width", () => {
    const w = sourceWidth({ width: 6000, height: 4000 }, WIDE);
    expect(w).toBeGreaterThanOrEqual(1920);
    expect(w).toBeLessThan(1920 + 256);
  });

  it("never asks for more than the photo has", () => {
    expect(sourceWidth({ width: 1000, height: 700 }, VERTICAL)).toBe(1000);
  });
});

describe("directShots", () => {
  const push = (n: number): Shot => ({
    kind: "push",
    from: { x: 0, y: 0, w: 100 + n, h: 100 },
    to: { x: 10, y: 10, w: 80, h: 80 },
  });

  it("opens pulling out, then alternates; groups pull out", () => {
    const kinds = directShots([push(0), push(1), push(2), push(3)], [1, 2, 2, 5]).map(
      (s) => s.kind,
    );
    expect(kinds).toEqual(["pull", "push", "pull", "pull"]);
  });

  it("reverses a pull, and alternates the pans' direction", () => {
    const [pull] = directShots([push(0)], [1]);
    expect(pull!.from).toEqual(push(0).to);
    const pan: Shot = { kind: "pan", from: push(0).from, to: push(0).to };
    const [a, b] = directShots([pan, pan], [2, 2]);
    expect(a!.from).toEqual(pan.from);
    expect(b!.from).toEqual(pan.to);
  });
});

describe("cameraAt", () => {
  const shot: Shot = {
    kind: "push",
    from: { x: 0, y: 0, w: 1600, h: 900 },
    to: { x: 400, y: 200, w: 800, h: 450 },
  };

  it("starts and ends on the shot's frames and keeps the aspect between", () => {
    expect(cameraAt(shot, 0)).toEqual(shot.from);
    const end = cameraAt(shot, 1);
    expect(end.x).toBeCloseTo(400);
    expect(end.w).toBeCloseTo(800);
    const mid = cameraAt(shot, 0.5);
    expect(mid.w / mid.h).toBeCloseTo(16 / 9);
    // Geometric: halfway in time is the geometric mean of the widths.
    expect(mid.w).toBeCloseTo(Math.sqrt(1600 * 800));
  });
});
