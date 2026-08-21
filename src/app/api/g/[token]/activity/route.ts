import { NextResponse } from "next/server";
import { z } from "zod";
import { recordActivity } from "@/lib/activity";
import { pushNewViewer } from "@/lib/push";
import { resolveShareLink } from "@/lib/share-access";

// Beacon target for the public gallery. Short-lived request/response only —
// no Vercel route ever holds a connection open (CLAUDE.md invariant #6).
export const dynamic = "force-dynamic";
export const maxDuration = 10;

const bodySchema = z.object({
  anonKey: z.uuid(),
  type: z.enum(["GALLERY_VIEW", "PHOTO_VIEW"]),
  photoId: z.string().min(1).optional(),
});

export async function POST(request: Request, ctx: RouteContext<"/api/g/[token]/activity">) {
  const { token } = await ctx.params;

  const access = await resolveShareLink(token);
  if (!access.ok) return NextResponse.json({ error: access.reason }, { status: 404 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const result = await recordActivity({
    galleryId: access.shareLink.galleryId,
    shareLinkId: access.shareLink.id,
    anonKey: parsed.data.anonKey,
    photoId: parsed.data.photoId,
    type: parsed.data.type,
  });

  // Only a genuinely new session is news; the 5-minute heartbeat is not.
  // Awaited rather than fired-and-forgotten: a Vercel function can be frozen
  // the moment the response is returned, killing an unawaited promise.
  if (result.newSession) {
    await pushNewViewer(access.shareLink.galleryId, result.viewerName);
  }

  // sendBeacon ignores the body; keep the response minimal.
  return new NextResponse(null, { status: 204 });
}
