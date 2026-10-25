import { describe, expect, it } from "vitest";
import { jsonResult } from "./tool";

describe("jsonResult", () => {
  it("carries the same value as unindented text and as structured content", () => {
    const value = { photos: [{ id: "p1", fileName: "svatba_0001.jpg" }], total: 1 };
    const result = jsonResult(value);
    expect(result.structuredContent).toBe(value);
    expect(result.content).toEqual([{ type: "text", text: JSON.stringify(value) }]);
    expect(result.content[0]?.text).not.toContain("\n");
  });
});
