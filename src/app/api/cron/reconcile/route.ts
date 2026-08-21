import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/env";
import { reconcileGhostUploads, sweepOrphanObjects } from "@/lib/reconcile";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const env = serverEnv();

  if (request.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Ghost rows first: it deletes their objects, so the sweep that follows has
  // nothing left to find for them and the two never race over the same key.
  const ghosts = await reconcileGhostUploads();

  // ListObjectsV2 costs a Class A operation per 1000 keys, so the sweep is
  // opt-in per run rather than part of every nightly reconcile.
  const sweepRequested = new URL(request.url).searchParams.get("sweep") === "1";
  const sweep = sweepRequested ? await sweepOrphanObjects() : null;

  return NextResponse.json({ ok: true, ...ghosts, sweep });
}
