import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getAdminSession } from "@/lib/auth-guard";
import { compareTimeline } from "@/lib/gallery-chapters";
import { ORDER_KEY_SELECT, positionOf } from "@/lib/photo-order";
import { storedFaces } from "@/lib/social-video/faces";
import { galleryPeopleCrumbs } from "@/lib/admin-breadcrumbs";
import { FaceTagBoard, type TagPhoto } from "@/components/admin/face-tag-board";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

/**
 * Who is who on the gallery's faces (docs/SOCIAL-VIDEO.md §4, "Who is who"):
 * the photographer names the couple — and anyone else — by hand. Faces are
 * found in the photographer's browser, as on the video page.
 */
export default async function FaceTagPage(props: PageProps<"/admin/g/[id]/people">) {
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
      people: {
        orderBy: [{ couple: "desc" }, { createdAt: "asc" }],
        select: { id: true, name: true, couple: true },
      },
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
          fileName: true,
          width: true,
          height: true,
          faces: true,
          faceTags: { select: { personId: true, x: true, y: true, w: true, h: true } },
        },
      },
    },
  });
  if (!gallery) notFound();

  const order = gallery.photoOrder;
  const photos: TagPhoto[] = gallery.photos
    .toSorted((a, b) => compareTimeline(positionOf(order, a), positionOf(order, b)))
    .map((photo) => ({
      id: photo.id,
      objectKey: photo.objectKey,
      fileName: photo.fileName,
      width: photo.width!,
      height: photo.height!,
      takenAt: photo.takenAt?.getTime() ?? null,
      // Any build's boxes will do for a name: a tag is matched to the faces
      // by overlap, so it survives the next detection.
      faces: storedFaces(photo.faces),
      tags: photo.faceTags,
    }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Kdo je kdo"
        crumbs={galleryPeopleCrumbs(gallery)}
        subtitle="Pojmenuj tváře novomanželů — video i projekce pak míří na ně."
      />
      {photos.length === 0 ? (
        <Alert>V galerii zatím nejsou žádné fotky.</Alert>
      ) : (
        <FaceTagBoard galleryId={gallery.id} photos={photos} initialPeople={gallery.people} />
      )}
    </div>
  );
}
