import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { OAuthClient } from "./clients";
import { allowedRedirectOrigins, registrationEnabled } from "./config";

// Dynamic Client Registration (RFC 7591) for clients other than Claude — in
// practice Paperclip on the photographer's NAS (docs/MCP.md §Other clients).
//
// Stateless: the registration is the client_id itself, signed with
// BETTER_AUTH_SECRET, so nothing is stored and nothing can be registered
// in bulk. Only redirect URIs on an origin listed in
// MCP_OAUTH_REDIRECT_ORIGINS are accepted, and that list is checked again on
// every use — dropping an origin from it cuts its clients off, tokens included.

const PREFIX = "ggd_";
const MAX_REDIRECT_URIS = 5;
/** The token endpoint reads at most 2048 characters of client_id. */
const MAX_CLIENT_ID_LENGTH = 2048;

const registrationSchema = z.looseObject({
  redirect_uris: z.array(z.string().max(2000)).min(1).max(MAX_REDIRECT_URIS),
  client_name: z.string().trim().max(200).optional(),
});

const storedSchema = z.object({
  n: z.string(),
  r: z.array(z.string()).min(1).max(MAX_REDIRECT_URIS),
  t: z.number().int(),
});

type Stored = z.infer<typeof storedSchema>;

export interface RegistrationResponse {
  client_id: string;
  client_id_issued_at: number;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: "none";
}

export type RegistrationResult =
  | { ok: true; body: RegistrationResponse }
  | {
      ok: false;
      body: {
        error: "invalid_redirect_uri" | "invalid_client_metadata";
        error_description: string;
      };
    };

function signature(payload: string): Buffer {
  return createHmac("sha256", process.env.BETTER_AUTH_SECRET ?? "")
    .update(`mcp-client.v1.${payload}`)
    .digest();
}

/** Exact URIs only, on an allowed origin, with nothing a redirect could hide behind. */
function isAllowedRedirectUri(value: string, origins: readonly string[]): boolean {
  try {
    const url = new URL(value);
    return !url.hash && !url.username && !url.password && origins.includes(url.origin);
  } catch {
    return false;
  }
}

export function isRegisteredClientId(clientId: string): boolean {
  return clientId.startsWith(PREFIX);
}

export function registerClient(input: unknown, now: Date = new Date()): RegistrationResult {
  const parsed = registrationSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      body: {
        error: "invalid_client_metadata",
        error_description: "redirect_uris (1-5) is required",
      },
    };
  }
  const origins = allowedRedirectOrigins();
  if (!parsed.data.redirect_uris.every((uri) => isAllowedRedirectUri(uri, origins))) {
    return {
      ok: false,
      body: {
        error: "invalid_redirect_uri",
        error_description: "Redirect URIs must be on an origin this server allows",
      },
    };
  }

  const stored: Stored = {
    n: parsed.data.client_name || new URL(parsed.data.redirect_uris[0]!).host,
    r: parsed.data.redirect_uris,
    t: Math.floor(now.getTime() / 1000),
  };
  const payload = Buffer.from(JSON.stringify(stored)).toString("base64url");
  const clientId = `${PREFIX}${payload}.${signature(payload).toString("base64url")}`;
  if (clientId.length > MAX_CLIENT_ID_LENGTH) {
    return {
      ok: false,
      body: {
        error: "invalid_client_metadata",
        error_description: "client_name and redirect_uris are too long",
      },
    };
  }
  return {
    ok: true,
    body: {
      client_id: clientId,
      client_id_issued_at: stored.t,
      client_name: stored.n,
      redirect_uris: stored.r,
      // A public client with PKCE, whatever it asked for (RFC 7591 §3.2.1).
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
  };
}

/** The client a `ggd_` id describes — null if forged, from another secret, or no longer allowed. */
export function resolveRegisteredClient(clientId: string): OAuthClient | null {
  if (!isRegisteredClientId(clientId) || !registrationEnabled()) return null;
  const body = clientId.slice(PREFIX.length);
  const dot = body.lastIndexOf(".");
  if (dot < 1) return null;
  const payload = body.slice(0, dot);
  const given = Buffer.from(body.slice(dot + 1), "base64url");
  const expected = signature(payload);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  let stored: Stored;
  try {
    const parsed = storedSchema.safeParse(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    );
    if (!parsed.success) return null;
    stored = parsed.data;
  } catch {
    return null;
  }
  const origins = allowedRedirectOrigins();
  if (!stored.r.every((uri) => isAllowedRedirectUri(uri, origins))) return null;

  return {
    clientId,
    clientName: stored.n,
    host: new URL(stored.r[0]!).host,
    redirectUris: stored.r,
    redirectPolicy: "registered",
  };
}

/** Claude's clients always; a registered one only while its registration still holds. */
export function clientStillTrusted(clientId: string): boolean {
  return !isRegisteredClientId(clientId) || resolveRegisteredClient(clientId) !== null;
}
