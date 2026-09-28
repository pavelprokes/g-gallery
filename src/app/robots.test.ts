import { describe, expect, it } from "vitest";
import robots from "@/app/robots";

describe("robots", () => {
  // One `*` group and no Disallow, on purpose (the comment in robots.ts, and
  // docs/AI-VISIBILITY.md): a crawler obeys only its most specific group, so a
  // named group per AI bot would change nothing today and would silently escape
  // any rule added under `*` later.
  it("has a single allow-all group and points at the sitemap", () => {
    expect(robots()).toEqual({
      rules: { userAgent: "*", allow: "/" },
      sitemap: "https://photos.svatebni-fotograf-cechy.cz/sitemap.xml",
    });
  });
});
