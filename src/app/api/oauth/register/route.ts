import { NextResponse } from "next/server";
import { registrationEnabled } from "@/lib/mcp/oauth/config";
import { registerClient } from "@/lib/mcp/oauth/registration";

// Dynamic Client Registration (RFC 7591) for the photographer's own MCP
// clients — only on origins in MCP_OAUTH_REDIRECT_ORIGINS (docs/MCP.md §Other clients).
export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "no-store", Pragma: "no-cache" };
const MAX_BODY_BYTES = 16 * 1024;

function invalidMetadata(description: string) {
  return NextResponse.json(
    { error: "invalid_client_metadata", error_description: description },
    { status: 400, headers: HEADERS },
  );
}

export async function POST(request: Request): Promise<Response> {
  if (!registrationEnabled()) {
    return NextResponse.json(
      { error: "not_found", error_description: "Client registration is not enabled" },
      { status: 404, headers: HEADERS },
    );
  }
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) {
    return invalidMetadata("Use application/json");
  }
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) return invalidMetadata("Body too large");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return invalidMetadata("Body is not valid JSON");
  }

  const result = registerClient(body);
  // A refused address is logged too: it is what to add to MCP_OAUTH_REDIRECT_ORIGINS.
  const requested =
    typeof body === "object" && body !== null && "redirect_uris" in body
      ? body.redirect_uris
      : null;
  console.info(
    JSON.stringify({
      event: "mcp.oauth.register",
      client_name: result.ok ? result.body.client_name : null,
      redirect_uris: Array.isArray(requested) ? requested.slice(0, 5).map(String) : null,
      outcome: result.ok ? "ok" : result.body.error,
    }),
  );
  return NextResponse.json(result.body, { status: result.ok ? 201 : 400, headers: HEADERS });
}
