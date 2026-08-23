import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getAdminSession } from "@/lib/auth-guard";
import { galleryCounts, photoCounts } from "@/lib/activity";
import { reactionTotals } from "@/lib/reactions";
import { Uploader } from "@/components/uploader";
import { DeletePhotoButton } from "@/components/delete-photo-button";
import { ShareLinkPanel } from "@/components/share-link-panel";
import { DeleteGalleryButton } from "@/components/delete-gallery-button";
import { publishGallery, restoreGallery } from "../../actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function GalleryDetailPage(props: PageProps<"/admin/g/[id]">) {
  const session = await getAdminSession();
  if (!session) redirect("/sign-in");

  const { id } = await props.params;

  const gallery = await prisma.gallery.findFirst({
    where: { id, ownerId: session.user.id },
    select: {
      id: true,
      title: true,
      status: true,
      trashedAt: true,
      photos: {
        where: { status: "CONFIRMED" },
        orderBy: [{ favorites: { _count: "desc" } }, { createdAt: "asc" }],
        select: {
          id: true,
          objectKey: true,
          fileName: true,
          width: true,
          height: true,
          _count: { select: { favorites: true } },
          source: true,
          uploadedBy: { select: { displayName: true } },
        },
      },
      shareLinks: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          label: true,
          expiresAt: true,
          revokedAt: true,
          passwordHash: true,
          allowUpload: true,
          createdAt: true,
        },
      },
    },
  });
  if (!gallery) notFound();

  const [counts, perPhoto, reactions] = await Promise.all([
    galleryCounts(gallery.id),
    photoCounts(gallery.id),
    reactionTotals(gallery.id),
  ]);

  async function publish() {
    "use server";
    await publishGallery(id);
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-8">
      {gallery.trashedAt && (
        <Alert className="flex items-center justify-between">
          <p>Tato galerie je v koši a bude po uplynutí lhůty natrvalo smazána.</p>
          <form action={restoreGallery.bind(null, gallery.id)}>
            <Button type="submit" variant="secondary" size="sm">
              Obnovit
            </Button>
          </form>
        </Alert>
      )}

      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{gallery.title}</h1>
          <p className="text-sm text-neutral-500">
            {gallery.status} · {gallery.photos.length} fotek
          </p>
        </div>
        <div className="flex items-center gap-2">
          {gallery.status === "DRAFT" && (
            <form action={publish}>
              <Button type="submit">Publikovat</Button>
            </form>
          )}
          {!gallery.trashedAt && <DeleteGalleryButton galleryId={gallery.id} />}
        </div>
      </header>

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Zobrazení" value={counts.views} />
        <Stat label="Unikátní diváci" value={counts.uniqueViewers} />
        <Stat label="Fotek" value={gallery.photos.length} />
        <Stat
          label="Aktivní odkazy"
          value={gallery.shareLinks.filter((l) => !l.revokedAt).length}
        />
      </section>

      <Uploader galleryId={gallery.id} />

      <ShareLinkPanel
        galleryId={gallery.id}
        shareLinks={gallery.shareLinks}
        published={gallery.status === "PUBLISHED"}
      />

      <section>
        <h2 className="text-sm font-medium">Fotky — zobrazení a unikátní diváci</h2>
        <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {gallery.photos.map((photo) => {
            const stats = perPhoto.get(photo.id) ?? { views: 0, uniqueViewers: 0 };
            return (
              <li key={photo.id} className="space-y-1">
                <div className="relative aspect-square overflow-hidden rounded bg-neutral-100 dark:bg-neutral-900">
                  <Image
                    src={photo.objectKey}
                    alt={photo.fileName}
                    fill
                    sizes="(max-width: 640px) 50vw, 200px"
                    className="object-cover"
                  />
                </div>
                {photo.source === "GUEST" && (
                  <p className="text-xs text-emerald-700 dark:text-emerald-400">
                    Od hostů
                    {photo.uploadedBy?.displayName && ` · ${photo.uploadedBy.displayName}`}
                  </p>
                )}
                <p className="text-xs text-neutral-500">
                  {stats.views} zobr. · {stats.uniqueViewers} unik.
                  {photo._count.favorites > 0 && (
                    <span className="text-rose-600"> · ♥ {photo._count.favorites}</span>
                  )}
                  {(reactions.get(photo.id) ?? 0) > 0 && (
                    <span className="text-amber-600"> · {reactions.get(photo.id)} reakcí</span>
                  )}
                </p>
                <DeletePhotoButton photoId={photo.id} />
              </li>
            );
          })}
        </ul>
        {gallery.photos.length === 0 && (
          <p className="mt-3 text-sm text-neutral-500">Zatím žádné potvrzené fotky.</p>
        )}
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-neutral-500">{label}</p>
    </Card>
  );
}
