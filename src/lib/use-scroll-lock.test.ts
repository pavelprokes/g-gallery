import { afterEach, describe, expect, it } from "vitest";
import { acquireScrollLock } from "@/lib/use-scroll-lock";

describe("acquireScrollLock", () => {
  const root = () => document.documentElement;

  afterEach(() => {
    root().style.overflow = "";
    root().style.paddingRight = "";
  });

  it("hides the root's overflow and puts it back on release", () => {
    root().style.overflow = "auto";
    const release = acquireScrollLock();
    expect(root().style.overflow).toBe("hidden");
    release();
    expect(root().style.overflow).toBe("auto");
  });

  // The name sheet opens over the lightbox: closing the sheet must not let the
  // grid scroll while the lightbox is still open.
  it("stays locked until the last of several stacked locks lets go", () => {
    const lightbox = acquireScrollLock();
    const sheet = acquireScrollLock();
    sheet();
    expect(root().style.overflow).toBe("hidden");
    lightbox();
    expect(root().style.overflow).toBe("");
  });

  it("ignores a second release of the same lock", () => {
    const first = acquireScrollLock();
    const second = acquireScrollLock();
    first();
    first();
    expect(root().style.overflow).toBe("hidden");
    second();
    expect(root().style.overflow).toBe("");
  });
});
