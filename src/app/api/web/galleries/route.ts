import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/env";
import { refusalOf, webGallerySummaries } from "@/lib/web-gallery";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

/** Published web galleries with their covers (docs/WEB-GALLERIES.md). */
export async function GET(request: Request) {
  const refusal = refusalOf(request.headers.get("authorization"), serverEnv().WEB_API_SECRET);
  if (refusal === "disabled") return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (refusal) return NextResponse.json({ error: refusal }, { status: 401 });

  return NextResponse.json({ galleries: await webGallerySummaries() });
}
