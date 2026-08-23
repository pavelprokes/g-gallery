import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/env";
import { kickoffPendingZipBuild, resetStaleZipBuilds } from "@/lib/zip-build";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function GET(request: Request) {
  const env = serverEnv();

  if (request.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Stale sweep first: a gallery it resets to PENDING can be picked up by
  // the kickoff call that follows in the same run, rather than waiting a
  // full extra tick.
  const staleReset = await resetStaleZipBuilds();
  const kickoff = await kickoffPendingZipBuild();

  return NextResponse.json({ ok: true, staleReset, kickoff });
}
