import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { loadAdminCaller } from "./caller";
import { findGrantForAccessToken } from "./oauth/token-grant";
import type { McpCaller } from "./types";

export type McpAuthResult =
  | { ok: true; caller: McpCaller }
  | { ok: false; status: 401 | 403; message: string; invalidToken: boolean };

const DEV_TOKEN_MIN_LENGTH = 32;

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function bearerToken(headers: Headers): string | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(headers.get("authorization") ?? "");
  return match?.[1] ?? null;
}

/**
 * The development token (docs/MCP.md §Development token): a static secret that
 * acts as `MCP_DEV_EMAIL`, for local work, E2E and previews without OAuth.
 * Never in production, whatever the environment says.
 */
function devTokenEmail(token: string): string | null {
  const devToken = process.env.MCP_DEV_TOKEN;
  const devEmail = process.env.MCP_DEV_EMAIL;
  if (process.env.VERCEL_ENV === "production") return null;
  if (!devToken || devToken.length < DEV_TOKEN_MIN_LENGTH || !devEmail) return null;
  return timingSafeEqual(digest(token), digest(devToken)) ? devEmail : null;
}

export async function resolveMcpCaller(headers: Headers, issuer: string): Promise<McpAuthResult> {
  const token = bearerToken(headers);
  if (!token) {
    return {
      ok: false,
      status: 401,
      message: "Chybí přístupový token. Připojte se přihlášením Google účtem správce galerií.",
      invalidToken: false,
    };
  }
  const devEmail = devTokenEmail(token);
  const lookup = devEmail
    ? { email: devEmail }
    : await findGrantForAccessToken(token, issuer).then((grant) =>
        grant ? { id: grant.userId } : null,
      );
  if (!lookup) {
    return {
      ok: false,
      status: 401,
      message: "Přístupový token je neplatný nebo vypršel.",
      invalidToken: true,
    };
  }
  const caller = await loadAdminCaller(lookup);
  if (!caller) {
    return {
      ok: false,
      status: 403,
      message: "Účet nemá v galeriích roli správce.",
      invalidToken: false,
    };
  }
  return { ok: true, caller: { ...caller, origin: issuer } };
}
