import { describe, expect, it } from "vitest";
import { scrubPath } from "./umami-scrub";

describe("scrubPath", () => {
  it("redacts the token of a gallery and an event link", () => {
    expect(scrubPath("/g/AbCdEfGhIjKlMnOpQrSt")).toBe("/g/[token]");
    expect(scrubPath("/s/AbCdEfGhIjKlMnOpQrSt/svatba-pavel")).toBe("/s/[token]/svatba-pavel");
  });
  it("drops query and hash", () => {
    expect(scrubPath("/g/AbCdEfGhIjKlMnOpQrSt?pw=secret#x")).toBe("/g/[token]");
  });
  it("leaves other paths alone", () => {
    expect(scrubPath("/navod")).toBe("/navod");
    expect(scrubPath("/g/short")).toBe("/g/short");
  });
});
