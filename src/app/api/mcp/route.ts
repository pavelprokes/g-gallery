import { NextResponse } from "next/server";
import { resolveMcpCaller } from "@/lib/mcp/auth";
import { MCP_SCOPE, protectedResourceMetadataUrl, publicOrigin } from "@/lib/mcp/oauth/config";
import { handleMcpRequest, rpcError } from "@/lib/mcp/server";
import { JSON_RPC_ERROR } from "@/lib/mcp/types";

// The MCP endpoint for Claude (docs/MCP.md). Stateless Streamable HTTP: one
// POST, one JSON answer, nothing held open (CLAUDE.md invariant #6); no image
// byte ever passes through here, only CDN addresses (invariant #1).
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const CLAUDE_ORIGINS = ["https://claude.ai", "https://claude.com"];
const NO_STORE = { "Cache-Control": "no-store" };

class BodyTooLargeError extends Error {}

function json(body: unknown, status: number, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

/** DNS-rebinding guard (MCP transport spec): a browser page may only call from Claude or this site. */
function isAllowedOrigin(origin: string | null, host: string | null): boolean {
  if (!origin || CLAUDE_ORIGINS.includes(origin)) return true;
  try {
    const url = new URL(origin);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return true;
    return Boolean(host) && url.host === host && url.protocol === "https:";
  } catch {
    return false;
  }
}

async function readBody(request: Request): Promise<string> {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES)
    throw new BodyTooLargeError();
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new BodyTooLargeError();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function challenge(origin: string, invalidToken: boolean): string {
  return [
    'Bearer realm="g-gallery"',
    ...(invalidToken
      ? ['error="invalid_token"', 'error_description="The access token is invalid or expired"']
      : []),
    `resource_metadata="${protectedResourceMetadataUrl(origin)}"`,
    `scope="${MCP_SCOPE}"`,
  ].join(", ");
}

async function respond(request: Request): Promise<Response> {
  const origin = publicOrigin(request.headers);
  const auth = await resolveMcpCaller(request.headers, origin);
  if (!auth.ok) {
    return json(
      rpcError(null, JSON_RPC_ERROR.invalidRequest, auth.message),
      auth.status,
      auth.status === 401 ? { "WWW-Authenticate": challenge(origin, auth.invalidToken) } : {},
    );
  }

  let message: unknown;
  try {
    message = JSON.parse(await readBody(request));
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return json(rpcError(null, JSON_RPC_ERROR.invalidRequest, "Request too large"), 413);
    }
    return json(rpcError(null, JSON_RPC_ERROR.parse, "Parse error"), 400);
  }
  if (Array.isArray(message)) {
    return json(
      rpcError(null, JSON_RPC_ERROR.invalidRequest, "Batch requests are not supported"),
      400,
    );
  }

  const { caller } = auth;
  const { status, body } = await handleMcpRequest({
    message,
    headers: {
      protocolVersion: request.headers.get("mcp-protocol-version") ?? undefined,
      method: request.headers.get("mcp-method") ?? undefined,
      name: request.headers.get("mcp-name") ?? undefined,
    },
    caller,
    onToolCall: (log) =>
      console.info(JSON.stringify({ event: "mcp.tool_call", email: caller.email, ...log })),
  });
  if (!body) return new Response(null, { status, headers: NO_STORE });
  return json(body, status);
}

export async function POST(request: Request): Promise<Response> {
  if (!isAllowedOrigin(request.headers.get("origin"), request.headers.get("host"))) {
    return json(rpcError(null, JSON_RPC_ERROR.invalidRequest, "Origin not allowed"), 403);
  }
  try {
    return await respond(request);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "mcp.error",
        message: error instanceof Error ? error.message : "unknown",
      }),
    );
    return json(rpcError(null, JSON_RPC_ERROR.internal, "Internal error"), 500);
  }
}

/** No SSE stream and no sessions to end — stateless transport (MCP spec, Streamable HTTP). */
function methodNotAllowed(): Response {
  return json(rpcError(null, JSON_RPC_ERROR.invalidRequest, "Method Not Allowed"), 405, {
    Allow: "POST",
  });
}

export const GET = methodNotAllowed;
export const DELETE = methodNotAllowed;
