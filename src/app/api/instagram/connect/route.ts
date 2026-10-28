import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminSession } from "@/lib/auth-guard";
import { authorizeUrl, metaApp, metaConfigured } from "@/lib/instagram/config";
import {
  CALLBACK_PATH,
  newState,
  reelsWith,
  RETURN_COOKIE,
  safeReturn,
  STATE_COOKIE,
  STATE_MAX_AGE_SECONDS,
} from "@/lib/instagram/oauth-state";
import { publicOrigin } from "@/lib/mcp/oauth/config";

// "Připojit Instagram" (docs/INSTAGRAM-AUDIO.md): the admin is sent to
// Facebook's sign-in with a fresh `state`; Meta returns to the callback.
export const dynamic = "force-dynamic";

/** Only where to return to — checked again by `safeReturn`. */
const params = z.object({ next: z.string().max(1100).optional() });

export async function GET(request: Request): Promise<Response> {
  const origin = publicOrigin(request.headers);
  const session = await getAdminSession();
  if (!session) return NextResponse.redirect(`${origin}/sign-in?next=/admin/reels`);
  if (!metaConfigured()) return NextResponse.redirect(reelsWith(origin, "not-configured"));

  const state = newState();
  const jar = await cookies();
  const options = {
    httpOnly: true,
    secure: origin.startsWith("https://"),
    // Lax: the cookie must come back on Meta's top-level redirect to us.
    sameSite: "lax" as const,
    path: CALLBACK_PATH,
    maxAge: STATE_MAX_AGE_SECONDS,
  };
  jar.set(STATE_COOKIE, state, options);
  const query = params.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  jar.set(RETURN_COOKIE, safeReturn(query.success ? query.data.next : null), options);
  return NextResponse.redirect(
    authorizeUrl({
      appId: metaApp().id,
      redirectUri: `${origin}${CALLBACK_PATH}`,
      state,
      configId: process.env.META_LOGIN_CONFIG_ID || undefined,
    }),
  );
}
