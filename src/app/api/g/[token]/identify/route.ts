import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { resolveShareLink } from "@/lib/share-access";

// "Komu za ně poděkovat?" — the name a guest volunteers after adding photos
// (docs/GUEST-GALLERIES.md §6). Until now a display name could only be set as a
// side effect of favouriting or reacting, which is not a path the upload flow
// should have to fake.
//
// Deliberately not gated on `allowUpload`: naming yourself is something any
// viewer of the gallery may do, and the favourite/reaction routes already allow
// exactly that.
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  anonKey: z.string().min(1).max(64),
  displayName: z.string().trim().min(1).max(60),
});

export async function POST(request: Request, ctx: RouteContext<"/api/g/[token]/identify">) {
  const { token } = await ctx.params;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const access = await resolveShareLink(token);
  if (!access.ok) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { anonKey, displayName } = parsed.data;

  // Upsert rather than update: a guest who uploaded while opted out has no
  // viewer row of their own to name, and one who has never favourited anything
  // may not have one either.
  const viewer = await prisma.viewer.upsert({
    where: { galleryId_anonKey: { galleryId: access.shareLink.galleryId, anonKey } },
    create: {
      galleryId: access.shareLink.galleryId,
      shareLinkId: access.shareLink.id,
      anonKey,
      displayName,
    },
    update: { displayName, lastSeenAt: new Date() },
    select: { optedOut: true },
  });

  // Opting out means "keep no record of me"; volunteering a name does not
  // silently reverse that, so the write is rolled back rather than honoured.
  if (viewer.optedOut) {
    await prisma.viewer.update({
      where: { galleryId_anonKey: { galleryId: access.shareLink.galleryId, anonKey } },
      data: { displayName: null },
    });
    return NextResponse.json({ ok: false, reason: "opted_out" }, { status: 409 });
  }

  return NextResponse.json({ ok: true });
}
