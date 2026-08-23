import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/env";
import { prisma } from "@/lib/db";

// Supabase pauses free projects after ~7 days of low activity, and the
// official definition of "activity" never confirms that direct/pooler traffic
// counts — community evidence says direct-connection schedulers have failed.
// So this hits BOTH interpretations: a PostgREST API call that also performs a
// genuine database write (docs/PLAN.md §9).
//
// Scheduled 3x/day via vercel.json. A pause would take down sign-in too
// (better-auth sessions live in Postgres), so alert on non-200.
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  const env = serverEnv();

  const authorization = request.headers.get("authorization");
  if (authorization !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const results: Record<string, string> = {};

  // Primary signal: platform API request + real row write.
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/Keepalive?id=eq.1`, {
      method: "PATCH",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
        // Keepalive lives in the g_gallery schema, not PostgREST's default
        // "public" — this Supabase project is shared with another app.
        "Content-Profile": "g_gallery",
      },
      body: JSON.stringify({ pingedAt: new Date().toISOString() }),
    });
    results.postgrest = response.ok ? "ok" : `failed_${response.status}`;
    if (!response.ok) {
      return NextResponse.json({ error: "postgrest_failed", results }, { status: 502 });
    }
  } else {
    results.postgrest = "skipped_no_credentials";
  }

  // Secondary signal, in case Supabase ever counts pooler traffic instead.
  await prisma.keepalive.upsert({
    where: { id: 1 },
    create: { id: 1 },
    update: { pingedAt: new Date() },
  });
  results.prisma = "ok";

  return NextResponse.json({ ok: true, results });
}
