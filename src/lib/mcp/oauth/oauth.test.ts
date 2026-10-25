import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Grant = Record<string, unknown> & { id: string };

const store = vi.hoisted(() => ({ grants: new Map<string, Grant>(), admin: true }));

vi.mock("./grant-store", () => ({
  findGrant: async (column: string, hash: string) =>
    [...store.grants.values()].find((grant) => grant[column] === hash) ?? null,
  insertGrant: async (grant: Record<string, unknown>) => {
    const id = `grant_${store.grants.size + 1}`;
    store.grants.set(id, {
      codeUsedAt: null,
      accessHash: null,
      accessExpiresAt: null,
      refreshHash: null,
      previousRefreshHash: null,
      refreshExpiresAt: null,
      refreshedAt: null,
      lastUsedAt: null,
      revokedAt: null,
      createdAt: new Date(),
      ...grant,
      id,
    });
  },
  updateGrant: async (
    id: string,
    guard: { column: string; value: unknown } | null,
    patch: object,
  ) => {
    const grant = store.grants.get(id);
    if (!grant || (guard && grant[guard.column] !== guard.value)) return false;
    store.grants.set(id, { ...grant, ...patch });
    return true;
  },
  pruneGrants: async () => undefined,
}));

vi.mock("../caller", () => ({
  loadAdminCaller: async () =>
    store.admin ? { userId: "user_1", email: "pavel@example.test" } : null,
}));

import { clearClientCache } from "./clients";
import {
  issueAuthorizationCode,
  parseAuthorizeRequest,
  type AuthorizeParams,
} from "./authorization";
import { authorizationServerMetadata, protectedResourceMetadata, publicOrigin } from "./config";
import { findGrantForAccessToken, grantTokens } from "./token-grant";

const ISSUER = "https://photos.example.test";
const CLAUDE_AI = "https://claude.ai/oauth/mcp-oauth-client-metadata";
const CLAUDE_CODE = "https://claude.ai/oauth/claude-code-client-metadata";
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const VERIFIER = "v".repeat(43) + "-verifier";
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");

function documentFor(clientId: string, redirectUris: string[]) {
  return JSON.stringify({
    client_id: clientId,
    client_name: "Claude",
    redirect_uris: redirectUris,
    token_endpoint_auth_method: "none",
  });
}

beforeEach(() => {
  store.grants.clear();
  store.admin = true;
  clearClientCache();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === CLAUDE_AI)
        return new Response(documentFor(CLAUDE_AI, [CALLBACK, "https://evil.test/cb"]));
      if (url === CLAUDE_CODE)
        return new Response(documentFor(CLAUDE_CODE, ["http://localhost/callback"]));
      return new Response("nope", { status: 404 });
    }),
  );
});

function params(overrides: AuthorizeParams = {}): AuthorizeParams {
  return {
    client_id: CLAUDE_AI,
    redirect_uri: CALLBACK,
    response_type: "code",
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    state: "st",
    resource: `${ISSUER}/api/mcp`,
    ...overrides,
  };
}

async function authorize(overrides: AuthorizeParams = {}) {
  const parsed = await parseAuthorizeRequest(params(overrides), ISSUER);
  if (!parsed.ok) throw new Error(parsed.message);
  const url = new URL(await issueAuthorizationCode(parsed.request, "user_1", ISSUER));
  return { url, code: url.searchParams.get("code")! };
}

async function exchange(code: string, extra: Record<string, string> = {}) {
  return grantTokens(
    {
      grant_type: "authorization_code",
      code,
      code_verifier: VERIFIER,
      client_id: CLAUDE_AI,
      redirect_uri: CALLBACK,
      ...extra,
    },
    ISSUER,
  );
}

describe("authorization request", () => {
  it("issues a code on the client's own callback, with state and iss", async () => {
    const { url, code } = await authorize();
    expect(`${url.origin}${url.pathname}`).toBe(CALLBACK);
    expect(url.searchParams.get("state")).toBe("st");
    expect(url.searchParams.get("iss")).toBe(ISSUER);
    expect(code).toMatch(/^ggc_/);
  });

  it("shows unknown clients and foreign return addresses on the page, never redirecting", async () => {
    const stranger = await parseAuthorizeRequest(
      params({ client_id: "https://evil.test/client.json" }),
      ISSUER,
    );
    expect(stranger).toMatchObject({ ok: false, redirectTo: null });
    expect(fetch).not.toHaveBeenCalledWith("https://evil.test/client.json", expect.anything());

    // The document lists it, but claude.ai may only ever return to its own callback.
    const listed = await parseAuthorizeRequest(
      params({ redirect_uri: "https://evil.test/cb" }),
      ISSUER,
    );
    expect(listed).toMatchObject({ ok: false, redirectTo: null });
  });

  it("lets Claude Code return to any loopback port, and nowhere else", async () => {
    const port = await parseAuthorizeRequest(
      params({ client_id: CLAUDE_CODE, redirect_uri: "http://localhost:53682/callback" }),
      ISSUER,
    );
    expect(port.ok).toBe(true);
    const remote = await parseAuthorizeRequest(
      params({ client_id: CLAUDE_CODE, redirect_uri: "https://claude.ai/api/mcp/auth_callback" }),
      ISSUER,
    );
    expect(remote).toMatchObject({ ok: false, redirectTo: null });
  });

  it("sends protocol errors back to the client", async () => {
    for (const [override, error] of [
      [{ code_challenge_method: "plain" }, "invalid_request"],
      [{ response_type: "token" }, "unsupported_response_type"],
      [{ scope: "admin" }, "invalid_scope"],
      [{ resource: "https://other.test/api/mcp" }, "invalid_target"],
    ] as const) {
      const parsed = await parseAuthorizeRequest(params(override), ISSUER);
      expect(parsed.ok).toBe(false);
      if (parsed.ok || !parsed.redirectTo) throw new Error("expected a redirect");
      expect(new URL(parsed.redirectTo).searchParams.get("error")).toBe(error);
    }
  });
});

describe("token endpoint", () => {
  it("exchanges a code once, with PKCE, for tokens bound to this server", async () => {
    const { code } = await authorize();
    const result = await exchange(code);
    expect(result.status).toBe(200);
    if (result.status !== 200) return;
    expect(result.body.access_token).toMatch(/^gga_/);
    expect(result.body.refresh_token).toMatch(/^ggr_/);
    expect(await findGrantForAccessToken(result.body.access_token, ISSUER)).toMatchObject({
      userId: "user_1",
    });
    expect(
      await findGrantForAccessToken(result.body.access_token, "https://other.test"),
    ).toBeNull();
  });

  it("revokes everything when a code is presented a second time", async () => {
    const { code } = await authorize();
    const first = await exchange(code);
    const second = await exchange(code);
    expect(second).toMatchObject({ status: 400, body: { error: "invalid_grant" } });
    if (first.status !== 200) throw new Error("first exchange failed");
    expect(await findGrantForAccessToken(first.body.access_token, ISSUER)).toBeNull();
  });

  it("refuses a wrong verifier, client or return address", async () => {
    const { code } = await authorize();
    expect(await exchange(code, { code_verifier: "w".repeat(43) })).toMatchObject({
      body: { error: "invalid_grant" },
    });
    expect(await exchange(code, { client_id: CLAUDE_CODE })).toMatchObject({
      body: { error: "invalid_grant" },
    });
    expect(
      await exchange(code, { redirect_uri: "https://claude.com/api/mcp/auth_callback" }),
    ).toMatchObject({
      body: { error: "invalid_grant" },
    });
  });

  it("rotates the refresh token and treats a replay of the old one as theft", async () => {
    const { code } = await authorize();
    const issued = await exchange(code);
    if (issued.status !== 200) throw new Error("exchange failed");
    const refresh = (token: string) =>
      grantTokens(
        { grant_type: "refresh_token", refresh_token: token, client_id: CLAUDE_AI },
        ISSUER,
      );

    const rotated = await refresh(issued.body.refresh_token);
    expect(rotated.status).toBe(200);
    if (rotated.status !== 200) return;
    expect(rotated.body.refresh_token).not.toBe(issued.body.refresh_token);
    expect(await findGrantForAccessToken(issued.body.access_token, ISSUER)).toBeNull();

    expect(await refresh(issued.body.refresh_token)).toMatchObject({
      body: { error: "invalid_grant" },
    });
    // The replay ended the grant: the legitimate holder's new token is dead too.
    expect(await refresh(rotated.body.refresh_token)).toMatchObject({
      body: { error: "invalid_grant" },
    });
    expect(await findGrantForAccessToken(rotated.body.access_token, ISSUER)).toBeNull();
  });

  it("revokes the grant once the account is no longer an admin", async () => {
    const { code } = await authorize();
    store.admin = false;
    expect(await exchange(code)).toMatchObject({ body: { error: "invalid_grant" } });
    expect([...store.grants.values()][0]?.revokedAt).toBeInstanceOf(Date);
  });

  it("refuses an expired code and an unknown grant type", async () => {
    const { code } = await authorize();
    const grant = [...store.grants.values()][0]!;
    store.grants.set(grant.id, { ...grant, codeExpiresAt: new Date(Date.now() - 1000) });
    expect(await exchange(code)).toMatchObject({ body: { error: "invalid_grant" } });
    expect(await grantTokens({ grant_type: "password" }, ISSUER)).toMatchObject({
      body: { error: "unsupported_grant_type" },
    });
  });
});

describe("discovery", () => {
  it("advertises Client ID Metadata Documents, PKCE and the resource", () => {
    expect(authorizationServerMetadata(ISSUER)).toMatchObject({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/oauth/authorize`,
      token_endpoint: `${ISSUER}/api/oauth/token`,
      client_id_metadata_document_supported: true,
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    });
    expect(protectedResourceMetadata(ISSUER)).toMatchObject({
      resource: `${ISSUER}/api/mcp`,
      authorization_servers: [ISSUER],
    });
  });

  it("pins the origin in production and follows the host elsewhere", () => {
    expect(publicOrigin(new Headers({ host: "localhost:3000" }))).toBe("http://localhost:3000");
    expect(publicOrigin(new Headers({ host: "preview.vercel.app" }))).toBe(
      "https://preview.vercel.app",
    );
    expect(() => publicOrigin(new Headers({ host: "evil.test/<x>" }))).toThrow();
    vi.stubEnv("VERCEL_ENV", "production");
    expect(publicOrigin(new Headers({ host: "evil.test" }))).toBe(
      "https://photos.svatebni-fotograf-cechy.cz",
    );
    vi.unstubAllEnvs();
  });
});
