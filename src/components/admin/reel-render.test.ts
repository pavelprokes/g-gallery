import { describe, expect, it } from "vitest";
import { beatsInVideo, drawBeatFlash } from "@/components/admin/reel-render";

function flashedAt(flashes: number[], t: number): boolean {
  let filled = false;
  const ctx = {
    globalAlpha: 1,
    fillStyle: "",
    fillRect: () => (filled = true),
  } as unknown as CanvasRenderingContext2D;
  drawBeatFlash(ctx, flashes, t, 10, 10);
  return filled;
}

describe("the sync test's flash", () => {
  it("keeps the beats inside the video, in its own time", () => {
    expect(beatsInVideo([0.5, 1, 1.5, 9], 1, 2)).toEqual([0, 0.5]);
  });

  it("lights the frame nearest the beat and the one after, nothing else", () => {
    const beat = 1.905; // between the frames at 1.9 and 1.9333
    const frames = Array.from({ length: 90 }, (_, f) => f / 30);
    const lit = frames.filter((t) => flashedAt([beat], t)).map((t) => Math.round(t * 30));
    expect(lit).toEqual([57, 58]);
  });
});
