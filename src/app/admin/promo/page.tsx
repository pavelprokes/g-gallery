import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { promoClickCounts } from "@/lib/activity";
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

  // Clicks are counted per gallery, not per placement — `ActivityEvent` has no
  // column for a `GalleryPromo` (see `promoClickCounts`). A gallery holding two
  // of the owner's cards therefore shares one number between them, which the
  // list says out loud rather than splitting it arbitrarily.
  const cardsPerGallery = new Map<string, number>();
  for (const card of cards) {
    for (const placement of card.placements) {
      const id = placement.gallery.id;
      cardsPerGallery.set(id, (cardsPerGallery.get(id) ?? 0) + 1);
    }
  }
  const clicks = await promoClickCounts([...cardsPerGallery.keys()]);

  const rows: PromoCardRow[] = cards.map((card) => ({
    ...card,
    placements: card.placements.map((placement) => ({
      galleryId: placement.gallery.id,
      galleryTitle: placement.gallery.title,
      slot: placement.slot,
      enabled: placement.enabled,
      clicks: clicks.get(placement.gallery.id) ?? 0,
      sharedWithOtherCards: (cardsPerGallery.get(placement.gallery.id) ?? 1) > 1,
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
