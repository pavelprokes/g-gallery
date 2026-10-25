import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("./tools", () => ({ ALL_TOOLS: [] }));

import { decodeHeaderValue, handleMcpRequest, type McpHttpRequest } from "./server";
import { defineTool, jsonResult } from "./tool";
import { McpToolError, type McpCaller } from "./types";

const caller: McpCaller = {
  userId: "user_1",
  email: "pavel@example.test",
  origin: "https://g.test",
};

const echo = defineTool({
  name: "echo",
  title: "Echo",
  description: "Vrátí, co dostal.",
  input: z.strictObject({
    text: z.string().min(2),
    times: z.number().int().min(1).max(3).default(1),
  }),
  access: "read",
  handler: async (args, who) =>
    jsonResult({ text: args.text.repeat(args.times), user: who.userId }),
});

const failing = defineTool({
  name: "failing",
  title: "Failing",
  description: "Vždy selže.",
  input: z.strictObject({ kind: z.enum(["tool", "crash"]) }),
  access: "write",
  disruptive: true,
  handler: async (args) => {
    if (args.kind === "tool") throw new McpToolError("Tohle nejde.");
    throw new Error("database exploded");
  },
});

const tools = [echo, failing];

function rpc(method: string, params?: Record<string, unknown>, id: number | string = 1) {
  return { jsonrpc: "2.0", id, method, ...(params ? { params } : {}) };
}

function call(message: unknown, headers: McpHttpRequest["headers"] = {}, onToolCall = vi.fn()) {
  return handleMcpRequest({ message, headers, caller, tools, onToolCall });
}

function resultOf<T>(body: unknown): T {
  return (body as { result: T }).result;
}

const MODERN = "2026-07-28";
const modernMeta = { _meta: { "io.modelcontextprotocol/protocolVersion": MODERN } };

describe("legacy protocol (initialize)", () => {
  it("negotiates a supported version and falls back to the newest legacy one", async () => {
    const known = await call(
      rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {} }),
    );
    expect(known.status).toBe(200);
    expect(known.body).toMatchObject({
      result: {
        protocolVersion: "2025-06-18",
        serverInfo: { name: "g-gallery" },
        capabilities: { tools: {} },
      },
    });

    const unknown = await call(rpc("initialize", { protocolVersion: "1999-01-01" }));
    expect(unknown.body).toMatchObject({ result: { protocolVersion: "2025-11-25" } });
  });

  it("lists tools with JSON Schema input and annotations", async () => {
    const { body } = await call(rpc("tools/list"));
    const listed = resultOf<{ tools: Record<string, unknown>[] }>(body).tools;
    expect(listed.map((tool) => tool.name)).toEqual(["echo", "failing"]);
    expect(listed[0]).toMatchObject({
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", minLength: 2 },
          times: { type: "integer", default: 1 },
        },
        required: ["text"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    });
    expect(listed[0]?.inputSchema).not.toHaveProperty("$schema");
    expect(listed[1]).toMatchObject({
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    });
  });

  it("calls a tool with defaults applied and logs the call", async () => {
    const onToolCall = vi.fn();
    const { body } = await call(
      rpc("tools/call", { name: "echo", arguments: { text: "ahoj" } }),
      {},
      onToolCall,
    );
    expect(body).toMatchObject({
      result: { structuredContent: { text: "ahoj", user: "user_1" }, content: [{ type: "text" }] },
    });
    expect(onToolCall).toHaveBeenCalledWith(expect.objectContaining({ tool: "echo", ok: true }));
  });

  it("returns invalid arguments as a tool error in Czech, naming the field", async () => {
    const { body } = await call(
      rpc("tools/call", { name: "echo", arguments: { text: "a", extra: 1 } }),
    );
    const result = resultOf<{ isError: boolean; content: { text: string }[] }>(body);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("„text“");
    expect(result.content[0]?.text).toContain("extra");
  });

  it("separates an expected tool error from a crash, never leaking the crash", async () => {
    const onToolCall = vi.fn();
    const expected = await call(
      rpc("tools/call", { name: "failing", arguments: { kind: "tool" } }),
      {},
      onToolCall,
    );
    expect(expected.body).toMatchObject({
      result: { isError: true, content: [{ text: "Tohle nejde." }] },
    });

    const crash = await call(
      rpc("tools/call", { name: "failing", arguments: { kind: "crash" } }),
      {},
      onToolCall,
    );
    const text = resultOf<{ content: { text: string }[] }>(crash.body).content[0]?.text;
    expect(text).not.toContain("database exploded");
    expect(onToolCall).toHaveBeenLastCalledWith(
      expect.objectContaining({ ok: false, error: "database exploded" }),
    );
  });

  it("answers an unknown tool or method with JSON-RPC errors", async () => {
    const tool = await call(rpc("tools/call", { name: "nope" }));
    expect(tool.body).toMatchObject({ error: { code: -32602 } });
    const method = await call(rpc("resources/list"));
    expect(method.body).toMatchObject({ error: { code: -32601 } });
  });

  it("rejects arguments that are not an object", async () => {
    const { body } = await call(rpc("tools/call", { name: "echo", arguments: ["x"] }));
    expect(body).toMatchObject({ result: { isError: true } });
  });

  it("refuses an unsupported protocol header", async () => {
    const { status } = await call(rpc("tools/list"), { protocolVersion: "2024-11-05" });
    expect(status).toBe(400);
  });
});

describe("modern protocol (2026-07-28)", () => {
  const headersFor = (method: string, name?: string) => ({ protocolVersion: MODERN, method, name });

  it("discovers the server without initialize", async () => {
    const { status, body } = await call(
      rpc("server/discover", modernMeta),
      headersFor("server/discover"),
    );
    expect(status).toBe(200);
    expect(body).toMatchObject({
      result: {
        resultType: "complete",
        supportedVersions: expect.arrayContaining([MODERN, "2025-11-25"]),
      },
    });
  });

  it("calls a tool when the headers agree with the body", async () => {
    const { body } = await call(
      rpc("tools/call", { ...modernMeta, name: "echo", arguments: { text: "ok", times: 2 } }),
      headersFor("tools/call", "echo"),
    );
    expect(body).toMatchObject({
      result: { resultType: "complete", structuredContent: { text: "okok" } },
    });
  });

  it("rejects headers that disagree with the body", async () => {
    const version = await call(rpc("tools/list", modernMeta), { method: "tools/list" });
    const method = await call(rpc("tools/list", modernMeta), headersFor("tools/call"));
    const name = await call(
      rpc("tools/call", { ...modernMeta, name: "echo", arguments: { text: "ok" } }),
      headersFor("tools/call", "failing"),
    );
    for (const response of [version, method, name]) {
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ error: { code: -32020 } });
    }
  });

  it("refuses an unknown modern version and an unknown method", async () => {
    const meta = { _meta: { "io.modelcontextprotocol/protocolVersion": "2099-01-01" } };
    const version = await call(rpc("tools/list", meta), {
      protocolVersion: "2099-01-01",
      method: "tools/list",
    });
    expect(version).toMatchObject({ status: 400, body: { error: { code: -32022 } } });

    const method = await call(rpc("prompts/list", modernMeta), headersFor("prompts/list"));
    expect(method).toMatchObject({ status: 404, body: { error: { code: -32601 } } });
  });

  it("decodes base64-wrapped header values", () => {
    expect(decodeHeaderValue(`=?base64?${Buffer.from("fotky_čtení").toString("base64")}?=`)).toBe(
      "fotky_čtení",
    );
    expect(decodeHeaderValue("tools/list")).toBe("tools/list");
  });
});

describe("message shapes", () => {
  it("accepts notifications and responses without answering", async () => {
    expect(await call({ jsonrpc: "2.0", method: "notifications/initialized" })).toEqual({
      status: 202,
      body: null,
    });
    expect(await call({ jsonrpc: "2.0", id: 9, result: {} })).toEqual({ status: 202, body: null });
  });

  it("rejects anything that is not JSON-RPC 2.0", async () => {
    for (const message of [
      null,
      [],
      { id: 1, method: "ping" },
      { jsonrpc: "2.0", id: {}, method: "ping" },
    ]) {
      expect((await call(message)).status).toBe(400);
    }
    expect(await call({ jsonrpc: "2.0", id: 1, method: "ping", params: [] })).toMatchObject({
      status: 400,
      body: { error: { code: -32602 } },
    });
  });
});
