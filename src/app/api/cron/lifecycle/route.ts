import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/env";
import { tierColdGalleries } from "@/lib/lifecycle";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Monthly retention pass (docs/PLAN.md decision #4). Nothing is deleted; cold
 * originals are recorded as Infrequent Access. `?dryRun=1` reports what would
 * change without writing.
 */
export async function GET(request: Request) {
  const env = serverEnv();

  if (request.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";
  const result = await tierColdGalleries({ dryRun });

  return NextResponse.json({ ok: true, dryRun, ...result });
}
