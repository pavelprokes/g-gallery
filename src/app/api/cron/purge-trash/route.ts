import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/env";
import { purgeTrashedGalleries } from "@/lib/reconcile";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Daily sweep for the admin trash (docs/AUDIT.md §3.9). Galleries moved to
 * trash from the admin UI get a 30-day recovery window (`Gallery.purgeAt`);
 * once that passes, this permanently deletes the gallery's R2 objects and
 * its row via `deleteGalleryWithObjects`.
 */
export async function GET(request: Request) {
  const env = serverEnv();

  if (request.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await purgeTrashedGalleries();

  return NextResponse.json({ ok: true, ...result });
}
