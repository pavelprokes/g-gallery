import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminSession } from "@/lib/auth-guard";
import { metaConfigured } from "@/lib/instagram/config";
import { ConnectError, connectFromCode } from "@/lib/instagram/connection";
import { GraphError } from "@/lib/instagram/graph";
import {
  CALLBACK_PATH,
  reelsWith,
  RETURN_COOKIE,
  STATE_COOKIE,
  stateMatches,
} from "@/lib/instagram/oauth-state";
import { publicOrigin } from "@/lib/mcp/oauth/config";

// Where Facebook's sign-in returns (docs/INSTAGRAM-AUDIO.md). The
// session is re-verified (CLAUDE.md invariant #3), the `state` must match the
// cookie set by /connect, and only then is the code exchanged.
export const dynamic = "force-dynamic";

const params = z.union([
  z.object({ code: z.string().min(1).max(2048), state: z.string().min(1).max(256) }),
  z.object({ error: z.string().max(256), state: z.string().max(256).optional() }),
]);

export async function GET(request: Request): Promise<Response> {
  const origin = publicOrigin(request.headers);
  const session = await getAdminSession();
  if (!session) return NextResponse.redirect(`${origin}/sign-in?next=/admin/reels`);
  if (!metaConfigured()) return NextResponse.redirect(reelsWith(origin, "not-configured"));

  const jar = await cookies();
  const expected = jar.get(STATE_COOKIE)?.value;
  const back = jar.get(RETURN_COOKIE)?.value;
  jar.delete({ name: STATE_COOKIE, path: CALLBACK_PATH });
  jar.delete({ name: RETURN_COOKIE, path: CALLBACK_PATH });

  const parsed = params.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return NextResponse.redirect(reelsWith(origin, "bad-request", back));
  if ("error" in parsed.data) return NextResponse.redirect(reelsWith(origin, "denied", back));
  if (!stateMatches(expected, parsed.data.state)) {
    return NextResponse.redirect(reelsWith(origin, "bad-state", back));
  }

  try {
    await connectFromCode(session.user.id, parsed.data.code, `${origin}${CALLBACK_PATH}`);
    return NextResponse.redirect(reelsWith(origin, "connected", back));
  } catch (error) {
    if (error instanceof ConnectError) {
      return NextResponse.redirect(reelsWith(origin, error.reason, back));
    }
    if (error instanceof GraphError) {
      console.warn(
        "[g-gallery/instagram] connect failed",
        error.code,
        error.subcode,
        error.message,
      );
      return NextResponse.redirect(reelsWith(origin, "graph", back));
    }
    throw error;
  }
}
