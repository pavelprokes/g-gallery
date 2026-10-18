import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MEDIAPIPE_VERSION, toTileDetection } from "@/lib/social-video/detect";

describe("MEDIAPIPE_VERSION", () => {
  it("is the pinned package's — the WASM is served from a path with it", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.dependencies["@mediapipe/tasks-vision"]).toBe(MEDIAPIPE_VERSION);
  });
});

describe("toTileDetection", () => {
  it("keeps the box in the tile's pixels and the first two keypoints as eyes", () => {
    expect(
      toTileDetection({
        categories: [{ score: 0.8, index: 0, categoryName: "", displayName: "" }],
        boundingBox: { originX: 10, originY: 20, width: 30, height: 40, angle: 0 },
        keypoints: [
          { x: 0.1, y: 0.2 },
          { x: 0.3, y: 0.2 },
          { x: 0.2, y: 0.3 },
        ],
      }),
    ).toEqual({
      box: { x: 10, y: 20, w: 30, h: 40 },
      score: 0.8,
      eyes: [
        { x: 0.1, y: 0.2 },
        { x: 0.3, y: 0.2 },
      ],
    });
  });

  it("drops a detection without a box or without eyes", () => {
    expect(toTileDetection({ categories: [], keypoints: [] })).toBeNull();
    expect(
      toTileDetection({
        categories: [],
        boundingBox: { originX: 0, originY: 0, width: 1, height: 1, angle: 0 },
        keypoints: [{ x: 0, y: 0 }],
      }),
    ).toBeNull();
  });
});
