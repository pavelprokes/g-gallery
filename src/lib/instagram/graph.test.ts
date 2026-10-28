import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  containerStatus,
  createReelContainer,
  GraphError,
  pagesOf,
  searchAudio,
} from "@/lib/instagram/graph";

const calls: { url: string; init?: RequestInit }[] = [];

function respond(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status });
    }),
  );
}

beforeEach(() => {
  calls.length = 0;
  vi.stubEnv("META_APP_ID", "app-1");
  vi.stubEnv("META_APP_SECRET", "secret-1");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("searchAudio", () => {
  it("asks /ig_audio for the account and reads Meta's fields", async () => {
    respond(200, {
      audio: [
        {
          audio_id: "587784541076604123",
          audio_type: "music",
          title: "Birthday Wish",
          display_artist: "Shuba",
          duration_in_ms: 153760,
          cover_artwork_thumbnail_uri: "https://cdn.example/artwork",
          download_url: "https://cdn.example/preview",
          on_platform_audio_preview_link: "https://www.instagram.com/audio/123",
          is_ads_eligible: false,
        },
        { audio_id: 42, audio_type: 1, ig_username: "creator", download_url: null },
        { title: "no id — dropped" },
      ],
      paging: { cursors: { after: "x" } },
    });
    const items = await searchAudio("ig-9", "tok", { kind: "music", query: " waltz " });
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe("/v26.0/ig_audio");
    expect(url.searchParams.get("user_id")).toBe("ig-9");
    expect(url.searchParams.get("audio_type")).toBe("music");
    expect(url.searchParams.get("search_query")).toBe("waltz");
    expect(url.searchParams.get("access_token")).toBe("tok");
    expect(url.searchParams.get("appsecret_proof")).toBe(
      createHmac("sha256", "secret-1").update("tok").digest("hex"),
    );
    expect(items).toEqual([
      {
        audioId: "587784541076604123",
        type: "music",
        title: "Birthday Wish",
        artist: "Shuba",
        durationMs: 153760,
        downloadUrl: "https://cdn.example/preview",
        coverUrl: "https://cdn.example/artwork",
        instagramUrl: "https://www.instagram.com/audio/123",
        adsEligible: false,
      },
      {
        audioId: "42",
        type: "1",
        title: "creator",
        artist: null,
        durationMs: null,
        downloadUrl: null,
        coverUrl: null,
        instagramUrl: null,
        adsEligible: null,
      },
    ]);
  });

  it("leaves out the query for what is trending, and reads a `data` list too", async () => {
    respond(200, { data: [{ audio_id: "1", title: "T" }] });
    const items = await searchAudio("ig-9", "tok", { kind: "original_sound" });
    expect(new URL(calls[0]!.url).searchParams.has("search_query")).toBe(false);
    expect(items.map((i) => i.audioId)).toEqual(["1"]);
  });
});

describe("errors", () => {
  it("keeps Meta's code, and knows an expired token", async () => {
    respond(400, {
      error: {
        message: "Error validating access token",
        type: "OAuthException",
        code: 190,
        error_subcode: 463,
      },
    });
    const error = await searchAudio("ig", "tok", { kind: "music" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GraphError);
    expect((error as GraphError).tokenInvalid).toBe(true);
    expect((error as GraphError).subcode).toBe(463);
  });

  it("refuses a response it does not recognise rather than guessing", async () => {
    respond(200, { id: "c1", status_code: "SOMETHING_NEW" });
    await expect(containerStatus("1", "tok")).rejects.toBeInstanceOf(GraphError);
  });
});

describe("createReelContainer", () => {
  it("posts a Reel with the public video and Instagram's track as JSON", async () => {
    respond(200, { id: "1789" });
    const result = await createReelContainer("ig-9", "tok", {
      videoUrl: "https://cdn.test/reels/a.mp4",
      caption: "Svatba",
      audio: { audioId: "587", audioVolume: 100, videoVolume: 0 },
    });
    expect(result.id).toBe("1789");
    expect(calls[0]!.url).toBe("https://graph.facebook.com/v26.0/ig-9/media");
    expect(calls[0]!.init?.method).toBe("POST");
    const body = new URLSearchParams(String(calls[0]!.init?.body));
    expect(body.get("media_type")).toBe("REELS");
    expect(body.get("video_url")).toBe("https://cdn.test/reels/a.mp4");
    expect(body.get("caption")).toBe("Svatba");
    expect(JSON.parse(body.get("audio_configuration")!)).toEqual({
      audio_id: "587",
      audio_volume: 100,
      video_volume: 0,
    });
  });

  it("sends no audio configuration for a reel with its own sound", async () => {
    respond(200, { id: "1" });
    await createReelContainer("ig", "tok", { videoUrl: "https://cdn.test/v.mp4", caption: "" });
    expect(new URLSearchParams(String(calls[0]!.init?.body)).has("audio_configuration")).toBe(
      false,
    );
  });
});

describe("pagesOf", () => {
  it("reads each Page's token and linked Instagram account", async () => {
    respond(200, {
      data: [
        { id: "p1", name: "Stránka bez IG", access_token: "pt1" },
        {
          id: "p2",
          name: "Fotograf",
          access_token: "pt2",
          instagram_business_account: { id: "ig-2", username: "foto" },
        },
      ],
    });
    const pages = await pagesOf("user-tok");
    expect(new URL(calls[0]!.url).searchParams.get("fields")).toBe(
      "id,name,access_token,instagram_business_account{id,username}",
    );
    expect(pages[1]!.instagram_business_account).toEqual({ id: "ig-2", username: "foto" });
  });
});
