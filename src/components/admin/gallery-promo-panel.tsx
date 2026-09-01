"use client";

import Link from "next/link";
import { useId, useState } from "react";
import {
  placePromoInGallery,
  removePromoFromGallery,
  setPromoPlacementEnabled,
} from "@/app/admin/promo-actions";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Hint, Input, Label, Select } from "@/components/ui/input";
import { MAX_PROMO_SLOT, MIN_PROMO_SLOT } from "@/lib/promo-card";

export interface PlacedPromo {
  placementId: string;
  promoCardId: string;
  name: string;
  headline: string;
  slot: number;
  enabled: boolean;
}

/**
 * Placing the owner's credit card into this gallery's grid.
 *
 * The slot is 1-based and means exactly what it says on the label — "be the
 * 5th tile" — because that is the sentence the owner is thinking in. The
 * 0-based insert index it becomes is computed in one place
 * (`promoInsertIndex`), not here.
 */
export function GalleryPromoPanel({
  galleryId,
  photoCount,
  placed,
  available,
}: {
  galleryId: string;
  photoCount: number;
  placed: PlacedPromo[];
  available: { id: string; name: string }[];
}) {
  const fieldId = useId();
  const [adding, setAdding] = useState(false);

  const unplaced = available.filter(
    (card) => !placed.some((placement) => placement.promoCardId === card.id),
  );

  return (
    <Card as="section">
      <CardTitle className="mb-3">Reklamní karta v mřížce</CardTitle>

      {placed.length === 0 && !adding && (
        <p className="text-admin-muted mb-3 text-sm dark:text-neutral-400">
          V mřížce téhle galerie zatím žádná karta není.
        </p>
      )}

      <ul className="space-y-2">
        {placed.map((placement) => (
          <li
            key={placement.placementId}
            className="border-admin-border flex flex-wrap items-center gap-3 rounded-lg border p-3 dark:border-neutral-800"
          >
            <div className="min-w-0 flex-1">
              <p className="text-brand-ink truncate font-semibold dark:text-neutral-100">
                {placement.name}
              </p>
              <p className="text-admin-muted truncate text-sm dark:text-neutral-400">
                {placement.headline}
              </p>
            </div>

            <form
              action={placePromoInGallery.bind(null, galleryId)}
              className="flex items-end gap-2"
            >
              <input type="hidden" name="promoCardId" value={placement.promoCardId} />
              <div>
                <Label htmlFor={`${fieldId}-${placement.placementId}`} className="mb-1">
                  Pořadí
                </Label>
                <Input
                  id={`${fieldId}-${placement.placementId}`}
                  name="slot"
                  type="number"
                  inputMode="numeric"
                  min={MIN_PROMO_SLOT}
                  max={MAX_PROMO_SLOT}
                  defaultValue={placement.slot}
                  className="w-20"
                />
              </div>
              <Button type="submit" variant="secondary" size="lg">
                Uložit
              </Button>
            </form>

            <div className="flex gap-2">
              <form
                action={setPromoPlacementEnabled.bind(
                  null,
                  placement.placementId,
                  !placement.enabled,
                )}
              >
                <Button type="submit" variant="ghost" size="lg">
                  {placement.enabled ? "Skrýt" : "Zobrazit"}
                </Button>
              </form>
              <form action={removePromoFromGallery.bind(null, placement.placementId)}>
                <Button type="submit" variant="destructive" size="lg">
                  Odebrat
                </Button>
              </form>
            </div>

            {!placement.enabled && (
              <p className="text-admin-warning w-full text-xs">
                Skrytá — v galerii se teď nezobrazuje.
              </p>
            )}
          </li>
        ))}
      </ul>

      {adding && unplaced.length > 0 && (
        <form
          action={async (formData: FormData) => {
            await placePromoInGallery(galleryId, formData);
            setAdding(false);
          }}
          className="border-admin-border mt-3 flex flex-wrap items-end gap-3 rounded-lg border p-3 dark:border-neutral-800"
        >
          <div className="min-w-48 flex-1">
            <Label htmlFor={`${fieldId}-card`}>Karta</Label>
            <Select id={`${fieldId}-card`} name="promoCardId" required>
              {unplaced.map((card) => (
                <option key={card.id} value={card.id}>
                  {card.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor={`${fieldId}-slot`}>Pořadí</Label>
            <Input
              id={`${fieldId}-slot`}
              name="slot"
              type="number"
              inputMode="numeric"
              min={MIN_PROMO_SLOT}
              max={MAX_PROMO_SLOT}
              defaultValue={5}
              className="w-20"
            />
          </div>
          <Button type="submit">Umístit</Button>
          <Button type="button" variant="secondary" onClick={() => setAdding(false)}>
            Zrušit
          </Button>
          <Hint className="w-full">
            Pořadí je místo v mřížce: při pětce se karta stane pátou dlaždicí a z páté fotky šestá.
            {photoCount > 0 && ` V téhle galerii je ${photoCount} fotek.`} Když je fotek míň, karta
            se zařadí na konec.
          </Hint>
        </form>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!adding && unplaced.length > 0 && (
          <Button type="button" variant="secondary" onClick={() => setAdding(true)}>
            {placed.length === 0 ? "Umístit kartu" : "Přidat další"}
          </Button>
        )}
        <Link
          href="/admin/promo"
          className="text-brand-primary-dark text-sm font-semibold underline underline-offset-4"
        >
          {available.length === 0 ? "Vytvořit kartu" : "Spravovat karty"}
        </Link>
      </div>

      <Hint className="mt-2">
        Karta se chová jako fotka na šířku, ale při prohlížení fotek se přeskakuje — v prohlížeči
        fotek ani v šipkách se neobjeví a nedá se stáhnout.
      </Hint>
    </Card>
  );
}
