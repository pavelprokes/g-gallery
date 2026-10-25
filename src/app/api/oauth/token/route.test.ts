import { beforeEach, describe, expect, it, vi } from "vitest";

const grantTokens = vi.hoisted(() => vi.fn());
vi.mock("@/lib/mcp/oauth/token-grant", () => ({ grantTokens }));

import { POST } from "./route";

function post(body: string, contentType = "application/x-www-form-urlencoded"): Request {
  return new Request("http://localhost:3000/api/oauth/token", {
    method: "POST",
    headers: { host: "localhost:3000", "content-type": contentType },
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  grantTokens.mockResolvedValue({ status: 200, body: { access_token: "gga_x" } });
});

describe("/api/oauth/token", () => {
  it("passes the known form parameters to the grant, nothing else", async () => {
    const response = await POST(
      post("grant_type=refresh_token&refresh_token=ggr_x&client_id=c&extra=1"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(grantTokens).toHaveBeenCalledWith(
      { grant_type: "refresh_token", refresh_token: "ggr_x", client_id: "c" },
      "http://localhost:3000",
    );
  });

  it("refuses JSON, a repeated parameter and an oversized one", async () => {
    expect((await POST(post("{}", "application/json"))).status).toBe(400);
    expect((await POST(post("grant_type=a&grant_type=b"))).status).toBe(400);
    expect((await POST(post(`code=${"x".repeat(3000)}`))).status).toBe(400);
    expect(grantTokens).not.toHaveBeenCalled();
  });
});
