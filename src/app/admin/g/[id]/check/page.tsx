import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getAdminSession } from "@/lib/auth-guard";
import { compareTimeline } from "@/lib/gallery-chapters";
import { ORDER_KEY_SELECT, positionOf } from "@/lib/photo-order";
import { currentFaces } from "@/lib/social-video/faces";
import { galleryCheckCrumbs } from "@/lib/admin-breadcrumbs";
import { PhotoCheckBoard, type CheckPhoto } from "@/components/admin/photo-check-board";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

/**
 * Closed and soft eyes, before the couple sees them (docs/SOCIAL-VIDEO.md §4,
 * "The photo check"). Faces are found in the photographer's browser, as on the
 * video page; this page only hands it the photos and what is already known.
 */
export default async function PhotoCheckPage(props: PageProps<"/admin/g/[id]/check">) {
  const session = await getAdminSession();
  if (!session) redirect("/sign-in?next=/admin");

  const { id } = await props.params;
  const gallery = await prisma.gallery.findFirst({
    where: { id, ownerId: session.user.id },
    select: {
      id: true,
      title: true,
      photoOrder: true,
      event: { select: { id: true, title: true } },
      photos: {
        // Stills with a known size: the face boxes are read against it.
        where: {
          status: "CONFIRMED",
          videoObjectKey: null,
          width: { not: null },
          height: { not: null },
        },
        select: {
          ...ORDER_KEY_SELECT,
          id: true,
          objectKey: true,
          thumbObjectKey: true,
          fileName: true,
          width: true,
          height: true,
          faces: true,
          checkKeptAt: true,
        },
      },
    },
  });
  if (!gallery) notFound();

  const order = gallery.photoOrder;
  const photos: CheckPhoto[] = gallery.photos
    .toSorted((a, b) => compareTimeline(positionOf(order, a), positionOf(order, b)))
    .map((photo) => ({
      id: photo.id,
      objectKey: photo.objectKey,
      thumbObjectKey: photo.thumbObjectKey,
      fileName: photo.fileName,
      width: photo.width!,
      height: photo.height!,
      faces: currentFaces(photo.faces),
      kept: photo.checkKeptAt !== null,
    }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Kontrola fotek"
        crumbs={galleryCheckCrumbs(gallery)}
        subtitle="Zavřené a neostré oči, než galerii uvidí novomanželé."
      />
      {photos.length === 0 ? (
        <Alert>V galerii zatím nejsou žádné fotky.</Alert>
      ) : (
        <PhotoCheckBoard galleryId={gallery.id} photos={photos} />
      )}
    </div>
  );
}
