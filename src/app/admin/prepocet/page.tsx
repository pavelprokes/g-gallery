import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { rescanCrumbs } from "@/lib/admin-breadcrumbs";
import { needsFocus } from "@/lib/social-video/aim";
import { currentFaces, FACES_MODEL } from "@/lib/social-video/faces";
import { FOCUS_VERSION } from "@/lib/social-video/focus";
import { BulkFaceScan, type RescanGallery } from "@/components/admin/bulk-face-scan";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

/**
 * The face scan for every gallery at once (docs/SOCIAL-VIDEO.md §4, "The whole
 * gallery"): the photos each gallery page would scan on its own when opened —
 * faces never searched, from an older build, or the sharp part not yet looked
 * for — listed here so one open tab does them all. Its own page rather than a
 * card on the overview, which would otherwise read photos' faces on every visit.
 */
export default async function RescanPage() {
  const session = await getAdminSession();
  if (!session) redirect("/sign-in?next=/admin/prepocet");

  // The database narrows to the candidates — no faces, another build, no
  // focus key yet, or a focus aimed by an older version — so a library that is
  // up to date reads almost nothing; the exact rule (`needsFocus`) runs on
  // those few below.
  const candidates = await prisma.$queryRaw<{ id: string }[]>`
    SELECT p.id FROM "g_gallery"."Photo" p
    JOIN "g_gallery"."Gallery" g ON g.id = p."galleryId"
    WHERE g."ownerId" = ${session.user.id}
      AND g."trashedAt" IS NULL
      AND p.status = 'CONFIRMED'
      AND p."videoObjectKey" IS NULL
      AND p.width IS NOT NULL
      AND p.height IS NOT NULL
      AND (p.faces IS NULL
        OR p.faces->>'model' IS DISTINCT FROM ${FACES_MODEL}
        OR p.faces->'focus' IS NULL
        OR (jsonb_typeof(p.faces->'focus') = 'object'
          AND p.faces->>'focusVersion' IS DISTINCT FROM ${String(FOCUS_VERSION)}))`;

  const photos = await prisma.photo.findMany({
    where: { id: { in: candidates.map((row) => row.id) } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      objectKey: true,
      width: true,
      height: true,
      faces: true,
      gallery: { select: { id: true, title: true, createdAt: true } },
    },
  });

  const byGallery = new Map<string, RescanGallery & { createdAt: Date }>();
  for (const photo of photos) {
    const faces = currentFaces(photo.faces);
    if (faces !== null && !needsFocus(faces)) continue;
    const gallery = byGallery.get(photo.gallery.id) ?? {
      id: photo.gallery.id,
      title: photo.gallery.title,
      createdAt: photo.gallery.createdAt,
      photos: [],
    };
    gallery.photos.push({
      id: photo.id,
      objectKey: photo.objectKey,
      width: photo.width!,
      height: photo.height!,
    });
    byGallery.set(gallery.id, gallery);
  }
  // Newest gallery first, as the overview lists them.
  const pending = [...byGallery.values()]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map(({ id, title, photos }) => ({ id, title, photos }));

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
