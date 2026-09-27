import { describe, expect, it } from "vitest";
import { printEntries, printList } from "./print-export";

describe("printEntries", () => {
  it("keeps a single copy's name and prefixes the count otherwise, sorted by name", () => {
    expect(
      printEntries([
        { id: "p2", fileName: "b.jpg", quantity: 5 },
        { id: "p1", fileName: "a.jpg", quantity: 1 },
        { id: "p3", fileName: "c.jpg", quantity: 0 },
      ]),
    ).toEqual([
      { id: "p1", name: "a.jpg", quantity: 1 },
      { id: "p2", name: "5x_b.jpg", quantity: 5 },
    ]);
  });

  it("tells apart photos that share a file name", () => {
    expect(
      printEntries([
        { id: "p2", fileName: "IMG_0001.jpg", quantity: 1 },
        { id: "p1", fileName: "IMG_0001.jpg", quantity: 2 },
      ]).map((entry) => entry.name),
    ).toEqual(["2x_IMG_0001_p1.jpg", "IMG_0001_p2.jpg"]);
  });

  it("reduces a guest-chosen name to a basename and never drops a photo", () => {
    expect(
      printEntries([
        { id: "p1", fileName: "../../x\r\n.jpg", quantity: 1 },
        { id: "p2", fileName: "dir/..", quantity: 1 },
      ]).map((entry) => entry.name),
    ).toEqual(["foto_p2.jpg", "x.jpg"]);
  });
});

describe("printList", () => {
  it("uses the same names as the downloaded files", () => {
    expect(printList([{ id: "p1", fileName: "b.jpg", quantity: 5 }])).toBe("5x_b.jpg — 5 ks");
  });
});
