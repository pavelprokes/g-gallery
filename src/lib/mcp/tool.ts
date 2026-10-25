import { z } from "zod";
import { McpToolError, type McpCaller, type McpTool, type McpToolResult } from "./types";

type Access = "read" | "write" | "write-idempotent";

interface ToolDefinition<S extends z.ZodObject> {
  name: string;
  title: string;
  description: string;
  input: S;
  /**
   * `read` never changes anything. `write` creates something new each call;
   * `write-idempotent` sets a value, so repeating it changes nothing more.
   * Nothing here deletes — see docs/MCP.md §What it cannot do.
   */
  access: Access;
  /** Takes something away from guests (a gallery off the air) — clients ask first. */
  disruptive?: boolean;
  handler: (args: z.output<S>, caller: McpCaller) => Promise<McpToolResult>;
}

const czechErrors = z.locales.cs().localeError;

function describeIssue(issue: z.core.$ZodIssue): string {
  const path = issue.path.map(String).join(".");
  return path ? `„${path}“: ${issue.message}` : issue.message;
}

/** The tool's input as JSON Schema, in the shape a client fills in (defaults optional). */
function jsonSchemaOf(input: z.ZodObject): Record<string, unknown> {
  const schema: Record<string, unknown> = z.toJSONSchema(input, { io: "input" });
  delete schema.$schema;
  return schema;
}

/**
 * Zod is both halves of the contract: the JSON Schema a client is shown and the
 * validation its arguments go through (CLAUDE.md: Zod-validate every input), so
 * the two cannot drift apart.
 */
export function defineTool<S extends z.ZodObject>(definition: ToolDefinition<S>): McpTool {
  const { input, access, handler } = definition;
  return {
    name: definition.name,
    title: definition.title,
    description: definition.description,
    inputSchema: jsonSchemaOf(input),
    annotations: {
      title: definition.title,
      readOnlyHint: access === "read",
      destructiveHint: definition.disruptive ?? false,
      idempotentHint: access !== "write",
      openWorldHint: false,
    },
    call: async (args, caller) => {
      const parsed = input.safeParse(args, { error: czechErrors });
      if (!parsed.success) {
        throw new McpToolError(parsed.error.issues.map(describeIssue).join(" "));
      }
      return handler(parsed.data, caller);
    },
  };
}

/** A result both as JSON text (what every client shows the model) and structured. */
export function jsonResult(value: Record<string, unknown>): McpToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}
