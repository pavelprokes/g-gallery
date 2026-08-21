import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { resolveShareLink } from "@/lib/share-access";
import { galleryReactions, toggleReaction } from "@/lib/reactions";
import { isReactionKind, REACTION_KINDS } from "@/lib/reactions-shared";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

const bodySchema = z.object({
  anonKey: z.uuid(),
  photoId: z.string().min(1),
  kind: z.enum(REACTION_KINDS),
  /** Optional: the "Kdo se dívá?" prompt — Google Photos' join moment. */
  displayName: z.string().trim().min(1).max(60).optional(),
});

/** Tallies for the whole gallery plus this viewer's own picks, for first paint. */
export async function GET(request: Request, ctx: RouteContext<"/api/g/[token]/reaction">) {
  const { token } = await ctx.params;

  const access = await resolveShareLink(token);
  if (!access.ok) return NextResponse.json({ error: access.reason }, { status: 403 });

  const anonKey = new URL(request.url).searchParams.get("anonKey");
  const viewer =
    anonKey && z.uuid().safeParse(anonKey).success
      ? await prisma.viewer.findUnique({
          where: { galleryId_anonKey: { galleryId: access.shareLink.galleryId, anonKey } },
          select: { id: true },
        })
      : null;

  const byPhoto = await galleryReactions(access.shareLink.galleryId, viewer?.id);
  return NextResponse.json({ reactions: Object.fromEntries(byPhoto) });
}

export async function POST(request: Request, ctx: RouteContext<"/api/g/[token]/reaction">) {
  const { token } = await ctx.params;

  // The single gate — publication, revocation, expiry and the password unlock
  // cookie are all checked here (CLAUDE.md invariant #5).
  const access = await resolveShareLink(token);
  if (!access.ok) return NextResponse.json({ error: access.reason }, { status: 403 });
  if (!access.shareLink.allowReactions) {
    return NextResponse.json({ error: "REACTIONS_DISABLED" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const { anonKey, photoId, kind, displayName } = parsed.data;
  if (!isReactionKind(kind)) {
    return NextResponse.json({ error: "invalid_kind" }, { status: 400 });
  }

  // The photo must belong to THIS gallery, or a share link would let a viewer
  // react to photos in someone else's gallery.
  const photo = await prisma.photo.findFirst({
    where: { id: photoId, galleryId: access.shareLink.galleryId, status: "CONFIRMED" },
    select: { id: true },
  });
  if (!photo) return NextResponse.json({ error: "photo_not_found" }, { status: 404 });

  const now = new Date();
  const viewer = await prisma.viewer.upsert({
    where: { galleryId_anonKey: { galleryId: access.shareLink.galleryId, anonKey } },
    create: {
      galleryId: access.shareLink.galleryId,
      shareLinkId: access.shareLink.id,
      anonKey,
      displayName,
      lastSeenAt: now,
    },
    update: { lastSeenAt: now, ...(displayName ? { displayName } : {}) },
    select: { id: true, optedOut: true, displayName: true },
  });

  if (viewer.optedOut) return NextResponse.json({ error: "OPTED_OUT" }, { status: 403 });

  const result = await toggleReaction(photo.id, viewer.id, kind);

  // Only a new reaction is an event; clearing one is not something the owner
  // needs in their feed.
  if (result) {
    await prisma.activityEvent.create({
      data: {
        galleryId: access.shareLink.galleryId,
        photoId: photo.id,
        viewerId: viewer.id,
        type: "REACTION",
      },
    });
  }

  const grouped = await prisma.reaction.groupBy({
    by: ["kind"],
    where: { photoId: photo.id },
    _count: { _all: true },
  });

  return NextResponse.json({
    ok: true,
    mine: result,
    counts: Object.fromEntries(grouped.map((row) => [row.kind, row._count._all])),
    displayName: viewer.displayName,
  });
}
