import { describe, expect, it } from "vitest";
import { parseAspect, planCrop, type CropPhoto, type CropRequest } from "@/lib/photo-crop";
import type { Face } from "@/lib/social-video/faces";

/** A face `w` wide (share of the photo's width) centred on `cx`, top at `top`. */
function face(photo: { width: number; height: number }, cx: number, top: number, w: number): Face {
  const h = (w * 1.3 * photo.width) / photo.height;
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

const LANDSCAPE = { width: 3000, height: 2000 };
const PORTRAIT = { width: 2000, height: 3000 };

function photo(size: { width: number; height: number }, extra: Partial<CropPhoto> = {}): CropPhoto {
  return { ...size, faces: [], focus: null, coupleTags: [], ...extra };
}

const social: CropRequest = {
  aspect: 4 / 5,
  framing: "photo",
  maxWidth: 1080,
  maxHeight: null,
  allowUpscale: false,
};

describe("parseAspect", () => {
  it("reads named, custom and original aspects", () => {
    expect(parseAspect("4:5")).toBeCloseTo(0.8);
    expect(parseAspect("1.91:1")).toBeCloseTo(1.91);
    expect(parseAspect("5:4")).toBeCloseTo(1.25);
    expect(parseAspect("original")).toBeNull();
    for (const bad of ["abc", "10:1", "1:0", "4/5", "-1:2"]) {
      expect(() => parseAspect(bad)).toThrow();
    }
  });
});

describe("planCrop", () => {
  it("keeps as much of the photo as the aspect allows, sized to the output", () => {
    const plan = planCrop(photo(LANDSCAPE), social);
    expect(plan.rect).toEqual({ x: 700, y: 0, w: 1600, h: 2000 });
    expect(plan.output).toEqual({ width: 1080, height: 1350 });
    expect(plan.aim).toBe("default");
    expect(plan.warnings).toEqual([]);
  });

  it("keeps the upper third of a faceless portrait, where the heads usually are", () => {
    const plan = planCrop(photo(PORTRAIT), social);
    expect(plan.rect).toEqual({ x: 0, y: 0, w: 2000, h: 2500 });
  });

  it("follows the faces across a landscape photo", () => {
    const p = photo(LANDSCAPE);
    p.faces = [face(p, 0.78, 0.25, 0.06), face(p, 0.86, 0.27, 0.06)];
    const plan = planCrop(p, social);
    expect(plan.aim).toBe("faces");
    expect(plan.rect.x).toBe(1400);
    expect(plan.faces).toEqual({ framed: 2, cut: 0, coupleCut: 0 });
  });

  it("never cuts the top of a head to put the eyes on the line", () => {
    const p = photo(PORTRAIT);
    p.faces = [face(p, 0.5, 0.62, 0.12)];
    const plan = planCrop(p, social);
    const headTop = (0.62 - 0.12 * 1.3 * (2000 / 3000) * 0.8) * 3000;
    expect(plan.rect.y).toBeLessThanOrEqual(headTop);
    expect(plan.rect.y + plan.rect.h).toBeLessThanOrEqual(3000);
    expect(plan.faces.cut).toBe(0);
  });

  it("aims at the named couple in a group, and says who it cuts", () => {
    const p = photo(LANDSCAPE);
    const left = face(p, 0.08, 0.3, 0.05);
    const bride = face(p, 0.62, 0.3, 0.05);
    const groom = face(p, 0.7, 0.3, 0.05);
    const right = face(p, 0.95, 0.3, 0.05);
    p.faces = [left, bride, groom, right];
    const everyone = planCrop(p, social);
    expect(everyone.aim).toBe("faces");
    expect(everyone.faces.cut).toBeGreaterThan(0);
    expect(everyone.warnings[0]).toMatch(/usekne \d z 4 obličejů/);

    p.coupleTags = [bride, groom].map(({ x, y, w, h }) => ({ x, y, w, h }));
    const couple = planCrop(p, social);
    expect(couple.aim).toBe("couple");
    expect(couple.faces.coupleCut).toBe(0);
    const centre = (couple.rect.x + couple.rect.w / 2) / 3000;
    expect(centre).toBeCloseTo(0.66, 1);
  });

  it("warns when the couple itself does not fit", () => {
    const p = photo(LANDSCAPE);
    const bride = face(p, 0.1, 0.3, 0.05);
    const groom = face(p, 0.9, 0.3, 0.05);
    p.faces = [bride, groom];
    p.coupleTags = [bride, groom];
    expect(planCrop(p, social).warnings[0]).toMatch(/někoho z páru/);
  });

  it("frames a detail tightly around its sharp part, never below the output size", () => {
    const p = photo({ width: 6000, height: 4000 });
    p.focus = { x: 0.6, y: 0.6, w: 0.1, h: 0.1, strength: 20 };
    const plan = planCrop(p, { ...social, framing: "subject" });
    expect(plan.aim).toBe("focus");
    expect(plan.rect.w).toBe(1080);
    expect(plan.rect.h).toBe(1350);
    expect(plan.rect.x + plan.rect.w / 2).toBeCloseTo(3900, -1);
    expect(plan.rect.y + plan.rect.h / 2).toBeCloseTo(2600, -1);
    expect(plan.upscaled).toBe(false);
  });

  it("does not enlarge a small photo unless asked to", () => {
    const small = photo({ width: 800, height: 1000 });
    const plan = planCrop(small, social);
    expect(plan.output).toEqual({ width: 800, height: 1000 });
    expect(plan.warnings[0]).toMatch(/nezvětšuji/);
    const enlarged = planCrop(small, { ...social, allowUpscale: true });
    expect(enlarged.output).toEqual({ width: 1080, height: 1350 });
    expect(enlarged.upscaled).toBe(true);
  });

  it("resizes the whole photo within the limits when the aspect is its own", () => {
    const big = photo({ width: 6000, height: 4000 });
    const plan = planCrop(big, { ...social, aspect: null, maxWidth: 2048 });
    expect(plan.rect).toEqual({ x: 0, y: 0, w: 6000, h: 4000 });
    expect(plan.output).toEqual({ width: 2048, height: 1365 });
    const byHeight = planCrop(photo(PORTRAIT), {
      ...social,
      aspect: 9 / 16,
      maxWidth: null,
      maxHeight: 1920,
    });
    expect(byHeight.output).toEqual({ width: 1080, height: 1920 });
  });
});
