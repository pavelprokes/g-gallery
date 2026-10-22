import { after, NextResponse } from "next/server";
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
 * and download switch are checked (invariant #5) — though a guest who has
 * downloaded once keeps the archive's CDN URL, as they keep the archive.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/g/[token]/archive">) {
  const { token } = await ctx.params;

  const access = await resolveShareLink(token);
  if (!access.ok || !access.shareLink.allowDownload) return backToGallery(request);

  const gallery = await prisma.gallery.findUnique({
    where: { id: access.shareLink.galleryId },
    select: { zipObjectKey: true, zipBuiltAt: true },
  });
  const url = gallery && archiveUrlOf(gallery.zipObjectKey, gallery.zipBuiltAt);
  if (!url) return backToGallery(request);

  // A resumed download asks again from a later byte, and some download
  // managers probe with HEAD first: both are the same download, not another.
  // `bytes=0-` is a first request from a manager that likes ranges.
  const range = request.headers.get("range");
  if (request.method === "GET" && (!range || /^bytes=0-/.test(range))) {
    const galleryId = access.shareLink.galleryId;
    // After the response: counting a download must never be what stops one.
    after(() =>
      prisma.activityEvent
        // Like the zip route: one DOWNLOAD event, with no viewer attached.
        .create({ data: { galleryId, type: "DOWNLOAD" } })
        .catch((error: unknown) => console.error("archive download not recorded", error)),
    );
    trackServerEvent({
      name: "gallery-download",
      data: { partial: false, prebuilt: true },
      request,
    });
  }

  return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "no-store" } });
}

/**
 * This URL is opened by navigation, so a JSON error would be all the guest
 * sees. Back to the gallery page the click came from instead, which explains
 * an expired link or asks for the password itself.
 */
function backToGallery(request: Request): NextResponse {
  const origin = new URL(request.url).origin;
  const referer = request.headers.get("referer");
  const fromHere = referer !== null && URL.canParse(referer) && new URL(referer).origin === origin;
  return NextResponse.redirect(fromHere ? referer : origin, 303);
}
