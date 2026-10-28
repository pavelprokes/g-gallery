import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const account = vi.hoisted(() => ({
  current: null as null | {
    igUserId: string;
    igUsername: string;
    pageName: string;
    token: string;
    expiresAt: null;
  },
}));

vi.mock("@/lib/auth-guard", () => ({ requireAdmin: async () => ({ user: { id: "owner-1" } }) }));
vi.mock("@/lib/instagram/connection", () => ({
  instagramAccount: async () => account.current,
  disconnect: async () => {},
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { searchInstagramAudio } from "@/app/admin/instagram-actions";

beforeEach(() => {
  account.current = {
    igUserId: "ig-9",
    igUsername: "foto",
    pageName: "P",
    token: "tok",
    expiresAt: null,
  };
  vi.stubEnv("META_APP_ID", "app");
  vi.stubEnv("META_APP_SECRET", "secret");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("searchInstagramAudio", () => {
  it("searches as the connected account", async () => {
    const fetch = vi.fn<(url: string) => Promise<Response>>(
      async () => new Response(JSON.stringify({ audio: [{ audio_id: "1", title: "T" }] })),
    );
    vi.stubGlobal("fetch", fetch);
    const result = await searchInstagramAudio({ kind: "music", query: "waltz" });
    expect(result).toMatchObject({ ok: true, items: [{ audioId: "1", title: "T" }] });
    const url = new URL(String(fetch.mock.calls[0]![0]));
    expect(url.searchParams.get("user_id")).toBe("ig-9");
  });

  it("says what is wrong instead of throwing into the page", async () => {
    expect(await searchInstagramAudio({ kind: "anything" as "music", query: "x" })).toMatchObject({
      ok: false,
    });
    expect(await searchInstagramAudio({ kind: "music", query: "x".repeat(101) })).toMatchObject({
      ok: false,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    expect(await searchInstagramAudio({ kind: "music" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("neodpovídá"),
    });
  });

  it("asks to connect when there is no account", async () => {
    account.current = null;
    expect(await searchInstagramAudio({ kind: "music" })).toMatchObject({
      ok: false,
      reconnect: true,
    });
  });

  it("turns an expired token into 'connect again'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: "expired", code: 190 } }), {
            status: 400,
          }),
      ),
    );
    expect(await searchInstagramAudio({ kind: "music" })).toMatchObject({
      ok: false,
      reconnect: true,
    });
  });
});
