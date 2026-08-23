import { describe, expect, it } from "vitest";
import {
  eventCrumbs,
  eventSignCrumbs,
  galleryCrumbs,
  gallerySignCrumbs,
  updatesCrumbs,
} from "@/lib/admin-breadcrumbs";

const EVENT = { id: "evt1", title: "Anna a Petr" };
const HOSTED = { id: "gal1", title: "Reportáž", event: EVENT };
const STANDALONE = { id: "gal2", title: "Portréty", event: null };

/** Every trail starts at the overview, and only the last crumb is unlinked. */
function expectWellFormed(trail: ReturnType<typeof updatesCrumbs>) {
  expect(trail[0]).toEqual({ label: "Přehled", href: "/admin" });
  expect(trail[trail.length - 1]?.href).toBeUndefined();
  for (const crumb of trail.slice(0, -1)) expect(crumb.href).toBeTruthy();
}

describe("admin breadcrumbs", () => {
  it("labels the activity feed", () => {
    const trail = updatesCrumbs();
    expectWellFormed(trail);
    expect(trail.map((c) => c.label)).toEqual(["Přehled", "Aktivita"]);
  });

  it("routes a wedding-owned gallery through its wedding", () => {
    const trail = galleryCrumbs(HOSTED);
    expectWellFormed(trail);
    expect(trail.map((c) => c.label)).toEqual(["Přehled", "Anna a Petr", "Reportáž"]);
    expect(trail[1]?.href).toBe("/admin/e/evt1");
  });

  it("does not invent a wedding for a standalone gallery", () => {
    const trail = galleryCrumbs(STANDALONE);
    expectWellFormed(trail);
    expect(trail.map((c) => c.label)).toEqual(["Přehled", "Portréty"]);
  });

  it("appends the sign to its parent and re-links the parent", () => {
    const trail = gallerySignCrumbs(HOSTED);
    expectWellFormed(trail);
    expect(trail.map((c) => c.label)).toEqual([
      "Přehled",
      "Anna a Petr",
      "Reportáž",
      "Cedulka k tisku",
    ]);
    // The gallery was the current page one level up; here it has to be clickable.
    expect(trail[2]?.href).toBe("/admin/g/gal1");
  });

  it("builds the wedding trails", () => {
    expectWellFormed(eventCrumbs(EVENT));
    const sign = eventSignCrumbs(EVENT);
    expectWellFormed(sign);
    expect(sign.map((c) => c.label)).toEqual(["Přehled", "Anna a Petr", "Cedulka k tisku"]);
    expect(sign[1]?.href).toBe("/admin/e/evt1");
  });
});
