import { describe, expect, it } from "vitest";
import { FACES_MODEL, type Face } from "@/lib/social-video/faces";
import {
  projectionFaces,
  projectionFocus,
  projectionShot,
  shotKeyframes,
  transformFor,
} from "@/lib/projection-camera";

const face = (over: Partial<Face> = {}): Face => ({
  x: 0.45,
  y: 0.25,
  w: 0.08,
  h: 0.12,
  score: 0.9,
  le: [0.47, 0.29],
  re: [0.51, 0.29],
  blink: 0.05,
  ...over,
});
const SCREEN = { width: 1920, height: 1080 };

describe("projectionFaces", () => {
  it("hands over the framing faces, rounded, without the scores the camera does not use", () => {
    const stored = {
      v: 1,
      model: "yunet-some-older-build",
      faces: [{ ...face({ x: 0.123456 }), sharp: 0.9 }, face({ score: 0.65 })],
    };
    expect(projectionFaces(stored)).toEqual([{ ...face({ x: 0.123 }), blink: null }]);
  });

  it("hands over only the couple's boxes where they are named", () => {
    const stored = { v: 1, model: FACES_MODEL, faces: [0.2, 0.4, 0.6].map((x) => face({ x })) };
    const bride = { x: 0.4, y: 0.25, w: 0.08, h: 0.12 };
    expect(projectionFaces(stored, [bride])).toEqual([{ ...face({ x: 0.4 }), blink: null }]);
  });

  it("says unknown, not faceless, when the photo was never searched", () => {
    expect(projectionFaces(null)).toBeNull();
    expect(projectionFaces({ v: 1, model: FACES_MODEL, faces: [] })).toEqual([]);
  });
});

describe("projectionShot", () => {
  const landscape = { width: 3000, height: 2000, faces: [face()] };

  it("moves a landscape photo with faces on a landscape screen, in and out by turns", () => {
    const first = projectionShot(landscape, SCREEN, 7, 0)!;
    const second = projectionShot(landscape, SCREEN, 7, 1)!;
    expect(first.kind).toBe("push");
    expect(second.kind).toBe("pull");
    // Every frame has the screen's shape, so it covers the screen.
    expect(first.from.w / first.from.h).toBeCloseTo(16 / 9);
  });

  it("leaves still what it would have to cut or guess at", () => {
    expect(projectionShot({ ...landscape, faces: null }, SCREEN, 7, 0)).toBeNull();
    expect(projectionShot({ width: 2000, height: 3000, faces: [face()] }, SCREEN, 7, 0)).toBeNull();
    expect(projectionShot({ ...landscape, width: null }, SCREEN, 7, 0)).toBeNull();
  });

  it("pulls out of a group every time", () => {
    const group = { ...landscape, faces: [0.3, 0.4, 0.5].map((x) => face({ x })) };
    expect(projectionShot(group, SCREEN, 7, 0)!.kind).toBe("pull");
  });
});

describe("focus in the projection", () => {
  const rings = { x: 0.4, y: 0.55, w: 0.2, h: 0.25, strength: 40 };

  it("hands over the sharp part, rounded, and drops soft faces in front of it", () => {
    const stored = {
      v: 1,
      model: FACES_MODEL,
      faces: [{ ...face({ x: 0.2 }), sharp: 0.02 }],
      focus: { ...rings, x: 0.400049 },
    };
    expect(projectionFocus(stored)).toEqual(rings);
    expect(projectionFaces(stored)).toEqual([]);
    expect(projectionFocus({ v: 1, model: FACES_MODEL, faces: [] })).toBeNull();
  });

  it("moves a faceless detail towards its sharp part", () => {
    const shot = projectionShot(
      { width: 3000, height: 2000, faces: [], focus: rings },
      SCREEN,
      7,
      0,
    )!;
    expect(shot).not.toBeNull();
    const tight = shot.kind === "push" ? shot.to : shot.from;
    expect(tight.y + tight.h / 2).toBeGreaterThan(1000);
  });
});

describe("shotKeyframes", () => {
  it("puts the camera's rectangle on the screen, from its start to its end", () => {
    const shot = projectionShot({ width: 3000, height: 2000, faces: [face()] }, SCREEN, 7, 0)!;
    const frames = shotKeyframes(shot, SCREEN.width);
    expect(frames[0]).toEqual(transformFor(shot.from, SCREEN.width));
    expect(frames.at(-1)).toEqual(transformFor(shot.to, SCREEN.width));
    expect(transformFor({ x: 300, y: 100, w: 960, h: 540 }, 1920)).toEqual({
      transform: "translate(-600px, -200px) scale(2)",
    });
  });
});
