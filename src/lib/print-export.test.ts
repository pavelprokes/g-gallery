import { describe, expect, it } from "vitest";
import { printFileName, printList } from "./print-export";

describe("printList", () => {
  it("lists one line per photo, sorted by file name", () => {
    expect(
      printList([
        { fileName: "b.jpg", quantity: 5 },
        { fileName: "a.jpg", quantity: 1 },
      ]),
    ).toBe("a.jpg — 1 ks\nb.jpg — 5 ks");
  });
});

describe("printFileName", () => {
  it("keeps a single copy's name and prefixes the count otherwise", () => {
    expect(printFileName({ fileName: "a.jpg", quantity: 1 })).toBe("a.jpg");
    expect(printFileName({ fileName: "a.jpg", quantity: 5 })).toBe("5x_a.jpg");
  });

  it("reduces a guest-chosen name to a basename without control characters", () => {
    expect(printFileName({ fileName: "../../x\r\n.jpg", quantity: 1 })).toBe("x.jpg");
    expect(printFileName({ fileName: "dir/..", quantity: 1 })).toBeNull();
    expect(printFileName({ fileName: "a.jpg", quantity: 0 })).toBeNull();
  });
});
