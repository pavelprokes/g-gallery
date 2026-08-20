import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/env";
import { reconcileGhostUploads } from "@/lib/reconcile";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const env = serverEnv();

  if (request.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await reconcileGhostUploads();
  return NextResponse.json({ ok: true, ...result });
}
