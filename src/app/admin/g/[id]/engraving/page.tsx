import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getAdminSession } from "@/lib/auth-guard";
import { parseCouple, plateDate } from "@/lib/engraving/plate";
import { galleryEngravingCrumbs } from "@/lib/admin-breadcrumbs";
import { EngravingPlate } from "@/components/admin/engraving-plate";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

/**
 * The engraving plate from a gallery (docs/ENGRAVING.md). A gallery on a
 * wedding takes the wedding's title — "Alice a Martin" rather than "Alice a
 * Martin, Zámek Úsobí, 1. set" — though `parseCouple` drops the venue either way.
 */
export default async function GalleryEngravingPage(props: PageProps<"/admin/g/[id]/engraving">) {
  const session = await getAdminSession();
  if (!session) redirect("/sign-in?next=/admin");

  const { id } = await props.params;
  const gallery = await prisma.gallery.findFirst({
    where: { id, ownerId: session.user.id },
    select: {
      id: true,
      title: true,
      eventDate: true,
      event: { select: { id: true, title: true, eventDate: true } },
    },
  });
  if (!gallery) notFound();

  const date = gallery.eventDate ?? gallery.event?.eventDate ?? null;
  const isoDate = date?.toISOString().slice(0, 10) ?? null;
  return (
    <div className="space-y-6">
      <PageHeader title="Gravírování" crumbs={galleryEngravingCrumbs(gallery)} />
      <EngravingPlate
        initialCouple={parseCouple(gallery.event?.title ?? gallery.title)}
        initialDate={plateDate(isoDate)}
        isoDate={isoDate}
      />
    </div>
  );
}
