import {
  clearHighlightExclusions,
  setHighlightPin,
  setHighlightsEnabled,
} from "@/app/admin/highlight-actions";
import { AdminPhotoImage } from "@/components/admin/admin-photo-image";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Hint } from "@/components/ui/input";
import { FORMS, pluralize } from "@/lib/czech-plural";
import { MAX_PINNED, MIN_PHOTOS_FOR_AUTO } from "@/lib/gallery-highlights";

export interface AdminHighlight {
  id: string;
  objectKey: string;
  thumbObjectKey: string | null;
  fileName: string;
  /** Pinned by hand rather than filled in automatically. */
  pinned: boolean;
}

/**
 * The highlights as guests will see them (docs/HIGHLIGHTS.md): the same pick,
 * computed from the same function, with a way to pin, drop and switch off.
 * Pinning a photo that is not in the pick happens on its tile in the grid
 * below — this panel lists what is in.
 */
export function GalleryHighlightPanel({
  galleryId,
  enabled,
  highlights,
  excludedCount,
  pinnedCount,
  ownCount,
}: {
  galleryId: string;
  enabled: boolean;
  highlights: AdminHighlight[];
  excludedCount: number;
  pinnedCount: number;
  /** The photographer's own photos — the pool the automatic fill draws from. */
  ownCount: number;
}) {
  return (
    <Card as="section">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <CardTitle className="mb-0">Výběr na začátku galerie</CardTitle>
        <form action={setHighlightsEnabled.bind(null, galleryId, !enabled)}>
          <Button type="submit" variant={enabled ? "ghost" : "secondary"} size="sm">
            {enabled ? "Skrýt hostům" : "Ukázat hostům"}
          </Button>
        </form>
      </div>

      <p className="text-admin-muted mb-3 text-sm dark:text-neutral-400">
        {!enabled
          ? "Vypnuto — hosté výběr nevidí."
          : highlights.length > 0
            ? `Hosté vidí nahoře v galerii ${pluralize(highlights.length, FORMS.photoAccusative)}. Klepnutím na fotku se přenesou na její místo v galerii.`
            : ownCount < MIN_PHOTOS_FOR_AUTO
              ? `Galerie má méně než ${MIN_PHOTOS_FOR_AUTO} tvých fotek, takže se výběr nesestaví sám. Připni fotky ručně tlačítkem u fotky.`
              : "Výběr je prázdný — návrh nemá z čeho vybírat, protože jsou vyřazené všechny kandidátky. Vrať vyřazené, nebo připni fotky ručně."}
      </p>

      {pinnedCount > MAX_PINNED && (
        <p className="text-admin-danger mb-3 text-sm">
          Připnuto {pinnedCount} fotek — hosté uvidí jen prvních {MAX_PINNED} podle času pořízení.
          Pozdější připnuté se neukážou, dokud některé neodepneš.
        </p>
      )}

      {highlights.length > 0 && (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-10">
          {highlights.map((photo) => (
            <li key={photo.id} className="space-y-1">
              <div className="relative aspect-square overflow-hidden rounded bg-neutral-100 dark:bg-neutral-900">
                <AdminPhotoImage
                  objectKey={photo.objectKey}
                  thumbObjectKey={photo.thumbObjectKey}
                  alt={photo.fileName}
                />
                <span
                  className={`text-caption absolute top-1 left-1 rounded-full px-2 py-0.5 font-semibold ${
                    photo.pinned ? "bg-brand-primary text-white" : "bg-white/90 text-neutral-800"
                  }`}
                >
                  {photo.pinned ? "Připnutá" : "Návrh"}
                </span>
              </div>
              <form action={setHighlightPin.bind(null, photo.id, photo.pinned ? null : false)}>
                <Button type="submit" variant="ghost" size="sm" className="w-full">
                  {photo.pinned ? "Odepnout" : "Vyřadit"}
                </Button>
              </form>
            </li>
          ))}
        </ul>
      )}

      {excludedCount > 0 && (
        <form
          action={clearHighlightExclusions.bind(null, galleryId)}
          className="mt-3 flex flex-wrap items-center gap-2"
        >
          <span className="text-admin-muted text-sm dark:text-neutral-400">
            Vyřazeno z návrhu: {excludedCount}
          </span>
          <Button type="submit" variant="secondary" size="sm">
            Vrátit vyřazené
          </Button>
        </form>
      )}

      <Hint className="mt-3">
        Návrh rozloží výběr rovnoměrně přes celý den — podle kapitol, a bez nich podle pauz ve
        focení — a přednost dá fotkám, které jsi v Lightroomu odlišil od ostatních: 5★ mezi
        čtyřhvězdičkovými, jiný barevný štítek, než má většina, nebo klíčové slovo „highlight“ či
        „výběr“. Exportuj s metadaty (Zahrnout: Všechna metadata) — polohu z fotek galerie při
        nahrání odstraní sama. Fotky nahrané dřív tyhle značky nemají, u nich připínej ručně.
        Připnutá fotka je ve výběru vždy, vyřazená nikdy.
      </Hint>
    </Card>
  );
}
