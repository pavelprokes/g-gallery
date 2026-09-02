import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/env";
import { failStaleZipBuilds, kickoffPendingZipBuild } from "@/lib/zip-build";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function GET(request: Request) {
  const env = serverEnv();

  if (request.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Stale sweep first: a gallery it records as FAILED can be picked up by the
  // kickoff call that follows in the same run once its backoff has elapsed,
  // rather than waiting a full extra tick.
  const staleFailed = await failStaleZipBuilds();
  const kickoff = await kickoffPendingZipBuild();

  // `kickoff` carries the reason nothing was built, not just the fact of it.
  // A silently empty response here is what let a whole day of "Připravujeme
  // archiv" look, from the outside, exactly like a healthy idle queue.
  return NextResponse.json({ ok: true, staleFailed, kickoff });
}
