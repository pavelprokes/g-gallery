import { describe, expect, it } from "vitest";
import { newestLiveShareUrl } from "./live-share-url";

const now = new Date("2026-10-20T12:00:00Z");
const link = (
  url: string | null,
  revokedAt: Date | null = null,
  expiresAt: Date | null = null,
) => ({
  url,
  revokedAt,
  expiresAt,
});

describe("newestLiveShareUrl", () => {
  it("takes the first live link, skipping revoked, expired and unreadable ones", () => {
    expect(
      newestLiveShareUrl(
        [
          link("/g/revoked", new Date("2026-10-01")),
          link("/g/expired", null, new Date("2026-10-19")),
          link(null),
          link("/g/live", null, new Date("2026-12-01")),
          link("/g/older"),
        ],
        true,
        now,
      ),
    ).toBe("/g/live");
  });

  it("is null for a draft, or with no live link", () => {
    expect(newestLiveShareUrl([link("/g/live")], false, now)).toBeNull();
    expect(newestLiveShareUrl([link("/g/x", new Date("2026-10-01"))], true, now)).toBeNull();
  });
});
