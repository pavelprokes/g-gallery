import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getAdminSession } from "@/lib/auth-guard";
import { galleryCounts, photoCounts } from "@/lib/activity";
import { reactionTotals } from "@/lib/reactions";
import { printTotals } from "@/lib/print-selections";
import { Uploader } from "@/components/uploader";
import { DeletePhotoButton } from "@/components/delete-photo-button";
import { CopyButton } from "@/components/copy-button";
import { decryptToken } from "@/lib/token-cipher";
import { ShareLinkPanel } from "@/components/share-link-panel";
import { DeleteGalleryButton } from "@/components/delete-gallery-button";
import { UnpublishGalleryButton } from "@/components/unpublish-gallery-button";
import { GallerySettings } from "@/components/gallery-settings";
import { GalleryPromoPanel } from "@/components/admin/gallery-promo-panel";
import { publishGallery, restoreGallery } from "../../actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CardTitle } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { PageHeader } from "@/components/ui/page-header";
import { galleryCrumbs } from "@/lib/admin-breadcrumbs";

export const dynamic = "force-dynamic";

export default async function GalleryDetailPage(props: PageProps<"/admin/g/[id]">) {
  const session = await getAdminSession();
  if (!session) redirect("/sign-in");

  const { id } = await props.params;
  const { print } = await props.searchParams;
  const printOnly = print === "1";

  const gallery = await prisma.gallery.findFirst({
    where: { id, ownerId: session.user.id },
    select: {
      id: true,
      title: true,
      eventDate: true,
      description: true,
      status: true,
      trashedAt: true,
      eventId: true,
      // Only for the breadcrumb — a gallery hanging off a wedding routes through it.
      event: { select: { id: true, title: true } },
      photos: {
        where: { status: "CONFIRMED" },
        orderBy: [{ favorites: { _count: "desc" } }, { takenAt: "asc" }, { id: "asc" }],
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
          slug: true,
          tokenCipher: true,
        },
      },
      promos: {
        orderBy: { slot: "asc" },
        select: {
          id: true,
          slot: true,
          enabled: true,
          promoCard: { select: { id: true, name: true, headline: true } },
        },
      },
    },
  });
  if (!gallery) notFound();

  // The whole card library, so the picker can offer one that is not placed
  // here yet — and so the panel can tell "no cards written" from "all of them
  // already placed", which are two different empty states.
  const promoCards = await prisma.promoCard.findMany({
    where: { ownerId: session.user.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true },
  });

  const [counts, perPhoto, reactions, printQuantities] = await Promise.all([
    galleryCounts(gallery.id),
    photoCounts(gallery.id),
    reactionTotals(gallery.id),
    printTotals(gallery.id),
  ]);

  const printMarkedPhotos = gallery.photos.filter(
    (photo) => (printQuantities.get(photo.id) ?? 0) > 0,
  );
  const visiblePhotos = printOnly ? printMarkedPhotos : gallery.photos;

  async function publish() {
    "use server";
    await publishGallery(id);
  }

  return (
    <div className="space-y-6">
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

      <PageHeader
        title={gallery.title}
        crumbs={galleryCrumbs(gallery)}
        subtitle={`${gallery.status} · ${gallery.photos.length} fotek`}
        actions={
          <>
            <GallerySettings
              galleryId={gallery.id}
              title={gallery.title}
              eventDate={gallery.eventDate?.toISOString().slice(0, 10) ?? null}
              description={gallery.description}
            />
            {gallery.status === "DRAFT" && (
              <form action={publish}>
                <Button type="submit">Publikovat</Button>
              </form>
            )}
            {gallery.status === "PUBLISHED" && !gallery.trashedAt && (
              <UnpublishGalleryButton galleryId={gallery.id} />
            )}
            {!gallery.trashedAt && <DeleteGalleryButton galleryId={gallery.id} />}
          </>
        }
      />

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
        shareLinks={gallery.shareLinks.map((link) => {
          const token = decryptToken(link.tokenCipher);
          return { ...link, url: token ? `/g/${token}/${link.slug ?? ""}` : null };
        })}
        published={gallery.status === "PUBLISHED"}
        hostedByEvent={gallery.eventId !== null}
      />

      <GalleryPromoPanel
        galleryId={gallery.id}
        photoCount={gallery.photos.length}
        placed={gallery.promos.map((placement) => ({
          placementId: placement.id,
          promoCardId: placement.promoCard.id,
          name: placement.promoCard.name,
          headline: placement.promoCard.headline,
          slot: placement.slot,
          enabled: placement.enabled,
        }))}
        available={promoCards}
      />

      <section>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="mb-0">Fotky — zobrazení a unikátní diváci</CardTitle>
          {printMarkedPhotos.length > 0 && (
            <a
              href={printOnly ? "?" : "?print=1"}
              className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold whitespace-nowrap transition-colors ${
                printOnly
                  ? "border-brand-primary bg-brand-tint text-brand-primary-dark"
                  : "border-admin-border hover:border-brand-primary hover:text-brand-primary text-brand-primary-dark bg-white dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
              }`}
            >
              🖨 {printOnly ? "Zobrazit vše" : `Jen pro tisk (${printMarkedPhotos.length})`}
            </a>
          )}
        </div>
        <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {visiblePhotos.map((photo) => {
            const stats = perPhoto.get(photo.id) ?? { views: 0, uniqueViewers: 0 };
            const printQuantity = printQuantities.get(photo.id) ?? 0;
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
                <p className="text-admin-muted text-xs dark:text-neutral-400">
                  {stats.views} zobr. · {stats.uniqueViewers} unik.
                  {photo._count.favorites > 0 && (
                    <span className="text-rose-600"> · ♥ {photo._count.favorites}</span>
                  )}
                  {(reactions.get(photo.id) ?? 0) > 0 && (
                    <span className="text-amber-600"> · {reactions.get(photo.id)} reakcí</span>
                  )}
                  {printQuantity > 0 && (
                    <span className="text-brand-primary-dark"> · 🖨 {printQuantity}</span>
                  )}
                </p>
                {printQuantity > 0 && (
                  <CopyButton value={photo.fileName} label="Kopírovat název souboru" />
                )}
                <DeletePhotoButton photoId={photo.id} />
              </li>
            );
          })}
        </ul>
        {visiblePhotos.length === 0 && (
          <p className="text-admin-muted mt-3 text-sm dark:text-neutral-400">
            {printOnly ? "Žádná fotka není označená k tisku." : "Zatím žádné potvrzené fotky."}
          </p>
        )}
      </section>
    </div>
  );
}
