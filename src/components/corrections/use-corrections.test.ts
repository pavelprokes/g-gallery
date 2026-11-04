import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCorrections, type Correction } from "@/components/corrections/use-corrections";
import {
  correctionDraftKey,
  writeCorrectionDraft,
} from "@/components/corrections/corrections-helpers";

function comment(id: string, photoId: string, body: string): Correction {
  const at = "2026-11-04T10:00:00.000Z";
  return { id, photoId, body, x: 0.5, y: 0.5, resolvedAt: null, createdAt: at, updatedAt: at };
}

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("useCorrections", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
  });

  async function entered() {
    const hook = renderHook(() => useCorrections("tok", true));
    fetchMock
      .mockResolvedValueOnce(json(200, { session: "key1", ttlMs: 7_200_000 }))
      .mockResolvedValueOnce(json(200, { comments: [] }));
    await act(async () => {
      expect(await hook.result.current.enter("123456")).toEqual({ ok: true });
    });
    return hook;
  }

  it("keeps a comment the expired key turned away and sends it after the PIN", async () => {
    const { result } = await entered();
    const draftKey = correctionDraftKey("g1", "p1");
    writeCorrectionDraft(draftKey, "Vyretušovat pupínek");

    fetchMock.mockResolvedValueOnce(json(401, { error: "session" }));
    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.create("p1", "Vyretušovat pupínek", 0.5, 0.5, draftKey);
    });
    expect(outcome).toBe("session");
    expect(result.current.active).toBe(false);
    expect(result.current.expired).toBe(true);
    // The text is still there while the PIN is asked for.
    expect(window.sessionStorage.getItem(draftKey)).toBe("Vyretušovat pupínek");

    const saved = comment("c1", "p1", "Vyretušovat pupínek");
    fetchMock
      .mockResolvedValueOnce(json(200, { session: "key2", ttlMs: 7_200_000 }))
      .mockResolvedValueOnce(json(200, { comments: [] }))
      .mockResolvedValueOnce(json(200, { comment: saved }));
    await act(async () => {
      expect(await result.current.enter("123456")).toEqual({ ok: true });
    });

    const retry = fetchMock.mock.calls.at(-1)!;
    expect(JSON.parse(retry[1].body as string)).toEqual({
      action: "create",
      photoId: "p1",
      body: "Vyretušovat pupínek",
      x: 0.5,
      y: 0.5,
      session: "key2",
    });
    expect(result.current.byPhoto.get("p1")).toEqual([saved]);
    expect(window.sessionStorage.getItem(draftKey)).toBeNull();
  });

  it("keeps the draft when the retry fails too", async () => {
    const { result } = await entered();
    const draftKey = correctionDraftKey("g1", "p1");
    writeCorrectionDraft(draftKey, "text");
    fetchMock.mockResolvedValueOnce(json(401, {}));
    await act(async () => {
      await result.current.create("p1", "text", null, null, draftKey);
    });
    fetchMock
      .mockResolvedValueOnce(json(200, { session: "key2", ttlMs: 7_200_000 }))
      .mockResolvedValueOnce(json(200, { comments: [] }))
      .mockResolvedValueOnce(json(500, {}));
    await act(async () => {
      await result.current.enter("123456");
    });
    expect(result.current.active).toBe(true);
    expect(result.current.byPhoto.size).toBe(0);
    expect(window.sessionStorage.getItem(draftKey)).toBe("text");
  });

  it("drops the draft once a comment is saved", async () => {
    const { result } = await entered();
    const draftKey = correctionDraftKey("g1", "p1");
    writeCorrectionDraft(draftKey, "text");
    fetchMock.mockResolvedValueOnce(json(200, { comment: comment("c1", "p1", "text") }));
    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.create("p1", "text", null, null, draftKey);
    });
    expect(outcome).toBe("ok");
    expect(window.sessionStorage.getItem(draftKey)).toBeNull();
  });

  it("reports any other failure as an error and keeps the mode", async () => {
    const { result } = await entered();
    fetchMock.mockResolvedValueOnce(json(500, {}));
    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.create("p1", "text", null, null);
    });
    expect(outcome).toBe("error");
    expect(result.current.active).toBe(true);
  });
});
