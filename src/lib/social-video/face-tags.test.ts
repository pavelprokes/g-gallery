import { describe, expect, it } from "vitest";
import { planShot, FORMATS } from "@/lib/social-video/camera";
import {
  coupleFaces,
  faceTiles,
  focusFaces,
  matchTags,
  seriesMatches,
  type SeriesPhoto,
} from "@/lib/social-video/face-tags";
import type { Face } from "@/lib/social-video/faces";

const face = (x: number, over: Partial<Face> = {}): Face => ({
  x,
  y: 0.3,
  w: 0.08,
  h: 0.12,
  score: 0.9,
  le: [x + 0.02, 0.34],
  re: [x + 0.06, 0.34],
  blink: 0.05,
  ...over,
});
const box = (f: Face, dx = 0) => ({ x: f.x + dx, y: f.y, w: f.w, h: f.h });

describe("matchTags", () => {
  it("finds a tag on the same face found again a few pixels off", () => {
    const faces = [face(0.2), face(0.5)];
    const tag = { personId: "bride", ...box(faces[1]!, 0.005) };
    expect(matchTags(faces, [tag])).toEqual([null, tag]);
  });

  it("does not hand a neighbour's tag to a face cheek to cheek with it", () => {
    const faces = [face(0.4), face(0.47)];
    const tag = { personId: "bride", ...box(faces[0]!) };
    expect(matchTags(faces, [tag])).toEqual([tag, null]);
  });

  it("gives a tag to one face only, the one it overlaps most", () => {
    const faces = [face(0.4), face(0.402)];
    const tag = { personId: "bride", ...box(faces[1]!) };
    expect(matchTags(faces, [tag])).toEqual([null, tag]);
  });
});

describe("focusFaces", () => {
  const group = [0.1, 0.3, 0.5, 0.7, 0.9].map((x) => face(x));

  it("frames the couple in a group, where they are named", () => {
    const couple = [box(group[2]!), box(group[3]!)];
    expect(focusFaces(group, couple)).toEqual([group[2], group[3]]);
    expect(coupleFaces(group, couple)).toHaveLength(2);
    // A group 9:16 can only show whole becomes a push in on the two of them.
    const photo = { width: 3000, height: 2000 };
    expect(planShot({ ...photo, faces: group }, FORMATS["9:16"], 4).kind).toBe("fit");
    expect(
      planShot({ ...photo, faces: focusFaces(group, couple) }, FORMATS["9:16"], 4).kind,
    ).not.toBe("fit");
  });

  it("keeps every face where the couple is not named, or not among the framed", () => {
    expect(focusFaces(group, [])).toBe(group);
    const far = { x: 0.02, y: 0.02, w: 0.01, h: 0.015 };
    expect(focusFaces([...group, { ...face(0.02), ...far }], [far])).toHaveLength(6);
  });
});

describe("faceTiles", () => {
  it("lists the framed faces of each photo left to right, with their names", () => {
    const tiles = faceTiles([
      {
        id: "a",
        faces: [face(0.6), face(0.2), face(0.4, { score: 0.5 })],
        tags: [{ personId: "groom", ...box(face(0.6)) }],
      },
      { id: "b", faces: null, tags: [] },
    ]);
    expect(tiles.map((t) => [t.photoId, t.face.x, t.personId])).toEqual([
      ["a", 0.2, null],
      ["a", 0.6, "groom"],
    ]);
  });
});

describe("seriesMatches", () => {
  const T = Date.UTC(2026, 8, 19, 15, 0);
  const shot = (
    id: string,
    seconds: number,
    x: number | null,
    over: Partial<SeriesPhoto> = {},
  ) => ({
    id,
    takenAt: T + seconds * 1000,
    width: 3000,
    height: 2000,
    faces: x === null ? [] : [face(x), face(0.7)],
    tags: [],
    ...over,
  });

  it("follows the face through a burst either side, while it stays in place", () => {
    const photos = [
      shot("a", 0, 0.2),
      shot("b", 2, 0.205),
      shot("c", 4, 0.21),
      shot("d", 6, 0.215),
      shot("e", 8, 0.5), // moved away: the series ends here
    ];
    const found = seriesMatches(photos, "c", box(face(0.21)), "bride");
    expect(found.map((m) => [m.photoId, m.face.x])).toEqual([
      ["b", 0.205],
      ["a", 0.2],
      ["d", 0.215],
    ]);
  });

  it("stops at a pause, a turn of the camera, or where the person is already named", () => {
    const named = { personId: "bride", ...box(face(0.2)) };
    expect(
      seriesMatches([shot("a", 0, 0.2), shot("b", 60, 0.2)], "a", box(face(0.2)), "bride"),
    ).toEqual([]);
    expect(
      seriesMatches(
        [shot("a", 0, 0.2), shot("b", 2, 0.2, { width: 2000, height: 3000 })],
        "a",
        box(face(0.2)),
        "bride",
      ),
    ).toEqual([]);
    expect(
      seriesMatches(
        [shot("a", 0, 0.2), shot("b", 2, 0.2, { tags: [named] })],
        "a",
        box(face(0.2)),
        "bride",
      ),
    ).toEqual([]);
  });

  it("leaves a face someone else holds", () => {
    const groom = { personId: "groom", ...box(face(0.2)) };
    expect(
      seriesMatches(
        [shot("a", 0, 0.2), shot("b", 2, 0.2, { tags: [groom] })],
        "a",
        box(face(0.2)),
        "bride",
      ),
    ).toEqual([]);
  });
});
