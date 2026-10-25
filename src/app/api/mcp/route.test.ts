import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveMcpCaller = vi.hoisted(() => vi.fn());
const handleMcpRequest = vi.hoisted(() => vi.fn());

vi.mock("@/lib/mcp/auth", () => ({ resolveMcpCaller }));
vi.mock("@/lib/mcp/server", () => ({
  handleMcpRequest,
  rpcError: (id: unknown, code: number, message: string) => ({
    jsonrpc: "2.0",
    id,
    error: { code, message },
  }),
}));

import { DELETE, GET, POST } from "./route";

const caller = { userId: "user_1", email: "pavel@example.test", origin: "http://localhost:3000" };

function post(body: string, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost:3000/api/mcp", {
    method: "POST",
    headers: { host: "localhost:3000", authorization: "Bearer t", ...headers },
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveMcpCaller.mockResolvedValue({ ok: true, caller });
  handleMcpRequest.mockResolvedValue({ status: 200, body: { jsonrpc: "2.0", id: 1, result: {} } });
});

describe("/api/mcp", () => {
  it("is POST only", async () => {
    for (const response of [GET(), DELETE()]) {
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST");
    }
  });

  it("challenges with the protected-resource metadata on 401", async () => {
    resolveMcpCaller.mockResolvedValue({
      ok: false,
      status: 401,
      message: "x",
      invalidToken: true,
    });
    const response = await POST(post("{}"));
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      'Bearer realm="g-gallery", error="invalid_token", error_description="The access token is invalid or expired", resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource/api/mcp", scope="mcp"',
    );
  });

  it("does not challenge a known account without the role", async () => {
    resolveMcpCaller.mockResolvedValue({
      ok: false,
      status: 403,
      message: "x",
      invalidToken: false,
    });
    const response = await POST(post("{}"));
    expect(response.status).toBe(403);
    expect(response.headers.get("www-authenticate")).toBeNull();
  });

  it("allows Claude, this site and no Origin; refuses any other", async () => {
    for (const origin of ["https://claude.ai", "http://localhost:5173"]) {
      expect((await POST(post("{}", { origin }))).status).toBe(200);
    }
    expect((await POST(post("{}"))).status).toBe(200);
    expect((await POST(post("{}", { origin: "https://evil.test" }))).status).toBe(403);
    expect(resolveMcpCaller).toHaveBeenCalledTimes(3);
  });

  it("refuses unparsable JSON, batches and oversized bodies", async () => {
    expect((await POST(post("{nope"))).status).toBe(400);
    expect((await POST(post("[]"))).status).toBe(400);
    expect((await POST(post(" ".repeat(2 * 1024 * 1024 + 1)))).status).toBe(413);
    expect(handleMcpRequest).not.toHaveBeenCalled();
  });

  it("passes the MCP headers through and answers notifications with an empty 202", async () => {
    handleMcpRequest.mockResolvedValue({ status: 202, body: null });
    const response = await POST(
      post('{"jsonrpc":"2.0","method":"notifications/initialized"}', {
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": "notifications/initialized",
      }),
    );
    expect(response.status).toBe(202);
    expect(await response.text()).toBe("");
    expect(handleMcpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        caller,
        headers: {
          protocolVersion: "2026-07-28",
          method: "notifications/initialized",
          name: undefined,
        },
      }),
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("hides internal errors", async () => {
    handleMcpRequest.mockRejectedValue(new Error("db down"));
    const response = await POST(post("{}"));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("db down");
  });
});
