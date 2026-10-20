import { describe, expect, it } from "vitest";
import { FORMATS } from "@/lib/social-video/camera";
import { isAcross, shotsFor } from "@/lib/social-video/shots";
import { buildTimeline } from "@/lib/social-video/timeline";

const landscape = { id: "l", width: 3000, height: 2000 };
const portrait = { id: "p", width: 2000, height: 3000 };
const square = { id: "s", width: 2000, height: 1900 };

describe("isAcross", () => {
  it("is a landscape photo in a vertical video and a portrait one in a landscape video", () => {
    expect(isAcross(landscape, FORMATS["9:16"])).toBe(true);
    expect(isAcross(portrait, FORMATS["9:16"])).toBe(false);
    expect(isAcross(portrait, FORMATS["16:9"])).toBe(true);
    expect(isAcross(landscape, FORMATS["16:9"])).toBe(false);
  });

  it("leaves a near-square photo to the camera", () => {
    expect(isAcross(square, FORMATS["9:16"])).toBe(false);
    expect(isAcross(square, FORMATS["16:9"])).toBe(false);
  });
});

describe("shotsFor with fitAcross", () => {
  const photos = [landscape, portrait, square];
  const timeline = buildTimeline(photos.length, 10);

  it("shows the photos turned the other way whole and moves the camera on the rest", () => {
    const vertical = shotsFor(photos, {}, FORMATS["9:16"], timeline, { fitAcross: true });
    expect(vertical[0]).toEqual({
      kind: "fit",
      from: { x: 0, y: 0, w: 3000, h: 2000 },
      to: { x: 0, y: 0, w: 3000, h: 2000 },
    });
    expect(vertical[1]!.kind).not.toBe("fit");

    const horizontal = shotsFor(photos, {}, FORMATS["16:9"], timeline, { fitAcross: true });
    expect(horizontal[1]!.kind).toBe("fit");
    expect(horizontal[0]!.kind).not.toBe("fit");
  });

  it("cuts every photo to the video's shape without it, as the studio does", () => {
    const shots = shotsFor(photos, {}, FORMATS["9:16"], timeline);
    expect(shots.some((s) => s.kind === "fit")).toBe(false);
  });
});
