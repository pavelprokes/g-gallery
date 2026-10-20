import { describe, expect, it } from "vitest";
import {
  CORRECTION_SESSION_MS,
  generateCorrectionPin,
  isPinShaped,
  signCorrectionSession,
  verifyCorrectionSession,
} from "./correction-session";

describe("generateCorrectionPin", () => {
  it("is always six digits", () => {
    for (let i = 0; i < 200; i++) expect(isPinShaped(generateCorrectionPin())).toBe(true);
    expect(isPinShaped("12345")).toBe(false);
    expect(isPinShaped("12a456")).toBe(false);
  });
});

describe("correction sessions", () => {
  const now = 1_000_000;
  const { session } = signCorrectionSession("s", "link", "hash", now);

  it("open the mode for this link and PIN until they expire", () => {
    expect(verifyCorrectionSession("s", session, "link", "hash", now + 1000)).toBe(true);
    expect(verifyCorrectionSession("s", session, "link", "hash", now + CORRECTION_SESSION_MS)).toBe(
      false,
    );
  });

  it("die with a new PIN, on another link, or when tampered with", () => {
    expect(verifyCorrectionSession("s", session, "link", "new-hash", now)).toBe(false);
    expect(verifyCorrectionSession("s", session, "other", "hash", now)).toBe(false);
    const [expires, sig] = session.split(".");
    expect(verifyCorrectionSession("s", `${Number(expires) + 1}.${sig}`, "link", "hash", now)).toBe(
      false,
    );
    expect(verifyCorrectionSession("s", null, "link", "hash", now)).toBe(false);
    expect(verifyCorrectionSession("s", session, "link", null, now)).toBe(false);
  });
});
