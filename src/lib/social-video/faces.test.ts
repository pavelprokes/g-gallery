import { describe, expect, it } from "vitest";
import {
  attachBlinks,
  currentFaces,
  FACES_MODEL,
  mergeDetections,
  TILE_MIN_SCORE,
  tilesFor,
  type Face,
} from "@/lib/social-video/faces";

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
});

describe("tilesFor", () => {
  it("covers the photo with the frame and 2×2 to 5×5 overlapping tiles", () => {
    const tiles = tilesFor(3000, 2000);
    expect(tiles).toHaveLength(1 + 4 + 9 + 16 + 25);
    expect(tiles[0]).toMatchObject({ x: 0, y: 0, w: 3000, h: 2000 });
    for (const t of tiles) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeGreaterThanOrEqual(0);
      expect(t.x + t.w).toBeLessThanOrEqual(3000 + 1e-9);
      expect(t.y + t.h).toBeLessThanOrEqual(2000 + 1e-9);
    }
    // Neighbouring 2×2 tiles overlap, so a face on the seam is whole in one.
    const [, a, b] = tiles;
    expect(a!.x + a!.w).toBeGreaterThan(b!.x);
    expect(tiles.slice(1).every((t) => t.minScore === TILE_MIN_SCORE)).toBe(true);
  });
});

describe("mergeDetections", () => {
  const W = 2000;
  const H = 1000;

  it("maps a tile's detection into the photo and orders the eyes left to right", () => {
    const tile = { x: 1000, y: 500, w: 1000, h: 500, minScore: 0.75 };
    const [merged] = mergeDetections(W, H, [
      {
        tile,
        detections: [
          {
            box: { x: 100, y: 50, w: 200, h: 100 },
            score: 0.9,
            // MediaPipe's first keypoint is the subject's right eye — on the
            // left of the photo — but nothing downstream should care.
            eyes: [
              { x: 0.25, y: 0.2 },
              { x: 0.15, y: 0.2 },
            ],
          },
        ],
      },
    ]);
    expect(merged).toMatchObject({ x: 0.55, y: 0.55, w: 0.1, h: 0.1, score: 0.9 });
    expect(merged!.le[0]).toBeCloseTo(0.575);
    expect(merged!.re[0]).toBeCloseTo(0.625);
  });

  it("keeps the best of overlapping boxes and drops a tile hit below the tile bar", () => {
    const whole = { x: 0, y: 0, w: W, h: H, minScore: 0.5 };
    const tile = { x: 0, y: 0, w: 1000, h: 500, minScore: 0.75 };
    const det = (x: number, score: number) => ({
      box: { x, y: 100, w: 100, h: 100 },
      score,
      eyes: [
        { x: 0.1, y: 0.2 },
        { x: 0.2, y: 0.2 },
      ] as const,
    });
    const faces = mergeDetections(W, H, [
      { tile: whole, detections: [det(100, 0.6)] },
      // The same face, found again in a tile with a better score…
      { tile, detections: [det(105, 0.92), det(700, 0.7)] },
    ]);
    // …wins; the tile's 0.7 (a knee, a shoulder) does not pass 0.75.
    expect(faces).toHaveLength(1);
    expect(faces[0]!.score).toBe(0.92);
  });
});

describe("attachBlinks", () => {
  it("gives a face the blink of the landmarked face centred in it, and only that", () => {
    const a = face({ x: 0.1, y: 0.1, w: 0.1, h: 0.1 });
    const b = face({ x: 0.6, y: 0.1, w: 0.1, h: 0.1 });
    const [withBlink, without] = attachBlinks(
      [a, b],
      [{ x: 0.11, y: 0.11, w: 0.08, h: 0.08, blink: 0.8 }],
    );
    expect(withBlink!.blink).toBe(0.8);
    expect(without!.blink).toBeNull();
  });
});
