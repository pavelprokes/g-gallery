import "server-only";
import {
  HOSTED_CLAUDE_CALLBACKS,
  isLoopbackHost,
  TRUSTED_CLIENTS,
  type RedirectPolicy,
} from "./config";
import { isRegisteredClientId, resolveRegisteredClient } from "./registration";

export interface OAuthClient {
  clientId: string;
  clientName: string;
  host: string;
  redirectUris: string[];
  redirectPolicy: RedirectPolicy;
}

export type ClientResolution = { ok: true; client: OAuthClient } | { ok: false; message: string };

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

const FETCH_TIMEOUT_MS = 5000;
const MAX_DOCUMENT_BYTES = 64 * 1024;
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_REDIRECT_URIS = 20;

const cache = new Map<string, { client: OAuthClient; expiresAt: number }>();

export function clearClientCache(): void {
  cache.clear();
}

function trustedRedirectPolicy(clientId: string): RedirectPolicy | null {
  return Object.prototype.hasOwnProperty.call(TRUSTED_CLIENTS, clientId)
    ? (TRUSTED_CLIENTS[clientId] ?? null)
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidRedirectUri(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.hash || url.username || url.password) return false;
    return url.protocol === "https:" || (url.protocol === "http:" && isLoopbackHost(url.hostname));
  } catch {
    return false;
  }
}

async function readLimited(response: Response): Promise<string | null> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_DOCUMENT_BYTES) return null;
  const text = await response.text();
  return Buffer.byteLength(text) > MAX_DOCUMENT_BYTES ? null : text;
}

function parseDocument(
  clientId: string,
  redirectPolicy: RedirectPolicy,
  text: string,
): ClientResolution {
  const host = new URL(clientId).hostname;
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    return { ok: false, message: "Popis klienta není platný JSON." };
  }
  if (!isRecord(document) || document.client_id !== clientId) {
    return { ok: false, message: "Popis klienta neodpovídá jeho adrese." };
  }
  const redirectUris = document.redirect_uris;
  if (
    !Array.isArray(redirectUris) ||
    !redirectUris.length ||
    redirectUris.length > MAX_REDIRECT_URIS
  ) {
    return { ok: false, message: "Popis klienta nemá platné redirect_uris." };
  }
  if (
    !redirectUris.every((uri): uri is string => typeof uri === "string" && isValidRedirectUri(uri))
  ) {
    return { ok: false, message: "Popis klienta má neplatnou návratovou adresu." };
  }
  const authMethod = document.token_endpoint_auth_method;
  if (authMethod !== undefined && authMethod !== "none") {
    return {
      ok: false,
      message: "Podporuji jen veřejné klienty (token_endpoint_auth_method none).",
    };
  }
  const name =
    typeof document.client_name === "string" && document.client_name.trim()
      ? document.client_name.trim().slice(0, 200)
      : host;
  return { ok: true, client: { clientId, clientName: name, host, redirectUris, redirectPolicy } };
}

/**
 * Looks the client up — one of `TRUSTED_CLIENTS` or a registration this server
 * signed itself; nothing else is ever fetched, so no SSRF surface.
 */
export async function resolveClient(
  clientId: string,
  fetcher: Fetcher = fetch,
): Promise<ClientResolution> {
  if (isRegisteredClientId(clientId)) {
    const client = resolveRegisteredClient(clientId);
    return client
      ? { ok: true, client }
      : {
          ok: false,
          message: "Registrace aplikace už neplatí. Spusťte připojení v aplikaci znovu.",
        };
  }
  const redirectPolicy = trustedRedirectPolicy(clientId);
  if (!redirectPolicy) {
    return {
      ok: false,
      message: "Neznámý klient. Připojit se dá jen Claude a aplikace na povolených adresách.",
    };
  }

  const cached = cache.get(clientId);
  if (cached && cached.expiresAt > Date.now()) return { ok: true, client: cached.client };

  let text: string | null;
  try {
    const response = await fetcher(clientId, {
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      return {
        ok: false,
        message: `Popis klienta se nepodařilo načíst (HTTP ${response.status}).`,
      };
    }
    text = await readLimited(response);
  } catch {
    return { ok: false, message: "Popis klienta se nepodařilo načíst." };
  }
  if (text === null) return { ok: false, message: "Popis klienta je příliš velký." };

  const resolution = parseDocument(clientId, redirectPolicy, text);
  if (resolution.ok)
    cache.set(clientId, { client: resolution.client, expiresAt: Date.now() + CACHE_TTL_MS });
  return resolution;
}

function withoutPort(url: URL): string {
  return `${url.protocol}//${url.hostname}${url.pathname}${url.search}`;
}

function loopbackUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" &&
      isLoopbackHost(url.hostname) &&
      !url.hash &&
      !url.username &&
      !url.password
      ? url
      : null;
  } catch {
    return null;
  }
}

/**
 * A registered client returns exactly where it registered to.
 * claude.ai may return only to its fixed callback. Claude Code listens on a
 * random port each time, so a loopback URI matches a registered one on
 * everything but the port (RFC 8252 §7.3).
 */
export function isRegisteredRedirectUri(client: OAuthClient, requested: string): boolean {
  if (client.redirectPolicy === "registered") return client.redirectUris.includes(requested);
  if (client.redirectPolicy === "hosted") {
    return HOSTED_CLAUDE_CALLBACKS.includes(requested) && client.redirectUris.includes(requested);
  }
  if (client.redirectUris.includes(requested)) return loopbackUrl(requested) !== null;
  const url = loopbackUrl(requested);
  if (!url) return false;
  return client.redirectUris.some((registered) => {
    const candidate = new URL(registered);
    return (
      candidate.protocol === "http:" &&
      isLoopbackHost(candidate.hostname) &&
      withoutPort(candidate) === withoutPort(url)
    );
  });
}
