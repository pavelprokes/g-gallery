import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminSession } from "@/lib/auth-guard";
import {
  authorizationResponseUrl,
  issueAuthorizationCode,
  parseAuthorizeRequest,
  pickAuthorizeParams,
} from "@/lib/mcp/oauth/authorization";
import { publicOrigin } from "@/lib/mcp/oauth/config";

// The consent page's decision (src/app/oauth/authorize/page.tsx). The session
// is re-verified here — the page only showed the question (CLAUDE.md
// invariant #3) — and the request is re-parsed, never trusted from the page.
export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "private, no-store" };

const bodySchema = z.object({
  decision: z.enum(["allow", "deny"]),
  params: z.record(z.string(), z.unknown()),
});

function reply(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: HEADERS });
}

export async function POST(request: Request): Promise<Response> {
  try {
    const origin = publicOrigin(request.headers);
    // Only this site's own page may decide — a cross-site form cannot.
    if (request.headers.get("origin") !== origin) {
      return reply({ error: "Požadavek nepřišel ze stránky galerií." }, 403);
    }
    if (!(request.headers.get("content-type") ?? "").includes("application/json")) {
      return reply({ error: "Očekávám JSON." }, 415);
    }
    const session = await getAdminSession();
    if (!session) return reply({ error: "Přihlaste se prosím znovu účtem správce." }, 401);

    const input = bodySchema.safeParse(await request.json().catch(() => null));
    if (!input.success) return reply({ error: "Chybí rozhodnutí." }, 400);

    const parsed = await parseAuthorizeRequest(pickAuthorizeParams(input.data.params), origin);
    if (!parsed.ok) {
      return parsed.redirectTo
        ? reply({ redirectTo: parsed.redirectTo }, 200)
        : reply({ error: parsed.message }, 400);
    }

    const { request: authorize } = parsed;
    const redirectTo =
      input.data.decision === "allow"
        ? await issueAuthorizationCode(authorize, session.user.id, origin)
        : authorizationResponseUrl(authorize.redirectUri, origin, authorize.state, {
            error: "access_denied",
            error_description: "The user denied access",
          });
    console.info(
      JSON.stringify({
        event: "mcp.oauth.consent",
        email: session.user.email,
        client_id: authorize.client.clientId,
        decision: input.data.decision,
      }),
    );
    return reply({ redirectTo }, 200);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "mcp.oauth.error",
        message: error instanceof Error ? error.message : "unknown",
      }),
    );
    return reply({ error: "Povolení se nepodařilo uložit. Zkuste to prosím znovu." }, 500);
  }
}
