import { describe, expect, it } from "vitest";
import { NAV_ITEMS, badgeLabel, isNavActive } from "@/lib/admin-nav";

describe("isNavActive", () => {
  it("matches the overview only on the overview itself", () => {
    expect(isNavActive("/admin", "/admin", true)).toBe(true);
    // The regression that matters: a prefix match here would leave "Přehled"
    // highlighted on every gallery, wedding and sign page in the portal.
    expect(isNavActive("/admin/g/abc", "/admin", true)).toBe(false);
    expect(isNavActive("/admin/updates", "/admin", true)).toBe(false);
  });

  it("matches a section by prefix", () => {
    expect(isNavActive("/admin/updates", "/admin/updates", false)).toBe(true);
    expect(isNavActive("/admin/updates/anything", "/admin/updates", false)).toBe(true);
    expect(isNavActive("/admin", "/admin/updates", false)).toBe(false);
  });

  it("never lights two items at once", () => {
    for (const pathname of ["/admin", "/admin/updates", "/admin/g/abc", "/admin/e/xyz/sign"]) {
      const active = NAV_ITEMS.filter((item) => isNavActive(pathname, item.href, item.exact));
      expect(active.length).toBeLessThanOrEqual(1);
    }
  });
});

describe("badgeLabel", () => {
  it("renders nothing when there is nothing unread", () => {
    expect(badgeLabel(0)).toBeNull();
    expect(badgeLabel(-1)).toBeNull();
  });

  it("caps the count so the pill cannot stretch the nav", () => {
    expect(badgeLabel(1)).toBe("1");
    expect(badgeLabel(99)).toBe("99");
    expect(badgeLabel(100)).toBe("99+");
  });
});
