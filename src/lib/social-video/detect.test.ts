import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MEDIAPIPE_VERSION } from "@/lib/social-video/detect";

describe("MEDIAPIPE_VERSION", () => {
  it("is the pinned package's — the WASM is served from a path with it", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.dependencies["@mediapipe/tasks-vision"]).toBe(MEDIAPIPE_VERSION);
  });
});
