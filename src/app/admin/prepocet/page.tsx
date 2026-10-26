import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { rescanCrumbs } from "@/lib/admin-breadcrumbs";
import { needsFocus } from "@/lib/social-video/aim";
import { currentFaces } from "@/lib/social-video/faces";
import { BulkFaceScan, type RescanGallery } from "@/components/admin/bulk-face-scan";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

/**
 * The face scan for every gallery at once (docs/SOCIAL-VIDEO.md §4, "The whole
 * gallery"): the photos each gallery page would scan on its own when opened —
 * faces never searched, from an older build, or the sharp part not yet looked
 * for — listed here so one open tab does them all. Its own page rather than a
 * card on the overview, which would otherwise read every photo's faces on
 * every visit.
 */
export default async function RescanPage() {
  const session = await getAdminSession();
  if (!session) redirect("/sign-in?next=/admin/prepocet");

  const galleries = await prisma.gallery.findMany({
    where: { ownerId: session.user.id, trashedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      photos: {
        where: {
          status: "CONFIRMED",
          videoObjectKey: null,
          width: { not: null },
          height: { not: null },
        },
        select: { id: true, objectKey: true, width: true, height: true, faces: true },
      },
    },
  });

  const pending: RescanGallery[] = galleries
    .map((gallery) => ({
      id: gallery.id,
      title: gallery.title,
      photos: gallery.photos
        .filter((photo) => {
          const faces = currentFaces(photo.faces);
          return faces === null || needsFocus(faces);
        })
        .map(({ id, objectKey, width, height }) => ({
          id,
          objectKey,
          width: width!,
          height: height!,
        })),
    }))
    .filter((gallery) => gallery.photos.length > 0);

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Přepočet fotek"
        crumbs={rescanCrumbs()}
        subtitle="Obličeje a ostrá místa pro video, promítání, kontrolu fotek a filtr Detaily — u všech galerií najednou."
      />
      <BulkFaceScan galleries={pending} />
    </div>
  );
}
