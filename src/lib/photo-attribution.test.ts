import { describe, expect, it } from "vitest";
import { uploaderNameOf } from "./photo-attribution";

describe("uploaderNameOf", () => {
  const guest = (displayName: string | null, optedOut = false) => ({
    source: "GUEST" as const,
    uploadedBy: { displayName, optedOut },
  });

  it("credits a guest photo to the name its uploader volunteered", () => {
    expect(uploaderNameOf(guest("Petra"))).toBe("Petra");
  });

  it("gives the photographer's own photos no credit", () => {
    expect(
      uploaderNameOf({ source: "OWNER", uploadedBy: { displayName: "Pavel", optedOut: false } }),
    ).toBeNull();
  });

  it("stays silent for a guest who gave no name, or whose viewer row is gone", () => {
    expect(uploaderNameOf(guest(null))).toBeNull();
    expect(uploaderNameOf(guest("   "))).toBeNull();
    expect(uploaderNameOf({ source: "GUEST", uploadedBy: null })).toBeNull();
  });

  it("drops the name of a guest who opted out after naming themselves", () => {
    expect(uploaderNameOf(guest("Petra", true))).toBeNull();
  });
});
