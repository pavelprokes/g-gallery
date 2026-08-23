import { describe, expect, it } from "vitest";
import { compositeToken, splitEventToken } from "./event-token";

describe("splitEventToken", () => {
  it("returns null for a plain share token", () => {
    // base64url alphabet — the separator can never occur inside one.
    expect(splitEventToken("-va8I3IzPVLyNLDnfcyS_Q")).toBeNull();
  });

  it("splits a composite token at the first separator", () => {
    expect(splitEventToken("evToken~kompletni")).toEqual({
      eventToken: "evToken",
      eventKey: "kompletni",
    });
  });

  it("refuses a token with an empty half", () => {
    expect(splitEventToken("~kompletni")).toBeNull();
    expect(splitEventToken("evToken~")).toBeNull();
    expect(splitEventToken("~")).toBeNull();
  });

  it("refuses a second separator rather than guessing which half is the key", () => {
    expect(splitEventToken("evToken~a~b")).toBeNull();
  });

  it("round-trips what compositeToken builds", () => {
    const token = compositeToken("-va8I3IzPVLyNLDnfcyS_Q", "prvni-vyber");
    expect(splitEventToken(token)).toEqual({
      eventToken: "-va8I3IzPVLyNLDnfcyS_Q",
      eventKey: "prvni-vyber",
    });
  });
});
