import { SITE_ORIGIN } from "@/lib/site-url";

// The app is its own OAuth 2.1 authorization server for its MCP endpoint
// (docs/MCP.md §Sign-in). Sign-in itself is the admin's: better-auth + Google,
// and only an admin may consent.

export const MCP_SCOPE = "mcp";
export const OFFLINE_ACCESS_SCOPE = "offline_access";
export const MCP_ENDPOINT_PATH = "/api/mcp";
export const AUTHORIZE_PAGE_PATH = "/oauth/authorize";
export const TOKEN_ENDPOINT_PATH = "/api/oauth/token";
export const REGISTRATION_ENDPOINT_PATH = "/api/oauth/register";
export const PROTECTED_RESOURCE_METADATA_PATH = `/.well-known/oauth-protected-resource${MCP_ENDPOINT_PATH}`;

export const CODE_TTL_S = 2 * 60;
export const ACCESS_TOKEN_TTL_S = 60 * 60;
export const REFRESH_TOKEN_TTL_S = 30 * 24 * 60 * 60;
export const GRANT_MAX_AGE_S = 90 * 24 * 60 * 60;

export type RedirectPolicy = "hosted" | "loopback" | "registered";

/**
 * Client ID Metadata Documents (MCP 2025-11-25) — and only these two. Whatever
 * a document says, claude.ai may return only to its own callback and Claude
 * Code only to a loopback port, so no other app can be handed a token and
 * nothing here ever fetches an arbitrary URL.
 */
export const TRUSTED_CLIENTS: Readonly<Record<string, RedirectPolicy>> = {
  "https://claude.ai/oauth/mcp-oauth-client-metadata": "hosted",
  "https://claude.ai/oauth/claude-code-client-metadata": "loopback",
};

export const HOSTED_CLAUDE_CALLBACKS: readonly string[] = [
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback",
];

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.includes(hostname);
}

/**
 * Origins a dynamically registered client may return to — the photographer's
 * own servers (Paperclip on the NAS), from `MCP_OAUTH_REDIRECT_ORIGINS`.
 * HTTPS, or plain HTTP on loopback; anything else in the list is ignored.
 */
export function allowedRedirectOrigins(): string[] {
  const origins: string[] = [];
  for (const entry of (process.env.MCP_OAUTH_REDIRECT_ORIGINS ?? "").split(",")) {
    try {
      const url = new URL(entry.trim());
      if (url.protocol === "https:" || (url.protocol === "http:" && isLoopbackHost(url.hostname)))
        origins.push(url.origin);
    } catch {
      continue;
    }
  }
  return origins;
}

/** Off unless an origin is allowed and there is a secret to sign client ids with. */
export function registrationEnabled(): boolean {
  return allowedRedirectOrigins().length > 0 && Boolean(process.env.BETTER_AUTH_SECRET);
}

/**
 * The issuer and audience everything is bound to. Pinned in production, so a
 * forged Host header cannot mint or accept tokens for another origin;
 * elsewhere (localhost, previews) it is the request's own host.
 */
export function publicOrigin(headers: Headers): string {
  if (process.env.VERCEL_ENV === "production") return SITE_ORIGIN;
  const host = headers.get("host");
  if (!host || !/^[a-z0-9.-]+(:\d+)?$/i.test(host))
    throw new Error("Missing or invalid Host header");
  const hostname = host.replace(/:\d+$/, "").toLowerCase();
  return `${isLoopbackHost(hostname) ? "http" : "https"}://${host.toLowerCase()}`;
}

export function mcpResourceUrl(origin: string): string {
  return `${origin}${MCP_ENDPOINT_PATH}`;
}

export function protectedResourceMetadataUrl(origin: string): string {
  return `${origin}${PROTECTED_RESOURCE_METADATA_PATH}`;
}

/** RFC 8414. */
export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}${AUTHORIZE_PAGE_PATH}`,
    token_endpoint: `${origin}${TOKEN_ENDPOINT_PATH}`,
    ...(registrationEnabled()
      ? { registration_endpoint: `${origin}${REGISTRATION_ENDPOINT_PATH}` }
      : {}),
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    scopes_supported: [MCP_SCOPE],
  };
}

/** RFC 9728. */
export function protectedResourceMetadata(origin: string) {
  return {
    resource: mcpResourceUrl(origin),
    resource_name: "Galerie — Pavel Prokeš",
    authorization_servers: [origin],
    scopes_supported: [MCP_SCOPE],
    bearer_methods_supported: ["header"],
  };
}
