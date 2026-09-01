"use client";

import { useState } from "react";
import { PromoCardForm, type PromoCardValues } from "@/components/admin/promo-card-form";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";

export interface PromoCardRow extends PromoCardValues {
  /** Titles of the galleries currently showing this card, with their slots —
   * so deleting or renaming one is never a guess about what it touches. */
  placements: { galleryId: string; galleryTitle: string; slot: number; enabled: boolean }[];
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
              <p className="text-admin-muted mt-0.5 text-sm dark:text-neutral-400">
                {card.headline} · {card.ctaUrl}
              </p>
              <p className="text-admin-muted mt-1 text-xs dark:text-neutral-400">
                {card.placements.length === 0
                  ? "Zatím není v žádné galerii."
                  : card.placements
                      .map(
                        (p) =>
                          `${p.galleryTitle} (${p.slot}. dlaždice${p.enabled ? "" : ", vypnuto"})`,
                      )
                      .join(" · ")}
              </p>
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
