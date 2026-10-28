import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getAdminSession } from "@/lib/auth-guard";
import { parseCouple, plateDate } from "@/lib/engraving/plate";
import { eventEngravingCrumbs } from "@/lib/admin-breadcrumbs";
import { EngravingPlate } from "@/components/admin/engraving-plate";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

/** The engraving plate for a wedding (docs/ENGRAVING.md), prefilled from its title and date. */
export default async function EventEngravingPage(props: PageProps<"/admin/e/[id]/engraving">) {
  const session = await getAdminSession();
  if (!session) redirect("/sign-in?next=/admin");

  const { id } = await props.params;
  const event = await prisma.event.findFirst({
    where: { id, ownerId: session.user.id },
    select: { id: true, title: true, eventDate: true },
  });
  if (!event) notFound();

  const isoDate = event.eventDate?.toISOString().slice(0, 10) ?? null;
  return (
    <div className="space-y-6">
      <PageHeader title="Gravírování" crumbs={eventEngravingCrumbs(event)} />
      <EngravingPlate
        initialCouple={parseCouple(event.title)}
        initialDate={plateDate(isoDate)}
        isoDate={isoDate}
      />
    </div>
  );
}
