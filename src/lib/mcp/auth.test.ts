import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadAdminCaller = vi.hoisted(() => vi.fn());
const findGrantForAccessToken = vi.hoisted(() => vi.fn());

vi.mock("./caller", () => ({ loadAdminCaller }));
vi.mock("./oauth/token-grant", () => ({ findGrantForAccessToken }));

import { resolveMcpCaller } from "./auth";

const ISSUER = "http://localhost:3000";
const DEV_TOKEN = "d".repeat(40);
const bearer = (token: string) => new Headers({ authorization: `Bearer ${token}` });

beforeEach(() => {
  vi.clearAllMocks();
  loadAdminCaller.mockResolvedValue({ userId: "user_1", email: "pavel@example.test" });
  findGrantForAccessToken.mockResolvedValue(null);
  vi.stubEnv("MCP_DEV_TOKEN", DEV_TOKEN);
  vi.stubEnv("MCP_DEV_EMAIL", "pavel@example.test");
  vi.stubEnv("VERCEL_ENV", "");
});

afterEach(() => vi.unstubAllEnvs());

describe("resolveMcpCaller", () => {
  it("asks for a token when there is none", async () => {
    expect(await resolveMcpCaller(new Headers(), ISSUER)).toMatchObject({
      ok: false,
      status: 401,
      invalidToken: false,
    });
  });

  it("accepts the development token as MCP_DEV_EMAIL, re-checking the admin role", async () => {
    const result = await resolveMcpCaller(bearer(DEV_TOKEN), ISSUER);
    expect(result).toEqual({
      ok: true,
      caller: { userId: "user_1", email: "pavel@example.test", origin: ISSUER },
    });
    expect(loadAdminCaller).toHaveBeenCalledWith({ email: "pavel@example.test" });
  });

  it("never accepts the development token in production, or a short one", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect(await resolveMcpCaller(bearer(DEV_TOKEN), ISSUER)).toMatchObject({
      status: 401,
      invalidToken: true,
    });

    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("MCP_DEV_TOKEN", "short");
    expect(await resolveMcpCaller(bearer("short"), ISSUER)).toMatchObject({ status: 401 });
  });

  it("resolves an OAuth access token through its grant", async () => {
    findGrantForAccessToken.mockResolvedValue({ userId: "user_1" });
    const result = await resolveMcpCaller(bearer("gga_token"), ISSUER);
    expect(result.ok).toBe(true);
    expect(findGrantForAccessToken).toHaveBeenCalledWith("gga_token", ISSUER);
    expect(loadAdminCaller).toHaveBeenCalledWith({ id: "user_1" });
  });

  it("forbids a valid token whose account is no longer an admin", async () => {
    findGrantForAccessToken.mockResolvedValue({ userId: "user_1" });
    loadAdminCaller.mockResolvedValue(null);
    expect(await resolveMcpCaller(bearer("gga_token"), ISSUER)).toMatchObject({
      ok: false,
      status: 403,
    });
  });
});
