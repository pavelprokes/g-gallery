import "server-only";
import { loadAdminCaller } from "../caller";
import { isOwnResource } from "./authorization";
import {
  ACCESS_TOKEN_TTL_S,
  GRANT_MAX_AGE_S,
  mcpResourceUrl,
  MCP_SCOPE,
  OFFLINE_ACCESS_SCOPE,
  REFRESH_TOKEN_TTL_S,
} from "./config";
import { findGrant, updateGrant, type McpGrant } from "./grant-store";
import { hashToken, newToken, verifyPkce } from "./tokens";

export interface TokenSuccess {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}

export interface TokenFailure {
  error:
    | "invalid_request"
    | "invalid_grant"
    | "unsupported_grant_type"
    | "invalid_scope"
    | "invalid_target";
  error_description: string;
}

export type TokenResult = { status: 200; body: TokenSuccess } | { status: 400; body: TokenFailure };

export type TokenParams = Record<string, string | undefined>;

/**
 * A rotated-away refresh token presented this soon after its rotation is the
 * same client racing itself (two conversations refreshing at once), not a
 * thief: it is refused, but the grant survives. Later than this, it is a replay.
 */
const ROTATION_GRACE_MS = 60 * 1000;

/** How often `lastUsedAt` is written — a busy session would otherwise update per call. */
const LAST_USED_RESOLUTION_MS = 5 * 60 * 1000;

function fail(error: TokenFailure["error"], description: string): TokenResult {
  return { status: 400, body: { error, error_description: description } };
}

const invalidGrant = (description: string) => fail("invalid_grant", description);

function issueTokens(grant: McpGrant, now: Date) {
  const accessToken = newToken("access");
  const refreshToken = newToken("refresh");
  return {
    accessToken,
    refreshToken,
    patch: {
      accessHash: hashToken(accessToken),
      accessExpiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_S * 1000),
      refreshHash: hashToken(refreshToken),
      // Sliding, but never past the grant's own ceiling: a forgotten laptop
      // must not keep access forever just by being opened once a month.
      refreshExpiresAt: new Date(
        Math.min(
          now.getTime() + REFRESH_TOKEN_TTL_S * 1000,
          grant.createdAt.getTime() + GRANT_MAX_AGE_S * 1000,
        ),
      ),
    },
  };
}

function success(accessToken: string, refreshToken: string): TokenResult {
  return {
    status: 200,
    body: {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_S,
      refresh_token: refreshToken,
      scope: MCP_SCOPE,
    },
  };
}

const revoke = (grant: McpGrant, now: Date) => updateGrant(grant.id, null, { revokedAt: now });

const isPast = (at: Date | null, now: Date): boolean => !at || at.getTime() <= now.getTime();

/** No longer an admin: the grant is revoked for good, not just refused once. */
async function stillAdmin(grant: McpGrant, now: Date): Promise<boolean> {
  if (await loadAdminCaller({ id: grant.userId }, now)) return true;
  await revoke(grant, now);
  return false;
}

async function exchangeCode(params: TokenParams, issuer: string, now: Date): Promise<TokenResult> {
  const { code, code_verifier: verifier, client_id: clientId, redirect_uri: redirectUri } = params;
  if (!code || !verifier || !clientId || !redirectUri) {
    return fail("invalid_request", "code, code_verifier, client_id and redirect_uri are required");
  }

  const grant = await findGrant("codeHash", hashToken(code));
  if (!grant) return invalidGrant("Unknown authorization code");
  // A code presented twice was intercepted somewhere (RFC 6749 §4.1.2): the
  // tokens already issued from it are revoked along with it.
  if (grant.codeUsedAt) {
    if (!grant.revokedAt) await revoke(grant, now);
    return invalidGrant("Authorization code was already used");
  }
  if (grant.revokedAt || isPast(grant.codeExpiresAt, now))
    return invalidGrant("Authorization code expired");
  if (grant.clientId !== clientId || grant.redirectUri !== redirectUri) {
    return invalidGrant("Authorization code was issued to another client");
  }
  if (params.resource !== undefined && !isOwnResource(params.resource, issuer)) {
    return fail("invalid_target", "Unknown resource");
  }
  if (grant.resource !== mcpResourceUrl(issuer)) {
    return invalidGrant("Authorization code was issued for another resource");
  }
  if (!verifyPkce(verifier, grant.codeChallenge)) return invalidGrant("PKCE verification failed");
  if (!(await stillAdmin(grant, now))) return invalidGrant("The account no longer has access");

  const tokens = issueTokens(grant, now);
  const redeemed = await updateGrant(
    grant.id,
    { column: "codeUsedAt", value: null },
    { ...tokens.patch, codeUsedAt: now },
  );
  if (!redeemed) return invalidGrant("Authorization code was already used");
  return success(tokens.accessToken, tokens.refreshToken);
}

async function refresh(params: TokenParams, issuer: string, now: Date): Promise<TokenResult> {
  const { refresh_token: refreshToken, client_id: clientId } = params;
  if (!refreshToken || !clientId)
    return fail("invalid_request", "refresh_token and client_id are required");
  const refreshHash = hashToken(refreshToken);

  const grant = await findGrant("refreshHash", refreshHash);
  if (!grant) {
    // A rotated-away refresh token coming back means two parties hold it
    // (OAuth 2.1 §4.3.1): end the grant for both.
    const replayed = await findGrant("previousRefreshHash", refreshHash);
    const racing =
      replayed?.refreshedAt && now.getTime() - replayed.refreshedAt.getTime() < ROTATION_GRACE_MS;
    if (replayed && !replayed.revokedAt && !racing) await revoke(replayed, now);
    return invalidGrant("Unknown or already used refresh token");
  }
  if (grant.revokedAt || isPast(grant.refreshExpiresAt, now)) {
    return invalidGrant("Refresh token expired or revoked");
  }
  if (grant.clientId !== clientId)
    return invalidGrant("Refresh token was issued to another client");
  if (
    params.scope !== undefined &&
    params.scope
      .split(" ")
      .some((scope) => scope && scope !== MCP_SCOPE && scope !== OFFLINE_ACCESS_SCOPE)
  ) {
    return fail("invalid_scope", `Supported scope: ${MCP_SCOPE}`);
  }
  if (params.resource !== undefined && !isOwnResource(params.resource, issuer)) {
    return fail("invalid_target", "Unknown resource");
  }
  if (grant.resource !== mcpResourceUrl(issuer)) {
    return invalidGrant("Refresh token was issued for another resource");
  }
  if (!(await stillAdmin(grant, now))) return invalidGrant("The account no longer has access");

  const tokens = issueTokens(grant, now);
  const rotated = await updateGrant(
    grant.id,
    { column: "refreshHash", value: refreshHash },
    { ...tokens.patch, previousRefreshHash: refreshHash, refreshedAt: now },
  );
  if (!rotated) return invalidGrant("Refresh token was already used");
  return success(tokens.accessToken, tokens.refreshToken);
}

export async function grantTokens(
  params: TokenParams,
  issuer: string,
  now: Date = new Date(),
): Promise<TokenResult> {
  if (params.grant_type === "authorization_code") return exchangeCode(params, issuer, now);
  if (params.grant_type === "refresh_token") return refresh(params, issuer, now);
  return fail("unsupported_grant_type", "Supported grant types: authorization_code, refresh_token");
}

/** The live grant behind an access token, bound to this server as its audience. */
export async function findGrantForAccessToken(
  accessToken: string,
  issuer: string,
  now: Date = new Date(),
): Promise<McpGrant | null> {
  const grant = await findGrant("accessHash", hashToken(accessToken));
  if (
    !grant ||
    grant.revokedAt ||
    isPast(grant.accessExpiresAt, now) ||
    grant.resource !== mcpResourceUrl(issuer)
  ) {
    return null;
  }
  if (!grant.lastUsedAt || now.getTime() - grant.lastUsedAt.getTime() > LAST_USED_RESOLUTION_MS) {
    await updateGrant(grant.id, null, { lastUsedAt: now });
  }
  return grant;
}
