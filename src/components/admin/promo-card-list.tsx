"use client";

import { useState } from "react";
import { PromoCardForm, type PromoCardValues } from "@/components/admin/promo-card-form";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";

export interface PromoCardRow extends PromoCardValues {
  /** Titles of the galleries currently showing this card, with their slots —
   * so deleting or renaming one is never a guess about what it touches. */
  placements: {
    galleryId: string;
    galleryTitle: string;
    slot: number;
    enabled: boolean;
    /** Promo clicks recorded in that gallery. Gallery-level, not
     * placement-level — see `promoClickCounts` in `src/lib/activity.ts`. */
    clicks: number;
    /** True when another card also sits in that gallery, which makes `clicks`
     * a number the two of them share rather than this card's own. */
    sharedWithOtherCards: boolean;
  }[];
}

/**
 * Clicks across every gallery this card sits in.
 *
 * Adding the placements up is safe because a card can be placed at most once
 * per gallery (`@@unique([galleryId, promoCardId])`), so no gallery's count is
 * added twice. It is still an upper bound wherever a gallery holds a second
 * card: that gallery's clicks belong to both, which is why each line says so.
 */
export function totalClicks(card: Pick<PromoCardRow, "placements">): number {
  return card.placements.reduce((sum, placement) => sum + placement.clicks, 0);
}

/**
 * The card library. One card is written once and placed into any number of
 * galleries (`GalleryPromo`), so this list is about the *content*; the slot it
 * sits in belongs to the gallery's own page.
 */
export function PromoCardList({ cards }: { cards: PromoCardRow[] }) {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      {!creating && (
        <Button type="button" onClick={() => setCreating(true)}>
          Nová karta
        </Button>
      )}
      {creating && <PromoCardForm onDone={() => setCreating(false)} />}

      {cards.length === 0 && !creating && (
        <Card>
          <CardTitle className="mb-2">Zatím žádná karta</CardTitle>
          <p className="text-admin-muted text-sm dark:text-neutral-400">
            Karta je dlaždice v mřížce galerie, která vypadá jako fotka na šířku, ale je v ní text o
            tobě a odkaz na tvůj web. Hosté ji uvidí při procházení mřížky; do prohlížení fotek se
            nedostane.
          </p>
        </Card>
      )}

      {cards.map((card) =>
        editingId === card.id ? (
          <PromoCardForm key={card.id} card={card} onDone={() => setEditingId(null)} />
        ) : (
          <Card key={card.id} className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-brand-ink font-semibold dark:text-neutral-100">{card.name}</p>
              <p className="text-admin-muted text-body mt-0.5 dark:text-neutral-400">
                {card.headline} · {card.ctaUrl}
              </p>
              {card.placements.length === 0 ? (
                <p className="text-admin-muted text-caption mt-1 dark:text-neutral-400">
                  Zatím není v žádné galerii.
                </p>
              ) : (
                <div className="mt-1 space-y-0.5">
                  {/* A placed card with no clicks is the finding, not a missing
                      row — it says the tile is being scrolled past. Hence a real
                      zero on every placement. */}
                  {card.placements.length > 1 && (
                    <p className="text-brand-ink text-caption font-semibold dark:text-neutral-100">
                      Celkem {totalClicks(card)} kliknutí
                    </p>
                  )}
                  {card.placements.map((p) => (
                    <p
                      key={p.galleryId}
                      className="text-admin-muted text-caption dark:text-neutral-400"
                    >
                      {p.galleryTitle} ({p.slot}. dlaždice{p.enabled ? "" : ", vypnuto"}) ·{" "}
                      <span className="text-brand-ink font-medium dark:text-neutral-100">
                        {p.clicks} kliknutí
                      </span>
                      {p.sharedWithOtherCards &&
                        " — číslo je za celou galerii, jsou v ní i jiné karty"}
                    </p>
                  ))}
                </div>
              )}
            </div>
            <Button type="button" variant="secondary" onClick={() => setEditingId(card.id)}>
              Upravit
            </Button>
          </Card>
        ),
      )}
    </div>
  );
}
