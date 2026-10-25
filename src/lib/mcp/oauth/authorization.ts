import "server-only";
import { isRegisteredRedirectUri, resolveClient, type OAuthClient } from "./clients";
import { CODE_TTL_S, mcpResourceUrl, MCP_SCOPE, OFFLINE_ACCESS_SCOPE } from "./config";
import { insertGrant, pruneGrants } from "./grant-store";
import { hashToken, isCodeChallenge, newToken } from "./tokens";

export const AUTHORIZE_PARAMS = [
  "client_id",
  "redirect_uri",
  "response_type",
  "code_challenge",
  "code_challenge_method",
  "state",
  "scope",
  "resource",
] as const;

export type AuthorizeParam = (typeof AUTHORIZE_PARAMS)[number];
export type AuthorizeParams = Partial<Record<AuthorizeParam, string>>;

export interface AuthorizeRequest {
  client: OAuthClient;
  redirectUri: string;
  codeChallenge: string;
  state: string | null;
  scope: string;
  resource: string;
}

export type AuthorizeParseResult =
  | { ok: true; request: AuthorizeRequest }
  | { ok: false; redirectTo: null; message: string }
  | { ok: false; redirectTo: string; message: string };

const ALLOWED_SCOPES = [MCP_SCOPE, OFFLINE_ACCESS_SCOPE];
const MAX_STATE_LENGTH = 1000;

/** Only the known parameters, only as strings — from a query or a JSON body alike. */
export function pickAuthorizeParams(source: Record<string, unknown>): AuthorizeParams {
  const params: AuthorizeParams = {};
  for (const name of AUTHORIZE_PARAMS) {
    const value = source[name];
    if (typeof value === "string") params[name] = value;
  }
  return params;
}

/** The redirect back to the client, always carrying `iss` (RFC 9207). */
export function authorizationResponseUrl(
  redirectUri: string,
  issuer: string,
  state: string | null,
  values: Record<string, string>,
): string {
  const url = new URL(redirectUri);
  Object.entries(values).forEach(([name, value]) => url.searchParams.set(name, value));
  if (state !== null) url.searchParams.set("state", state);
  url.searchParams.set("iss", issuer);
  return url.toString();
}

function normalizeResource(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.hash) return null;
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/$/, "")}${url.search}`;
  } catch {
    return null;
  }
}

export function isOwnResource(value: string, origin: string): boolean {
  return normalizeResource(value) === mcpResourceUrl(origin);
}

/**
 * Checks an authorization request. Errors about the client or its return
 * address are shown on the page — redirecting there would hand an attacker an
 * open redirect. Every other error goes back to the client (RFC 6749 §4.1.2.1).
 */
export async function parseAuthorizeRequest(
  params: AuthorizeParams,
  issuer: string,
): Promise<AuthorizeParseResult> {
  if (!params.client_id) return { ok: false, redirectTo: null, message: "Chybí client_id." };
  const resolution = await resolveClient(params.client_id);
  if (!resolution.ok) return { ok: false, redirectTo: null, message: resolution.message };
  const { client } = resolution;
  if (!params.redirect_uri || !isRegisteredRedirectUri(client, params.redirect_uri)) {
    return {
      ok: false,
      redirectTo: null,
      message: "Návratová adresa (redirect_uri) neodpovídá klientovi.",
    };
  }

  const redirectUri = params.redirect_uri;
  const state =
    params.state !== undefined && params.state.length <= MAX_STATE_LENGTH ? params.state : null;
  const fail = (error: string, description: string): AuthorizeParseResult => ({
    ok: false,
    redirectTo: authorizationResponseUrl(redirectUri, issuer, state, {
      error,
      error_description: description,
    }),
    message: description,
  });

  if (params.state !== undefined && state === null)
    return fail("invalid_request", "state is too long");
  if (params.response_type !== "code") {
    return fail("unsupported_response_type", "Only response_type=code is supported");
  }
  if (
    params.code_challenge_method !== "S256" ||
    !params.code_challenge ||
    !isCodeChallenge(params.code_challenge)
  ) {
    return fail("invalid_request", "PKCE with code_challenge_method=S256 is required");
  }
  const requestedScopes = (params.scope ?? MCP_SCOPE).split(" ").filter(Boolean);
  if (requestedScopes.some((scope) => !ALLOWED_SCOPES.includes(scope))) {
    return fail("invalid_scope", `Supported scope: ${MCP_SCOPE}`);
  }
  if (params.resource !== undefined && !isOwnResource(params.resource, issuer)) {
    return fail("invalid_target", "Unknown resource");
  }

  return {
    ok: true,
    request: {
      client,
      redirectUri,
      codeChallenge: params.code_challenge,
      state,
      scope: MCP_SCOPE,
      resource: mcpResourceUrl(issuer),
    },
  };
}

/** Stores the consent as a fresh grant and returns where to send the browser. */
export async function issueAuthorizationCode(
  request: AuthorizeRequest,
  userId: string,
  issuer: string,
  now: Date = new Date(),
): Promise<string> {
  const code = newToken("code");
  await insertGrant({
    userId,
    clientId: request.client.clientId,
    clientName: request.client.clientName,
    redirectUri: request.redirectUri,
    scope: request.scope,
    resource: request.resource,
    codeHash: hashToken(code),
    codeChallenge: request.codeChallenge,
    codeExpiresAt: new Date(now.getTime() + CODE_TTL_S * 1000),
  });
  await pruneGrants(now);
  return authorizationResponseUrl(request.redirectUri, issuer, request.state, { code });
}
