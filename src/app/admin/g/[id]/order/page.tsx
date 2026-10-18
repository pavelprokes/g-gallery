import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getAdminSession } from "@/lib/auth-guard";
import { compareTimeline } from "@/lib/gallery-chapters";
import {
  CHAPTER_START_SELECT,
  chapterStartOf,
  ORDER_KEY_SELECT,
  photoOrderBy,
  positionOf,
} from "@/lib/photo-order";
import { galleryOrderCrumbs } from "@/lib/admin-breadcrumbs";
import { setPhotoOrder } from "@/app/admin/photo-order-actions";
import { ManualOrderBoard } from "@/components/admin/manual-order-board";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

/**
 * The gallery arranged by hand (docs/PHOTO-ORDER.md §Manual order). Only a
 * gallery in that order is arranged here; any other is offered the switch,
 * which starts from the order it shows now.
 */
export default async function GalleryOrderPage(props: PageProps<"/admin/g/[id]/order">) {
  const session = await getAdminSession();
  if (!session) redirect("/sign-in?next=/admin");

  const { id } = await props.params;
  const gallery = await prisma.gallery.findFirst({
    where: { id, ownerId: session.user.id },
    select: {
      id: true,
      title: true,
      photoOrder: true,
      manualOrderAt: true,
      event: { select: { id: true, title: true } },
      chapters: { select: { title: true, ...CHAPTER_START_SELECT } },
      photos: {
        where: { status: "CONFIRMED" },
        orderBy: photoOrderBy("MANUAL"),
        select: {
          id: true,
          objectKey: true,
          thumbObjectKey: true,
          fileName: true,
          placeholder: true,
          videoObjectKey: true,
          ...ORDER_KEY_SELECT,
        },
      },
    },
  });
  if (!gallery) notFound();

  const header = (
    <PageHeader
      title="Pořadí fotek"
      crumbs={galleryOrderCrumbs(gallery)}
      subtitle="Ruční pořadí — přesně tak, jak fotky uvidí hosté, v gridu, v kapitolách i v ZIPu."
    />
  );

  if (gallery.photoOrder !== "MANUAL") {
    const arrangeByHand = setPhotoOrder.bind(null, gallery.id, "MANUAL");
    return (
      <div className="max-w-2xl space-y-6">
        {header}
        <Alert tone="info">
          {gallery.manualOrderAt
            ? "Galerie teď ukazuje jiné řazení. Ruční pořadí, které jsi tu dřív nastavil, je uložené — po přepnutí se vrátí, nové fotky budou na konci."
            : "Galerie se teď řadí automaticky. Po přepnutí na ruční pořadí začneš od toho současného a fotky pak přetahuješ, kam patří. Nové fotky se přidají na konec."}
        </Alert>
        <form action={arrangeByHand}>
          <Button type="submit" size="lg">
            Řadit ručně
          </Button>
        </form>
      </div>
    );
  }

  // Each chapter's title on the photo it begins at — the first at or after
  // its start, as the guests' grid places it.
  const positions = gallery.photos.map((photo) => positionOf("MANUAL", photo));
  const chapterStarts: Record<string, string[]> = {};
  for (const chapter of gallery.chapters) {
    const start = chapterStartOf("MANUAL", chapter);
    const first = positions.find((p) => compareTimeline(p, start) >= 0);
    if (first) (chapterStarts[first.id] ??= []).push(chapter.title);
  }

  return (
    <div className="space-y-6">
      {header}
      {gallery.photos.length === 0 ? (
        <Alert>Galerie zatím nemá žádné fotky.</Alert>
      ) : (
        <ManualOrderBoard
          galleryId={gallery.id}
          photos={gallery.photos.map((photo) => ({
            id: photo.id,
            objectKey: photo.objectKey,
            thumbObjectKey: photo.thumbObjectKey,
            fileName: photo.fileName,
            placeholder: photo.placeholder,
            isVideo: photo.videoObjectKey !== null,
          }))}
          chapterStarts={chapterStarts}
        />
      )}
    </div>
  );
}
