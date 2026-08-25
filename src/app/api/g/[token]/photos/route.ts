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
 * Keyset (cursor) pagination over a gallery's confirmed photos, in capture
 * order — oldest shot first (`takenAt asc`, 2026-08-25), the day as it
 * happened. The same ordering the first server-rendered page already uses
 * (`src/app/g/[token]/[[...slug]]/page.tsx`), so switching pages never
 * reshuffles what the viewer has already seen. `id` is the tiebreaker: EXIF
 * time is second-resolution, so a burst shares a `takenAt`.
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
              { takenAt: { gt: cursor.takenAt } },
              { takenAt: cursor.takenAt, id: { gt: cursor.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ takenAt: "asc" }, { id: "asc" }],
    take: PHOTOS_PAGE_SIZE + 1,
    select: {
      id: true,
      objectKey: true,
      thumbObjectKey: true,
      fileName: true,
      width: true,
      height: true,
      placeholder: true,
      takenAt: true,
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
    // `takenAt` is set on every confirm and backfilled for the back catalogue;
    // `createdAt` covers the impossible null without throwing away the page.
    nextCursor:
      hasMore && last
        ? encodeCursor({ takenAt: last.takenAt ?? last.createdAt, id: last.id })
        : null,
  });
}
