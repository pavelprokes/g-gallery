import { setPhotoOrder } from "@/app/admin/photo-order-actions";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { FORMS, pluralize } from "@/lib/czech-plural";
import type { PhotoOrder } from "@/lib/photo-order";

const ORDERS: { value: PhotoOrder; label: string; hint: string }[] = [
  {
    value: "FILE_NAME",
    label: "Podle názvu souboru",
    hint: "Podle číslování z exportu (svatba_0001, svatba_0002…) — tedy přesně v pořadí z Lightroomu. Fotky od hostů bez takového číslování se zařadí podle svého názvu.",
  },
  {
    value: "TAKEN_AT",
    label: "Podle času pořízení",
    hint: "Podle času z fotoaparátu — vhodné pro galerii od hostů. Když má některé tělo nebo dron posunuté hodiny, jeho fotky se zařadí jinam.",
  },
];

/**
 * The order guests see the photos in (docs/PHOTO-ORDER.md), with how much the
 * two orders actually disagree on this gallery — the number that says whether
 * switching is worth it.
 */
export function GalleryPhotoOrderPanel({
  galleryId,
  order,
  displaced,
  takesGuestPhotos,
}: {
  galleryId: string;
  order: PhotoOrder;
  /** Photos the other order would move (`photosOutOfPlace`). */
  displaced: number;
  /** Guests can add photos here, or already have. */
  takesGuestPhotos: boolean;
}) {
  const current = ORDERS.find((o) => o.value === order)!;
  const other = ORDERS.find((o) => o.value !== order)!;
  return (
    <Card as="section">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <CardTitle className="mb-0">Pořadí fotek</CardTitle>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Pořadí fotek">
          {ORDERS.map((option) => (
            <form key={option.value} action={setPhotoOrder.bind(null, galleryId, option.value)}>
              <Button
                type="submit"
                size="sm"
                variant={option.value === order ? "secondary" : "ghost"}
                aria-pressed={option.value === order}
                disabled={option.value === order}
              >
                {option.label}
              </Button>
            </form>
          ))}
        </div>
      </div>
      <p className="text-admin-muted text-sm dark:text-neutral-400">{current.hint}</p>
      {order === "FILE_NAME" && takesGuestPhotos && (
        <p className="text-admin-danger mt-2 text-sm">
          Do galerie nahrávají hosté. Fotky z telefonů mají názvy podle počítadla telefonu
          (IMG_4821…), ne podle průběhu dne — pro ně je lepší řazení podle času pořízení.
        </p>
      )}
      <p className="text-admin-muted mt-2 text-sm dark:text-neutral-400">
        {displaced === 0
          ? "U této galerie vychází obě řazení stejně."
          : `Řazení ${other.label.toLocaleLowerCase("cs")} by přesunulo ${pluralize(displaced, FORMS.photoAccusative)}.`}
      </p>
    </Card>
  );
}
