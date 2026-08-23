import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { resolveShareLink } from "@/lib/share-access";
import { PHOTOS_PAGE_SIZE, decodeCursor, encodeCursor } from "@/lib/photo-cursor";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

const querySchema = z.object({
  cursor: z.string().optional(),
});

/**
 * Keyset (cursor) pagination over a gallery's confirmed photos, newest
 * upload first (`createdAt desc`, 2026-08-23) — the same ordering the first
 * server-rendered page already uses (`src/app/g/[token]/[[...slug]]/page.tsx`),
 * so switching pages never reshuffles what the viewer has already seen.
 * `id` is the tiebreaker: two photos confirmed in the same upload batch can
 * share a millisecond `createdAt`.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/g/[token]/photos">) {
  const { token } = await ctx.params;

  const access = await resolveShareLink(token);
  if (!access.ok) return NextResponse.json({ error: access.reason }, { status: 403 });

  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: "invalid_query" }, { status: 400 });

  const cursor = parsed.data.cursor ? decodeCursor(parsed.data.cursor) : null;
  if (parsed.data.cursor && !cursor) {
    return NextResponse.json({ error: "invalid_cursor" }, { status: 400 });
  }

  const photos = await prisma.photo.findMany({
    where: {
      galleryId: access.shareLink.galleryId,
      status: "CONFIRMED",
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PHOTOS_PAGE_SIZE + 1,
    select: {
      id: true,
      objectKey: true,
      thumbObjectKey: true,
      fileName: true,
      width: true,
      height: true,
      placeholder: true,
      createdAt: true,
      _count: { select: { favorites: true } },
    },
  });

  const hasMore = photos.length > PHOTOS_PAGE_SIZE;
  const page = hasMore ? photos.slice(0, PHOTOS_PAGE_SIZE) : photos;
  const last = page.at(-1);

  return NextResponse.json({
    items: page.map((photo) => ({
      id: photo.id,
      objectKey: photo.objectKey,
      thumbObjectKey: photo.thumbObjectKey,
      fileName: photo.fileName,
      width: photo.width,
      height: photo.height,
      placeholder: photo.placeholder,
      favoriteCount: photo._count.favorites,
    })),
    nextCursor: hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
  });
}
