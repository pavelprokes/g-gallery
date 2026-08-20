import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getAdminSession } from "@/lib/auth-guard";
import { galleryCounts, photoCounts } from "@/lib/activity";
import { Uploader } from "@/components/uploader";
import { ShareLinkPanel } from "@/components/share-link-panel";
import { publishGallery } from "../../actions";

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
      photos: {
        where: { status: "CONFIRMED" },
        orderBy: { sortOrder: "asc" },
        select: { id: true, objectKey: true, fileName: true, width: true, height: true },
      },
      shareLinks: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          label: true,
          expiresAt: true,
          revokedAt: true,
          passwordHash: true,
          createdAt: true,
        },
      },
    },
  });
  if (!gallery) notFound();

  const [counts, perPhoto] = await Promise.all([
    galleryCounts(gallery.id),
    photoCounts(gallery.id),
  ]);

  async function publish() {
    "use server";
    await publishGallery(id);
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-8">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{gallery.title}</h1>
          <p className="text-sm text-neutral-500">
            {gallery.status} · {gallery.photos.length} fotek
          </p>
        </div>
        {gallery.status === "DRAFT" && (
          <form action={publish}>
            <button type="submit" className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white">
              Publikovat
            </button>
          </form>
        )}
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

      <ShareLinkPanel galleryId={gallery.id} shareLinks={gallery.shareLinks} />

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
                <p className="text-xs text-neutral-500">
                  {stats.views} zobr. · {stats.uniqueViewers} unik.
                </p>
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
    <div className="rounded-lg border p-4">
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-neutral-500">{label}</p>
    </div>
  );
}
