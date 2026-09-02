import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { resolveShareLink } from "@/lib/share-access";
import { deleteObject } from "@/lib/r2";
import { markGalleryPhotosChanged } from "@/lib/zip-build";

/**
 * The photos this viewer added, and the one thing they may do to them: take
 * one back.
 *
 * This is deliberately *not* moderation (Pavel, 2026-08-23 — moderation stays
 * deferred). Nobody gains power over anyone else's photo: the only row that
 * can be touched is one this same `anonKey` uploaded. What it does buy is the
 * fix for the most common real problem at a wedding — somebody uploads a blurry
 * shot, or one they immediately regret, and right now their only recourse is to
 * find the photographer.
 *
 * No time limit. A window (OnlineSvatba uses six hours) would mostly produce a
 * "this can no longer be deleted" message, which is a worse thing to read than
 * the deletion is a thing to allow. The photo is theirs.
 */
export const dynamic = "force-dynamic";

const anonKeySchema = z.uuid();

/** Which of this gallery's photos the caller uploaded. Ids only. */
export async function GET(request: Request, ctx: RouteContext<"/api/g/[token]/mine">) {
  const { token } = await ctx.params;

  const access = await resolveShareLink(token);
  if (!access.ok) return NextResponse.json({ error: access.reason }, { status: 403 });

  const anonKey = new URL(request.url).searchParams.get("anonKey");
  if (!anonKey || !anonKeySchema.safeParse(anonKey).success) {
    return NextResponse.json({ photoIds: [] });
  }

  const viewer = await prisma.viewer.findUnique({
    where: { galleryId_anonKey: { galleryId: access.shareLink.galleryId, anonKey } },
    select: { id: true },
  });
  if (!viewer) return NextResponse.json({ photoIds: [] });

  const photos = await prisma.photo.findMany({
    where: {
      galleryId: access.shareLink.galleryId,
      source: "GUEST",
      uploadedByViewerId: viewer.id,
    },
    select: { id: true },
  });

  return NextResponse.json({ photoIds: photos.map((photo) => photo.id) });
}

const deleteSchema = z.object({
  anonKey: anonKeySchema,
  photoId: z.string().min(1).max(64),
});

export async function DELETE(request: Request, ctx: RouteContext<"/api/g/[token]/mine">) {
  const { token } = await ctx.params;

  const access = await resolveShareLink(token);
  if (!access.ok) return NextResponse.json({ error: access.reason }, { status: 403 });

  const parsed = deleteSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: "invalid_query" }, { status: 400 });

  const viewer = await prisma.viewer.findUnique({
    where: {
      galleryId_anonKey: { galleryId: access.shareLink.galleryId, anonKey: parsed.data.anonKey },
    },
    select: { id: true },
  });
  if (!viewer) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Every condition matters: the photo must be in *this* gallery, must be a
  // guest upload, and must be attributed to *this* viewer. Anything looser and
  // a leaked photo id becomes a delete button on someone else's memory.
  const photo = await prisma.photo.findFirst({
    where: {
      id: parsed.data.photoId,
      galleryId: access.shareLink.galleryId,
      source: "GUEST",
      uploadedByViewerId: viewer.id,
    },
    select: { id: true, objectKey: true, galleryId: true },
  });
  if (!photo) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Row first: an orphaned object is swept up by the weekly reconcile job,
  // whereas an orphaned row would keep rendering a tile whose bytes are gone.
  await prisma.photo.delete({ where: { id: photo.id } });
  await deleteObject(photo.objectKey);

  // Same staleness rule as an upload: the pre-built archive no longer matches
  // the gallery's contents (docs/TODO.md §7).
  await markGalleryPhotosChanged(photo.galleryId);

  return NextResponse.json({ ok: true });
}
