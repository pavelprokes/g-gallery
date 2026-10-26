import { ALL_TOOLS } from "./tools";
import {
  JSON_RPC_ERROR,
  McpToolError,
  type JsonRpcId,
  type JsonRpcResponse,
  type JsonValue,
  type McpCaller,
  type McpTool,
  type McpToolResult,
} from "./types";

// A thin JSON-RPC layer rather than @modelcontextprotocol/sdk, ported from the
// admin of Vzdělání budoucnosti where it is verified against the official SDK
// clients and Claude (docs/MCP.md §Protocol). Stateless Streamable HTTP: one
// POST, one JSON answer — nothing held open (CLAUDE.md invariant #6).

export const MODERN_PROTOCOL_VERSIONS = ["2026-07-28"] as const;
export const LEGACY_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"] as const;
export const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = [
  ...MODERN_PROTOCOL_VERSIONS,
  ...LEGACY_PROTOCOL_VERSIONS,
];

const META_PROTOCOL_VERSION = "io.modelcontextprotocol/protocolVersion";
const META_SERVER_INFO = "io.modelcontextprotocol/serverInfo";
const LIST_TTL_MS = 5 * 60 * 1000;

export const SERVER_INFO = { name: "g-gallery", title: "Galerie — Pavel Prokeš", version: "0.1.0" };

const INSTRUCTIONS = [
  "Klientské galerie svatebního fotografa Pavla Prokeše (photos.svatebni-fotograf-cechy.cz).",
  "Svatba (wedding) je rozcestník pro hosty a sdružuje několik galerií; galerie má fotky, videa a sdílené odkazy.",
  "Začni přehledem (overview) nebo seznamem (galleries_list, weddings_list) a id ber z jejich výsledků.",
  "Fotky jsou na veřejném CDN: thumbUrl na mřížku, previewUrl na prohlížení, originalUrl je plná kvalita; ořez a zmenšení na zadaný poměr a velikost (např. pro Instagram) dá photo_crop.",
  "Nová galerie vzniká jako koncept a hosté ji uvidí až po zveřejnění (gallery_publish) a se sdíleným odkazem.",
  "Mazat, rušit odkazy a nahrávat fotky jde jen v administraci.",
].join(" ");

export interface ToolCallLog {
  tool: string;
  ok: boolean;
  durationMs: number;
  error?: string;
}

export interface McpHttpRequest {
  message: unknown;
  headers: { protocolVersion?: string; method?: string; name?: string };
  caller: McpCaller;
  tools?: readonly McpTool[];
  onToolCall?: (log: ToolCallLog) => void;
}

export interface McpHttpResponse {
  status: number;
  body: JsonRpcResponse | null;
}

const HEADER_MISMATCH = -32020;
const UNSUPPORTED_PROTOCOL_VERSION = -32022;

export function rpcError(
  id: JsonRpcId | null,
  code: number,
  message: string,
  data?: JsonValue,
): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: data === undefined ? { code, message } : { code, message, data },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is JsonRpcId {
  return typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
}

function toolError(message: string): McpToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** `Mcp-Method`/`Mcp-Name` may carry non-ASCII as `=?base64?…?=` (MCP 2026-07-28). */
export function decodeHeaderValue(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const match = /^=\?base64\?(.*)\?=$/.exec(value);
  return match ? Buffer.from(match[1] ?? "", "base64").toString("utf8") : value;
}

function toolDefinitions(tools: readonly McpTool[]) {
  return tools.map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
  }));
}

async function callTool(
  params: Record<string, unknown>,
  request: McpHttpRequest,
  tools: readonly McpTool[],
): Promise<McpToolResult | null> {
  const tool = tools.find((candidate) => candidate.name === params.name);
  if (!tool) return null;
  const onToolCall = request.onToolCall ?? (() => undefined);
  const args = params.arguments === undefined || params.arguments === null ? {} : params.arguments;
  const startedAt = Date.now();
  const finish = (value: McpToolResult, error?: string): McpToolResult => {
    onToolCall({
      tool: tool.name,
      ok: !value.isError,
      durationMs: Date.now() - startedAt,
      ...(error ? { error } : {}),
    });
    return value;
  };
  if (!isRecord(args)) {
    return finish(toolError("Argumenty nástroje musí být objekt."), "invalid-arguments");
  }
  try {
    return finish(await tool.call(args, request.caller));
  } catch (error) {
    if (error instanceof McpToolError) return finish(toolError(error.message), "tool-error");
    const detail = error instanceof Error ? error.message : "unknown";
    return finish(
      toolError("Nástroj selhal na straně serveru. Zkus to prosím znovu, případně později."),
      detail,
    );
  }
}

const ok = (id: JsonRpcId, result: Record<string, unknown>): McpHttpResponse => ({
  status: 200,
  body: { jsonrpc: "2.0", id, result },
});

const fail = (
  status: number,
  id: JsonRpcId | null,
  code: number,
  message: string,
  data?: JsonValue,
): McpHttpResponse => ({ status, body: rpcError(id, code, message, data) });

async function handleModern(
  id: JsonRpcId,
  method: string,
  params: Record<string, unknown>,
  version: string,
  request: McpHttpRequest,
  tools: readonly McpTool[],
): Promise<McpHttpResponse> {
  const { headers } = request;
  if (!MODERN_PROTOCOL_VERSIONS.some((supported) => supported === version)) {
    return fail(400, id, UNSUPPORTED_PROTOCOL_VERSION, "Unsupported protocol version", {
      supported: [...SUPPORTED_PROTOCOL_VERSIONS],
      requested: version,
    });
  }
  if (headers.protocolVersion !== version) {
    return fail(400, id, HEADER_MISMATCH, "MCP-Protocol-Version header does not match _meta");
  }
  if (decodeHeaderValue(headers.method) !== method) {
    return fail(400, id, HEADER_MISMATCH, "Mcp-Method header does not match method");
  }
  if (method === "tools/call" && decodeHeaderValue(headers.name) !== params.name) {
    return fail(400, id, HEADER_MISMATCH, "Mcp-Name header does not match params.name");
  }
  const complete = (result: Record<string, unknown>) =>
    ok(id, { ...result, resultType: "complete", _meta: { [META_SERVER_INFO]: SERVER_INFO } });

  switch (method) {
    case "server/discover":
      return complete({
        supportedVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
        capabilities: { tools: {} },
        instructions: INSTRUCTIONS,
        ttlMs: LIST_TTL_MS,
        cacheScope: "private",
      });
    case "tools/list":
      return complete({ tools: toolDefinitions(tools), ttlMs: LIST_TTL_MS, cacheScope: "private" });
    case "tools/call": {
      const toolResult = await callTool(params, request, tools);
      if (!toolResult) {
        return fail(200, id, JSON_RPC_ERROR.invalidParams, `Unknown tool: ${String(params.name)}`);
      }
      return complete({ ...toolResult });
    }
    default:
      return fail(404, id, JSON_RPC_ERROR.methodNotFound, `Method not found: ${method}`);
  }
}

async function handleLegacy(
  id: JsonRpcId,
  method: string,
  params: Record<string, unknown>,
  request: McpHttpRequest,
  tools: readonly McpTool[],
): Promise<McpHttpResponse> {
  const headerVersion = request.headers.protocolVersion;
  if (headerVersion && MODERN_PROTOCOL_VERSIONS.some((version) => version === headerVersion)) {
    return fail(400, id, HEADER_MISMATCH, "MCP-Protocol-Version header does not match _meta");
  }
  if (headerVersion && !LEGACY_PROTOCOL_VERSIONS.some((version) => version === headerVersion)) {
    return fail(
      400,
      id,
      JSON_RPC_ERROR.invalidRequest,
      `Unsupported MCP-Protocol-Version: ${headerVersion}`,
    );
  }

  switch (method) {
    case "initialize": {
      const requested = params.protocolVersion;
      const protocolVersion =
        LEGACY_PROTOCOL_VERSIONS.find((version) => version === requested) ??
        LEGACY_PROTOCOL_VERSIONS[0];
      return ok(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, { tools: toolDefinitions(tools) });
    case "tools/call": {
      const toolResult = await callTool(params, request, tools);
      if (!toolResult) {
        return fail(200, id, JSON_RPC_ERROR.invalidParams, `Unknown tool: ${String(params.name)}`);
      }
      return ok(id, { ...toolResult });
    }
    default:
      return fail(200, id, JSON_RPC_ERROR.methodNotFound, `Method not found: ${method}`);
  }
}

/**
 * One JSON-RPC message in, one HTTP status and body out. Dual-era: a request
 * carrying `_meta["io.modelcontextprotocol/protocolVersion"]` is MCP 2026-07-28
 * (no `initialize`, headers must agree with the body), anything else is the
 * `initialize`-based protocol of 2025-03-26 … 2025-11-25.
 */
export async function handleMcpRequest(request: McpHttpRequest): Promise<McpHttpResponse> {
  const { message } = request;
  const tools = request.tools ?? ALL_TOOLS;
  if (!isRecord(message) || message.jsonrpc !== "2.0") {
    return fail(400, null, JSON_RPC_ERROR.invalidRequest, "Invalid Request");
  }
  if (typeof message.method !== "string") {
    return "result" in message || "error" in message
      ? { status: 202, body: null }
      : fail(400, null, JSON_RPC_ERROR.invalidRequest, "Invalid Request");
  }
  if (!("id" in message)) return { status: 202, body: null };
  if (!isId(message.id)) return fail(400, null, JSON_RPC_ERROR.invalidRequest, "Invalid Request");
  const { id, method } = message;
  if (message.params !== undefined && !isRecord(message.params)) {
    return fail(400, id, JSON_RPC_ERROR.invalidParams, "params must be an object");
  }
  const params = message.params ?? {};
  const meta = isRecord(params._meta) ? params._meta : null;
  const modernVersion =
    meta && typeof meta[META_PROTOCOL_VERSION] === "string"
      ? (meta[META_PROTOCOL_VERSION] as string)
      : null;
  return modernVersion
    ? handleModern(id, method, params, modernVersion, request, tools)
    : handleLegacy(id, method, params, request, tools);
}
