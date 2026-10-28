import { afterEach, describe, expect, it, vi } from "vitest";
import { authorizeUrl, graphBase, INSTAGRAM_SCOPES } from "@/lib/instagram/config";

afterEach(() => vi.unstubAllEnvs());

describe("authorizeUrl", () => {
  it("asks for the Facebook Login scopes, with the code flow and the state", () => {
    const url = new URL(
      authorizeUrl({
        appId: "123",
        redirectUri: "https://x.test/api/instagram/callback",
        state: "s",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://www.facebook.com/v26.0/dialog/oauth");
    expect(url.searchParams.get("client_id")).toBe("123");
    expect(url.searchParams.get("redirect_uri")).toBe("https://x.test/api/instagram/callback");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("s");
    expect(url.searchParams.get("scope")).toBe(INSTAGRAM_SCOPES.join(","));
    expect(url.searchParams.has("config_id")).toBe(false);
  });

  it("uses a Facebook Login for Business configuration instead of scopes when given", () => {
    const url = new URL(
      authorizeUrl({ appId: "1", redirectUri: "https://x.test/cb", state: "s", configId: "999" }),
    );
    expect(url.searchParams.get("config_id")).toBe("999");
    expect(url.searchParams.has("scope")).toBe(false);
  });
});

describe("graphBase", () => {
  it("is Graph v26.0 unless told otherwise", () => {
    expect(graphBase()).toBe("https://graph.facebook.com/v26.0");
    vi.stubEnv("META_GRAPH_VERSION", "v27.0");
    vi.stubEnv("META_GRAPH_BASE_URL", "http://localhost:4010/");
    expect(graphBase()).toBe("http://localhost:4010/v27.0");
  });
});
