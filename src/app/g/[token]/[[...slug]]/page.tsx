import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { resolveShareLink } from "@/lib/share-access";
import { GalleryView } from "@/components/gallery-view";
import { SharePasswordForm } from "@/components/share-password-form";
import { PHOTOS_PAGE_SIZE, encodeCursor } from "@/lib/photo-cursor";
import {
  IMAGE_GRANT_TTL_SECONDS,
  signImageAccess,
  type SignedImageGrant,
} from "@/lib/image-signing";

// Dynamic by definition: token validity, expiry, revocation, and the password
// unlock cookie are checked server-side on every request (docs/PLAN.md §4).
export const dynamic = "force-dynamic";

// The trailing [[...slug]] is cosmetic only (docs/TODO.md §6) — never parsed,
// never part of resolution. `/g/{token}` and `/g/{token}/{anything}` resolve
// identically; the slug just makes a copy-pasted or bookmarked URL readable.

// Share links are unguessable but not access-controlled against crawlers, so
// every gallery page must stay out of search indexes unconditionally. The
// title is looked up separately from the page component (Next doesn't share
// results between generateMetadata and the page render) and must never leak
// a gallery's title for a token that fails to resolve (revoked, expired,
// password-gated, or unknown) — fall back to a neutral placeholder instead.
export async function generateMetadata(
  props: PageProps<"/g/[token]/[[...slug]]">,
): Promise<Metadata> {
  const { token } = await props.params;

  const access = await resolveShareLink(token);

  if (!access.ok) {
    return { title: "Galerie", robots: { index: false, follow: false } };
  }

  const gallery = await prisma.gallery.findUnique({
    where: { id: access.shareLink.galleryId },
    select: { title: true },
  });

  return {
    title: gallery?.title ?? "Galerie",
    robots: { index: false, follow: false },
  };
}

export default async function SharedGalleryPage(props: PageProps<"/g/[token]/[[...slug]]">) {
  const { token } = await props.params;

  const access = await resolveShareLink(token);

  if (!access.ok) {
    if (access.reason === "PASSWORD_REQUIRED") return <SharePasswordForm token={token} />;

    if (access.reason === "EXPIRED" || access.reason === "REVOKED") {
      return (
        <main className="flex min-h-dvh items-center justify-center p-8 text-center">
          <div>
            <h1 className="text-xl font-semibold">Odkaz už není platný</h1>
            <p className="mt-2 text-sm text-neutral-500">
              Požádej fotografa o nový odkaz na galerii.
            </p>
          </div>
        </main>
      );
    }
    notFound();
  }

  const gallery = await prisma.gallery.findUnique({
    where: { id: access.shareLink.galleryId },
    select: {
      id: true,
      title: true,
      eventDate: true,
      storagePrefix: true,
      // docs/TODO.md §7 — pre-built "download all" archive, ready or not.
      zipStatus: true,
      zipObjectKey: true,
      // One extra row over the page size tells us whether a next page exists
      // without a separate COUNT query — the same trick the cursor-paginated
      // API route uses for every subsequent page.
      photos: {
        where: { status: "CONFIRMED" },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: PHOTOS_PAGE_SIZE + 1,
        select: {
          id: true,
          objectKey: true,
          fileName: true,
          width: true,
          height: true,
          placeholder: true,
          createdAt: true,
          _count: { select: { favorites: true } },
        },
      },
      viewers: {
        where: { displayName: { not: null }, optedOut: false },
        orderBy: { lastSeenAt: "desc" },
        take: 12,
        select: { id: true, displayName: true },
      },
    },
  });
  if (!gallery) notFound();

  const hasMore = gallery.photos.length > PHOTOS_PAGE_SIZE;
  const page = hasMore ? gallery.photos.slice(0, PHOTOS_PAGE_SIZE) : gallery.photos;
  const last = page.at(-1);
  const initialCursor =
    hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null;

  const imageGrant = await mintImageGrant(gallery.storagePrefix);

  // The finished archive is a plain CDN link — no Worker involved at
  // download time (docs/TODO.md §7). Built server-side since
  // NEXT_PUBLIC_PHOTOS_BASE_URL is the same public, build-time value the
  // custom image loader already uses.
  const archiveZipUrl =
    gallery.zipStatus === "READY" && gallery.zipObjectKey && process.env.NEXT_PUBLIC_PHOTOS_BASE_URL
      ? `${process.env.NEXT_PUBLIC_PHOTOS_BASE_URL.replace(/\/$/, "")}/${gallery.zipObjectKey
          .split("/")
          .map(encodeURIComponent)
          .join("/")}`
      : null;

  return (
    <GalleryView
      token={token}
      title={gallery.title}
      eventDate={gallery.eventDate?.toLocaleDateString("cs-CZ") ?? null}
      archiveZipUrl={archiveZipUrl}
      initialPhotos={page.map((photo) => ({
        id: photo.id,
        objectKey: photo.objectKey,
        fileName: photo.fileName,
        width: photo.width,
        height: photo.height,
        placeholder: photo.placeholder,
        favoriteCount: photo._count.favorites,
      }))}
      initialCursor={initialCursor}
      imageGrant={imageGrant}
      viewers={gallery.viewers.map((v) => ({ id: v.id, displayName: v.displayName ?? "" }))}
      allowDownload={access.shareLink.allowDownload}
      allowReactions={access.shareLink.allowReactions}
    />
  );
}

/**
 * Signs image access for this gallery's whole `storagePrefix`, or returns
 * `null` when signing isn't configured — the loader (`src/lib/image-loader.ts`)
 * falls back to today's unsigned direct-CDN URLs either way, so this is safe
 * to deploy before the signing Worker exists (docs/PLAN.md §4.1).
 */
async function mintImageGrant(storagePrefix: string): Promise<SignedImageGrant | null> {
  const secret = process.env.IMAGE_SIGNING_SECRET;
  if (!secret) return null;

  const exp = Math.floor(Date.now() / 1000) + IMAGE_GRANT_TTL_SECONDS;
  return { exp, sig: await signImageAccess({ prefix: storagePrefix, exp }, secret) };
}
