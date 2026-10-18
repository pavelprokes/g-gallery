import { describe, expect, it } from "vitest";
import { currentFaces, FACES_MODEL, MAX_FACES, type Face } from "@/lib/social-video/faces";

const face = (over: Partial<Face> = {}): Face => ({
  x: 0.4,
  y: 0.2,
  w: 0.1,
  h: 0.12,
  score: 0.9,
  le: [0.42, 0.25],
  re: [0.48, 0.25],
  blink: null,
  ...over,
});

describe("currentFaces", () => {
  it("reads a value this build wrote", () => {
    const stored = { v: 1, model: FACES_MODEL, faces: [face()] };
    expect(currentFaces(stored)).toEqual(stored);
  });

  it("treats another model, a broken value or nothing as not computed", () => {
    expect(currentFaces({ v: 1, model: "blazeface-sr@0.10", faces: [] })).toBeNull();
    expect(currentFaces({ v: 1, model: FACES_MODEL, faces: [{ ...face(), x: 1.5 }] })).toBeNull();
    expect(currentFaces(null)).toBeNull();
  });

  it("holds a whole wedding on the steps, not an unbounded list", () => {
    const many = (n: number) => ({
      v: 1,
      model: FACES_MODEL,
      faces: Array.from({ length: n }, () => face()),
    });
    expect(currentFaces(many(MAX_FACES))).not.toBeNull();
    expect(currentFaces(many(MAX_FACES + 1))).toBeNull();
  });
});
