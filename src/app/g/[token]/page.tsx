import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { resolveShareLink } from "@/lib/share-access";
import { GalleryView } from "@/components/gallery-view";
import { SharePasswordForm } from "@/components/share-password-form";

// Dynamic by definition: token validity, expiry, revocation, and the password
// unlock cookie are checked server-side on every request (docs/PLAN.md §4).
export const dynamic = "force-dynamic";

export default async function SharedGalleryPage(props: PageProps<"/g/[token]">) {
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
      photos: {
        where: { status: "CONFIRMED" },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          objectKey: true,
          fileName: true,
          width: true,
          height: true,
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

  return (
    <GalleryView
      token={token}
      title={gallery.title}
      eventDate={gallery.eventDate?.toLocaleDateString("cs-CZ") ?? null}
      photos={gallery.photos.map((photo) => ({
        id: photo.id,
        objectKey: photo.objectKey,
        fileName: photo.fileName,
        width: photo.width,
        height: photo.height,
        favoriteCount: photo._count.favorites,
      }))}
      viewers={gallery.viewers.map((v) => ({ id: v.id, displayName: v.displayName ?? "" }))}
      allowDownload={access.shareLink.allowDownload}
      allowReactions={access.shareLink.allowReactions}
    />
  );
}
