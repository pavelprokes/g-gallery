import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const account = vi.hoisted(() => ({
  current: {
    igUserId: "ig-9",
    igUsername: "foto",
    pageName: "P",
    token: "tok",
    expiresAt: null,
  } as null | {
    igUserId: string;
    igUsername: string;
    pageName: string;
    token: string;
    expiresAt: null;
  },
}));
const stored = vi.hoisted(() => ({ size: 5_000_000 as number | null }));

vi.mock("@/lib/auth-guard", () => ({ requireAdmin: async () => ({ user: { id: "owner-1" } }) }));
vi.mock("@/lib/instagram/connection", () => ({
  instagramAccount: async () => account.current,
  disconnect: async () => {},
}));
vi.mock("@/lib/r2", () => ({
  headObject: async () => (stored.size === null ? null : { sizeBytes: stored.size }),
  presignPut: async (key: string) => `https://r2.test/${key}?signed`,
  presignedPutHeaders: () => ({ "Content-Type": "video/mp4" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import {
  createInstagramReel,
  instagramReelStatus,
  prepareReelUpload,
  publishInstagramReel,
  searchInstagramAudio,
} from "@/app/admin/instagram-actions";

const NAME = "3f1c2b8e-9d4a-4c1b-8f2e-7a6b5c4d3e2f";
const requests: { url: string; body: string | null }[] = [];

function graph(responses: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url, body: init?.body ? String(init.body) : null });
      const path = new URL(url).pathname;
      const body = responses[path];
      return new Response(JSON.stringify(body ?? { error: { message: "no", code: 100 } }), {
        status: body ? 200 : 400,
      });
    }),
  );
}

beforeEach(() => {
  requests.length = 0;
  account.current = {
    igUserId: "ig-9",
    igUsername: "foto",
    pageName: "P",
    token: "tok",
    expiresAt: null,
  };
  stored.size = 5_000_000;
  vi.stubEnv("META_APP_ID", "app");
  vi.stubEnv("META_APP_SECRET", "secret");
  vi.stubEnv("NEXT_PUBLIC_IMAGE_TRANSFORM", "cloudflare");
  vi.stubEnv("NEXT_PUBLIC_PHOTOS_BASE_URL", "https://cdn.test");
  vi.stubEnv("NEXT_PUBLIC_MEDIA_BASE_URL", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("prepareReelUpload", () => {
  it("mints the key itself, under reels/", async () => {
    const target = await prepareReelUpload();
    expect(target.name).toMatch(/^[0-9a-f-]{36}$/);
    expect(target.url).toBe(`https://r2.test/reels/${target.name}.mp4?signed`);
  });
});

describe("createInstagramReel", () => {
  it("hands Meta the public address of the uploaded reel, with Instagram's track", async () => {
    graph({ "/v26.0/ig-9/media": { id: "17890" } });
    const result = await createInstagramReel({
      name: NAME,
      caption: "Svatba",
      audio: { audioId: "587", audioVolume: 100, videoVolume: 0 },
    });
    expect(result).toEqual({ ok: true, containerId: "17890" });
    const body = new URLSearchParams(requests[0]!.body!);
    expect(body.get("video_url")).toBe(`https://cdn.test/reels/${NAME}.mp4`);
    expect(body.get("audio_configuration")).toContain('"audio_id":"587"');
  });

  it("refuses a name it did not mint, before anything else", async () => {
    await expect(createInstagramReel({ name: "../photos/x", caption: "" })).rejects.toThrow();
    expect(requests).toHaveLength(0);
  });

  it("says when the upload never arrived or is too large for Instagram", async () => {
    stored.size = null;
    expect(await createInstagramReel({ name: NAME, caption: "" })).toMatchObject({ ok: false });
    stored.size = 301 * 1024 * 1024;
    expect(await createInstagramReel({ name: NAME, caption: "" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("300 MB"),
    });
  });

  it("asks to connect when there is no account", async () => {
    account.current = null;
    expect(await createInstagramReel({ name: NAME, caption: "" })).toMatchObject({
      ok: false,
      reconnect: true,
    });
  });
});

describe("status and publishing", () => {
  it("reports the container's state and publishes it with its link", async () => {
    graph({
      "/v26.0/17890": {
        id: "17890",
        status_code: "FINISHED",
        status: "Finished: Media has been uploaded",
      },
      "/v26.0/ig-9/media_publish": { id: "1801" },
      "/v26.0/1801": { id: "1801", permalink: "https://www.instagram.com/reel/abc/" },
    });
    expect(await instagramReelStatus("17890")).toEqual({
      ok: true,
      status: "FINISHED",
      detail: "Finished: Media has been uploaded",
    });
    expect(await publishInstagramReel("17890")).toEqual({
      ok: true,
      mediaId: "1801",
      permalink: "https://www.instagram.com/reel/abc/",
    });
  });

  it("only takes Meta's numeric ids", async () => {
    await expect(instagramReelStatus("../me")).rejects.toThrow();
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
