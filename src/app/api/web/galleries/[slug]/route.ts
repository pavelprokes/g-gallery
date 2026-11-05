import { NextResponse } from "next/server";
import { z } from "zod";
import { serverEnv } from "@/lib/env";
import { WEB_SLUG_MAX, WEB_SLUG_PATTERN, refusalOf, webGalleryBySlug } from "@/lib/web-gallery";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

const slugSchema = z.string().max(WEB_SLUG_MAX).regex(WEB_SLUG_PATTERN);

/**
 * One published web gallery (docs/WEB-GALLERIES.md). 404 means "not a web gallery":
 * the website then keeps using its previous source, gallery by gallery.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/web/galleries/[slug]">) {
  const refusal = refusalOf(request.headers.get("authorization"), serverEnv().WEB_API_SECRET);
  if (refusal === "disabled") return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (refusal) return NextResponse.json({ error: refusal }, { status: 401 });

  const slug = slugSchema.safeParse((await ctx.params).slug);
  const gallery = slug.success ? await webGalleryBySlug(slug.data) : null;
  if (!gallery) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(gallery);
}
