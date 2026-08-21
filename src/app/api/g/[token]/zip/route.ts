import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { resolveShareLink } from "@/lib/share-access";
import { MANIFEST_TTL_SECONDS, signManifest, uniqueNames, type Manifest } from "@/lib/zip-manifest";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

/**
 * Mints the signed manifest for one ZIP download.
 *
 * The archive itself is streamed by a Cloudflare Worker straight out of R2 —
 * no image bytes and no ZIP ever pass through Vercel (CLAUDE.md invariant #1).
 * This route only decides *what* may be downloaded and signs that decision.
 */

const bodySchema = z.object({
  /** Empty means the whole gallery — the same request shape either way. */
  photoIds: z.array(z.string().min(1)).max(2000),
});

export async function POST(request: Request, ctx: RouteContext<"/api/g/[token]/zip">) {
  const { token } = await ctx.params;

  // The single gate: publication, revocation, expiry, password cookie.
  const access = await resolveShareLink(token);
  if (!access.ok) return NextResponse.json({ error: access.reason }, { status: 403 });
  if (!access.shareLink.allowDownload) {
    return NextResponse.json({ error: "DOWNLOAD_DISABLED" }, { status: 403 });
  }

  const workerUrl = process.env.ZIP_WORKER_URL;
  const secret = process.env.ZIP_SIGNING_SECRET;
  if (!workerUrl || !secret) {
    // Better an honest 503 than a download button that silently does nothing.
    return NextResponse.json({ error: "ZIP_NOT_CONFIGURED" }, { status: 503 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const { photoIds } = parsed.data;

  // Photos are filtered by galleryId as well as by id: a viewer must not be
  // able to name a photo from someone else's gallery and have it signed.
  const photos = await prisma.photo.findMany({
    where: {
      galleryId: access.shareLink.galleryId,
      status: "CONFIRMED",
      ...(photoIds.length > 0 ? { id: { in: photoIds } } : {}),
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, objectKey: true, fileName: true, sizeBytes: true, crc32: true },
  });

  if (photos.length === 0) {
    return NextResponse.json({ error: "no_photos" }, { status: 404 });
  }

  const gallery = await prisma.gallery.findUnique({
    where: { id: access.shareLink.galleryId },
    select: { title: true },
  });

  const names = uniqueNames(photos.map((photo) => photo.fileName));
  const manifest: Manifest = {
    galleryId: access.shareLink.galleryId,
    // With one photo the Worker serves the file itself, so the archive name is
    // unused — the entry's own name becomes the download name.
    archiveName: archiveNameFor(gallery?.title ?? "galerie", photos.length, photoIds.length > 0),
    entries: photos.map((photo, index) => ({
      key: photo.objectKey,
      name: names[index]!,
      size: photo.sizeBytes ?? 0,
      crc32: photo.crc32,
    })),
    exp: Math.floor(Date.now() / 1000) + MANIFEST_TTL_SECONDS,
  };

  // One DOWNLOAD event for the archive, not one per photo — the owner's feed
  // should read "stáhl 40 fotek", not scroll for a page.
  await prisma.activityEvent.create({
    data: { galleryId: access.shareLink.galleryId, type: "DOWNLOAD" },
  });

  return NextResponse.json({
    url: workerUrl,
    manifest: await signManifest(manifest, secret),
    count: photos.length,
  });
}

/** ASCII-safe: Content-Disposition filenames travel badly with diacritics. */
function archiveNameFor(title: string, count: number, partial: boolean): string {
  const slug =
    title
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase()
      .slice(0, 60) || "galerie";
  return partial ? `${slug}-vyber-${count}.zip` : `${slug}.zip`;
}
