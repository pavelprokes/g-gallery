"use client";

import { FORMS, pluralize } from "@/lib/czech-plural";
import type { StudioPhoto } from "@/components/admin/social-video-studio";
import { AdminPhotoImage } from "@/components/admin/admin-photo-image";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";

// Which photos the reels take (docs/REELS.md §4): the suggestion's pick from
// every chosen gallery, mixed or album by album — or the photos the
// photographer clicks in each gallery, and only those.

export interface PickGallery {
  id: string;
  title: string;
  photos: StudioPhoto[];
}

export function ReelPhotoPick({
  galleries,
  manual,
  onManual,
  picked,
  onPicked,
  mixGalleries,
  onMixGalleries,
  wanted,
}: {
  galleries: readonly PickGallery[];
  /** The photographer picks the photos; otherwise the suggestion does. */
  manual: boolean;
  onManual(manual: boolean): void;
  picked: ReadonlySet<string>;
  onPicked(next: Set<string>): void;
  mixGalleries: boolean;
  onMixGalleries(mix: boolean): void;
  /** About how many photos a reel of the chosen length cuts to. */
  wanted: number;
}) {
  const toggle = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onPicked(next);
  };
  const setAll = (ids: readonly string[], on: boolean) => {
    const next = new Set(picked);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    onPicked(next);
  };

  return (
    <Card as="section" aria-label="Fotky do videa">
      <CardTitle>Fotky</CardTitle>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Kdo vybírá fotky">
        {(
          [
            [false, "Vybrat samo"],
            [true, "Naklikat ručně"],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={label}
            role="radio"
            aria-checked={manual === value}
            variant={manual === value ? "primary" : "secondary"}
            onClick={() => onManual(value)}
          >
            {label}
          </Button>
        ))}
      </div>
      {galleries.length > 1 && (
        <label className="mt-3 flex min-h-11 cursor-pointer items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={mixGalleries}
            onChange={(e) => onMixGalleries(e.target.checked)}
            className="accent-brand-primary mt-0.5 size-5 shrink-0"
          />
          <span>
            Promíchat alba
            <span className="text-admin-muted text-caption block dark:text-neutral-400">
              Fotky ze všech vybraných alb se ve videu střídají. Bez toho jdou album po albu.
            </span>
          </span>
        </label>
      )}
      {manual && (
        <div className="mt-3 space-y-3">
          <p className="text-sm" role="status">
            {picked.size === 0
              ? "Klikni na fotky, které chceš ve videu. Dokud žádnou nevybereš, vybírá se samo."
              : `Vybráno ${pluralize(picked.size, FORMS.photo)} — varianty berou jen tyhle.`}
            {picked.size > 0 &&
              picked.size < wanted &&
              ` Na střihy do rytmu by se hodilo kolem ${wanted}; s méně fotkami vydrží každá déle.`}
          </p>
          {galleries.map((gallery, index) => {
            const own = gallery.photos.filter((p) => p.candidate.own);
            const chosen = own.filter((p) => picked.has(p.id)).length;
            return (
              <details key={gallery.id} open={index === 0} className="group">
                <summary className="cursor-pointer text-sm font-semibold">
                  {gallery.title}{" "}
                  <span className="text-admin-muted font-normal dark:text-neutral-400">
                    · vybráno {chosen} z {own.length}
                  </span>
                </summary>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      setAll(
                        own.map((p) => p.id),
                        true,
                      )
                    }
                  >
                    Vybrat vše
                  </Button>
                  {chosen > 0 && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        setAll(
                          own.map((p) => p.id),
                          false,
                        )
                      }
                    >
                      Zrušit výběr
                    </Button>
                  )}
                </div>
                <ul className="mt-2 grid max-h-[28rem] grid-cols-4 gap-1 overflow-y-auto sm:grid-cols-6 lg:grid-cols-10">
                  {own.map((photo) => {
                    const on = picked.has(photo.id);
                    return (
                      <li key={photo.id}>
                        <button
                          type="button"
                          onClick={() => toggle(photo.id)}
                          aria-pressed={on}
                          aria-label={`${on ? "Odebrat" : "Přidat"} fotku ${photo.fileName}`}
                          className={`bg-brand-tint relative block aspect-square w-full overflow-hidden rounded ${on ? "ring-brand-primary ring-3 ring-inset" : "opacity-80 hover:opacity-100"}`}
                        >
                          <AdminPhotoImage
                            objectKey={photo.objectKey}
                            thumbObjectKey={photo.thumbObjectKey}
                            alt=""
                            sizes="96px"
                          />
                          {on && (
                            <span
                              aria-hidden
                              className="bg-brand-primary absolute top-1 right-1 grid size-6 place-items-center rounded-full text-white"
                            >
                              <svg
                                viewBox="0 0 24 24"
                                className="size-4 fill-none stroke-current stroke-3"
                              >
                                <path d="M5 12.5l4.5 4.5L19 7.5" />
                              </svg>
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </details>
            );
          })}
        </div>
      )}
    </Card>
  );
}
