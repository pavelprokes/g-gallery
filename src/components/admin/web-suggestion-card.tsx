import Link from "next/link";
import { addSuggestionToPortfolio } from "@/app/admin/web-place-actions";
import { CoverThumb, type AdminCover } from "@/components/admin/cover-thumb";
import { SubmitButton } from "@/components/admin/submit-button";
import { Card } from "@/components/ui/card";
import { FORMS, pluralize } from "@/lib/czech-plural";
import { formatDate } from "@/lib/format-date";
import { slugify } from "@/lib/gallery-slug";

/** A couple with no web gallery yet, and photos to start one with. Unticking leaves one out. */
export function WebSuggestionCard({
  suggestion,
  from,
}: {
  /** Which page of suggestions this is on, to come back to it after a problem. */
  from: number;
  suggestion: {
    id: string;
    name: string;
    day: Date;
    ownPhotos: number;
    photos: (AdminCover & { id: string; fileName: string })[];
  };
}) {
  return (
    <Card as="form" action={addSuggestionToPortfolio.bind(null, suggestion.id)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-base font-bold">{suggestion.name}</h3>
        <p className="text-admin-muted text-caption">
          {formatDate(suggestion.day, "cs")} · {pluralize(suggestion.ownPhotos, FORMS.photo)} ·{" "}
          <Link href={`/admin/g/${suggestion.id}`} className="underline">
            Otevřít galerii
          </Link>
        </p>
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        {suggestion.photos.map((photo) => (
          <li key={photo.id} className="min-w-0">
            <label className="relative block cursor-pointer">
              <CoverThumb cover={photo} layout="tile" />
              <input
                type="checkbox"
                name="photo"
                value={photo.id}
                defaultChecked
                aria-label={`Vzít ${photo.fileName}`}
                className="accent-brand-primary absolute top-1.5 left-1.5 size-5 cursor-pointer"
              />
            </label>
          </li>
        ))}
      </ul>
      <input type="hidden" name="from" value={from} />
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="min-w-0 flex-1 basis-56 text-xs font-semibold">
          Adresa v portfoliu
          <input
            name="webSlug"
            required
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            // As the portfolio's own: eliska-a-martin-2026.
            defaultValue={`${slugify(suggestion.name)}-${suggestion.day.getFullYear()}`}
            className="border-admin-border mt-1 block h-10 w-full rounded border bg-white px-2 text-sm font-normal"
          />
        </label>
        <SubmitButton working="Kopíruji fotky…">Přidat na web</SubmitButton>
      </div>
      <p className="text-admin-muted text-caption mt-2">
        Vznikne koncept webové galerie s těmito fotkami, zveřejníš ho sám. Na webu se ukáže, až bude
        mít v portfoliu stránku se stejnou adresou.
      </p>
    </Card>
  );
}
