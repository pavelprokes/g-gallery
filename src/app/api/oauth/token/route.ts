import { NextResponse } from "next/server";
import { z } from "zod";
import { publicOrigin } from "@/lib/mcp/oauth/config";
import { grantTokens, type TokenParams } from "@/lib/mcp/oauth/token-grant";

// OAuth 2.1 token endpoint for the MCP connection (docs/MCP.md §Sign-in).
export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "no-store", Pragma: "no-cache" };

const field = z.string().max(2048).optional();

/** The parameters either grant reads (RFC 6749 §4.1.3, §6; RFC 8707); anything else is ignored. */
const paramsSchema = z.object({
  grant_type: field,
  code: field,
  code_verifier: field,
  client_id: field,
  redirect_uri: field,
  refresh_token: field,
  scope: field,
  resource: field,
});

function invalidRequest(description: string) {
  return NextResponse.json(
    { error: "invalid_request", error_description: description },
    { status: 400, headers: HEADERS },
  );
}

export async function POST(request: Request): Promise<Response> {
  if (
    !(request.headers.get("content-type") ?? "").startsWith("application/x-www-form-urlencoded")
  ) {
    return invalidRequest("Use application/x-www-form-urlencoded");
  }
  try {
    const form = new URLSearchParams(await request.text());
    // "Request and response parameters MUST NOT be included more than once" (RFC 6749 §3.2).
    const names = [...form.keys()];
    if (new Set(names).size !== names.length) return invalidRequest("Repeated parameter");
    const parsed = paramsSchema.safeParse(Object.fromEntries(form.entries()));
    if (!parsed.success) return invalidRequest("Malformed parameter");
    const params: TokenParams = parsed.data;
    const result = await grantTokens(params, publicOrigin(request.headers));
    console.info(
      JSON.stringify({
        event: "mcp.oauth.token",
        grant_type: params.grant_type ?? null,
        client_id: params.client_id ?? null,
        outcome: result.status === 200 ? "ok" : result.body.error,
      }),
    );
    return NextResponse.json(result.body, { status: result.status, headers: HEADERS });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "mcp.oauth.error",
        message: error instanceof Error ? error.message : "unknown",
      }),
    );
    return NextResponse.json(
      { error: "server_error", error_description: "Internal error" },
      { status: 500, headers: HEADERS },
    );
  }
}
