import { NextResponse } from "next/server";
import { publicOrigin } from "@/lib/mcp/oauth/config";
import { grantTokens, type TokenParams } from "@/lib/mcp/oauth/token-grant";

// OAuth 2.1 token endpoint for the MCP connection (docs/MCP.md §Sign-in).
export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "no-store", Pragma: "no-cache" };

export async function POST(request: Request): Promise<Response> {
  if (
    !(request.headers.get("content-type") ?? "").startsWith("application/x-www-form-urlencoded")
  ) {
    return NextResponse.json(
      { error: "invalid_request", error_description: "Use application/x-www-form-urlencoded" },
      { status: 400, headers: HEADERS },
    );
  }
  try {
    const form = new URLSearchParams(await request.text());
    const params: TokenParams = Object.fromEntries(form.entries());
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
