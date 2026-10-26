import { describe, expect, it } from "vitest";
import { aimFaces, isDetailShot, needsFocus } from "@/lib/social-video/aim";
import { FACES_MODEL, type Face } from "@/lib/social-video/faces";
import type { Focus } from "@/lib/social-video/focus";

/** A framed face at (x, y), its eyes measured `sharp` (null: not measured). */
const face = (x: number, y: number, sharp: number | null): Face => ({
  x,
  y,
  w: 0.1,
  h: 0.14,
  score: 0.9,
  le: [x + 0.03, y + 0.05],
  re: [x + 0.07, y + 0.05],
  blink: 0.1,
  sharp,
});
/** Rings held up low in front of the couple. */
const rings: Focus = { x: 0.4, y: 0.55, w: 0.2, h: 0.25, strength: 40 };
const stored = (faces: Face[], focus?: Focus | null) => ({
  v: 1 as const,
  model: FACES_MODEL,
  faces,
  ...(focus === undefined ? {} : { focus }),
});

describe("aimFaces", () => {
  it("lets go of soft faces when the sharp part is elsewhere — the rings, not the blurred couple", () => {
    expect(aimFaces([face(0.25, 0.15, 0.02), face(0.55, 0.15, 0.03)], rings)).toEqual([]);
  });

  it("keeps the faces when any of them is sharp", () => {
    const faces = [face(0.25, 0.15, 0.02), face(0.55, 0.15, 0.4)];
    expect(aimFaces(faces, rings)).toBe(faces);
  });

  it("keeps the faces when their eyes were not measured — dark or tiny", () => {
    const faces = [face(0.25, 0.15, null)];
    expect(aimFaces(faces, rings)).toBe(faces);
  });

  it("keeps the faces when the sharp part is a face itself", () => {
    const faces = [face(0.42, 0.58, 0.02)];
    expect(aimFaces(faces, rings)).toBe(faces);
  });

  it("keeps the faces without a focus", () => {
    const faces = [face(0.25, 0.15, 0.02)];
    expect(aimFaces(faces, null)).toBe(faces);
    expect(aimFaces(faces, undefined)).toBe(faces);
  });
});

describe("isDetailShot and needsFocus", () => {
  it("counts the rings in front of a soft couple as a detail", () => {
    expect(isDetailShot(stored([face(0.25, 0.15, 0.02)], rings))).toBe(true);
    expect(isDetailShot(stored([face(0.25, 0.15, 0.4)], rings))).toBe(false);
    expect(isDetailShot(stored([], rings))).toBe(true);
    expect(isDetailShot(stored([], null))).toBe(false);
  });

  it("sends back only what focus could change: no face, or only soft ones", () => {
    expect(needsFocus(stored([]))).toBe(true);
    expect(needsFocus(stored([face(0.25, 0.15, 0.02)]))).toBe(true);
    expect(needsFocus(stored([face(0.25, 0.15, 0.4)]))).toBe(false);
    expect(needsFocus(stored([face(0.25, 0.15, null)]))).toBe(false);
    expect(needsFocus(stored([], null))).toBe(false);
  });
});
