export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type JsonRpcId = string | number;

export interface JsonRpcError {
  code: number;
  message: string;
  data?: JsonValue;
}

export type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: JsonRpcId | null; result: Record<string, unknown> }
  | { jsonrpc: "2.0"; id: JsonRpcId | null; error: JsonRpcError };

export const JSON_RPC_ERROR = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
} as const;

/** Who is calling: always the photographer, an admin of this app (docs/MCP.md). */
export interface McpCaller {
  userId: string;
  email: string;
  /** This deployment's origin — what share and admin links in results point at. */
  origin: string;
}

export interface McpToolAnnotations {
  title: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export interface McpTextContent {
  type: "text";
  text: string;
}

export interface McpToolResult {
  content: McpTextContent[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/** A tool as the protocol layer sees it: input already erased to JSON Schema. */
export interface McpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: McpToolAnnotations;
  call: (args: Record<string, unknown>, caller: McpCaller) => Promise<McpToolResult>;
}

/** A failure the caller can act on; its message is shown to the model as is. */
export class McpToolError extends Error {}
