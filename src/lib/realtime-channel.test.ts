import { afterEach, describe, expect, it, vi } from "vitest";
import {
  channelForGallery,
  distinctViewers,
  realtimeConfig,
  type PresenceState,
} from "./realtime-channel";

describe("channelForGallery", () => {
  it("never contains the gallery id itself", async () => {
    // A Realtime topic is visible to everyone on the channel.
    const galleryId = "cmt5snm2q00005i2bvjzgv2pf";
    expect(await channelForGallery(galleryId)).not.toContain(galleryId);
  });

  it("is stable for the same gallery", async () => {
    expect(await channelForGallery("abc")).toBe(await channelForGallery("abc"));
  });

  it("differs for different galleries", async () => {
    expect(await channelForGallery("abc")).not.toBe(await channelForGallery("abd"));
  });

  it("is a short prefixed hex topic", async () => {
    expect(await channelForGallery("abc")).toMatch(/^g:[0-9a-f]{16}$/);
  });

  it("does not depend on which link reached the gallery", async () => {
    // The reason this is keyed on the gallery at all: one gallery can be
    // reached by two share links, or by a link and a wedding-page card, and
    // those audiences must not count each other as absent.
    const viaOneLink = await channelForGallery("gal_1");
    const viaAnother = await channelForGallery("gal_1");
    expect(viaOneLink).toBe(viaAnother);
  });
});

describe("realtimeConfig", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is null unless both public vars are set", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    expect(realtimeConfig()).toBeNull();

    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://x.supabase.co");
    expect(realtimeConfig()).toBeNull();
  });

  it("is returned when both are present", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://x.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    expect(realtimeConfig()).toEqual({ url: "https://x.supabase.co", anonKey: "anon" });
  });
});

describe("distinctViewers", () => {
  const state = (entries: Record<string, PresenceState[]>) => entries;

  it("counts people, not connections", () => {
    // One person with three tabs open must not read as three viewers.
    const result = distinctViewers(
      state({
        a: [{ viewerKey: "v1", name: "Petra" }],
        b: [{ viewerKey: "v1", name: "Petra" }],
        c: [{ viewerKey: "v1", name: null }],
      }),
    );
    expect(result.count).toBe(1);
    expect(result.names).toEqual(["Petra"]);
  });

  it("counts separate people separately", () => {
    const result = distinctViewers(
      state({
        a: [{ viewerKey: "v1", name: "Petra" }],
        b: [{ viewerKey: "v2", name: "Jan" }],
      }),
    );
    expect(result.count).toBe(2);
    expect(result.names.sort()).toEqual(["Jan", "Petra"]);
  });

  it("keeps anonymous viewers in the count but not in the names", () => {
    const result = distinctViewers(state({ a: [{ viewerKey: "v1", name: null }] }));
    expect(result.count).toBe(1);
    expect(result.names).toEqual([]);
  });

  it("ignores malformed entries rather than counting them", () => {
    const result = distinctViewers(
      state({ a: [{ viewerKey: "", name: "Ghost" } as PresenceState] }),
    );
    expect(result.count).toBe(0);
  });

  it("is zero for an empty channel", () => {
    expect(distinctViewers({})).toEqual({ count: 0, names: [] });
  });
});
