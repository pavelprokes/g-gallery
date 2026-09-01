import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getAdminSession } from "@/lib/auth-guard";
import { PageHeader } from "@/components/ui/page-header";
import { PromoCardList, type PromoCardRow } from "@/components/admin/promo-card-list";

export const dynamic = "force-dynamic";

export default async function PromoCardsPage() {
  const session = await getAdminSession();
  if (!session) redirect("/sign-in");

  const cards = await prisma.promoCard.findMany({
    where: { ownerId: session.user.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      eyebrow: true,
      headline: true,
      body: true,
      ctaLabel: true,
      ctaUrl: true,
      theme: true,
      placements: {
        orderBy: { createdAt: "asc" },
        select: {
          slot: true,
          enabled: true,
          gallery: { select: { id: true, title: true } },
        },
      },
    },
  });

  const rows: PromoCardRow[] = cards.map((card) => ({
    ...card,
    placements: card.placements.map((placement) => ({
      galleryId: placement.gallery.id,
      galleryTitle: placement.gallery.title,
      slot: placement.slot,
      enabled: placement.enabled,
    })),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reklamní karty"
        crumbs={[{ href: "/admin", label: "Přehled" }, { label: "Reklamní karty" }]}
        subtitle="Dlaždice s odkazem na tebe, kterou lze umístit do mřížky kterékoli galerie."
      />
      <PromoCardList cards={rows} />
    </div>
  );
}
