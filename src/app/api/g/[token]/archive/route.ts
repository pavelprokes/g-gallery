import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { archiveUrlOf } from "@/lib/shared-gallery";
import { resolveShareLink } from "@/lib/share-access";
import { trackServerEvent } from "@/lib/umami";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

/**
 * "Stáhnout vše" for a pre-built archive: counts the download, then redirects
 * to the archive on the CDN. A redirect carries no bytes through Vercel
 * (CLAUDE.md invariant #1), and every way of opening the link — click, middle
 * click, a phone's "download linked file" — passes through here, which a click
 * handler could not promise. It is also where the link's expiry, revocation
 * and download switch are enforced (invariant #5).
 */
export async function GET(request: Request, ctx: RouteContext<"/api/g/[token]/archive">) {
  const { token } = await ctx.params;

  const access = await resolveShareLink(token);
  if (!access.ok) return NextResponse.json({ error: access.reason }, { status: 403 });
  if (!access.shareLink.allowDownload) {
    return NextResponse.json({ error: "DOWNLOAD_DISABLED" }, { status: 403 });
  }

  const gallery = await prisma.gallery.findUnique({
    where: { id: access.shareLink.galleryId },
    select: { zipObjectKey: true, zipBuiltAt: true },
  });
  const url = gallery && archiveUrlOf(gallery.zipObjectKey, gallery.zipBuiltAt);
  if (!url) return NextResponse.json({ error: "no_archive" }, { status: 404 });

  // A resumed download asks again with a Range header, and some download
  // managers probe with HEAD first: both are the same download, not another.
  if (request.method === "GET" && !request.headers.has("range")) {
    // Like the zip route: one DOWNLOAD event, with no viewer attached.
    await prisma.activityEvent.create({
      data: { galleryId: access.shareLink.galleryId, type: "DOWNLOAD" },
    });
    trackServerEvent({
      name: "gallery-download",
      data: { partial: false, prebuilt: true },
      request,
    });
  }

  return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "no-store" } });
}
