import Link from "next/link";
import { CoverThumb } from "@/components/admin/cover-thumb";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FORMS, pluralize } from "@/lib/czech-plural";
import {
  describePlace,
  type PlaceGallery,
  type PlaceState,
  type WebPlace,
} from "@/lib/web-place-view";

const STATE: Record<PlaceState, { tone: "muted" | "warning" | "success"; label: string }> = {
  empty: { tone: "muted", label: "Prázdné, web ukazuje původní fotky" },
  draft: { tone: "warning", label: "Koncept, web ukazuje původní fotky" },
  no_photos: { tone: "warning", label: "Bez fotek, web ukazuje původní fotky" },
  live: { tone: "success", label: "Na webu" },
};

/** One place on the website: what fills it, photo by photo, and how to change that. */
export function WebPlaceCard({
  place,
  websiteBase,
  gallery,
  options,
  assign,
  clear,
  create,
}: {
  place: WebPlace;
  websiteBase: string;
  gallery: PlaceGallery | null;
  options: { id: string; title: string }[];
  assign: (formData: FormData) => void | Promise<void>;
  clear: () => void | Promise<void>;
  create: () => void | Promise<void>;
}) {
  const view = describePlace(place, gallery);
  const state = STATE[view.state];
  const rejected = view.tiles.filter((tile) => tile.rejected).length;
  const page = new URL(place.where, websiteBase).href;

  return (
    <Card as="section" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="text-base font-bold">
          <a href={page} target="_blank" rel="noopener noreferrer" className="hover:underline">
            {place.label}
          </a>
        </h2>
        <Badge tone={state.tone}>{state.label}</Badge>
      </div>
      <p className="text-admin-muted text-caption">
        {place.where} · {pluralize(place.positions.length, FORMS.photo)}
        {place.landscape ? " · jen na šířku" : ""}
        {place.coverFirst ? ` · ${place.positions[0]} je titulní fotka galerie` : ""}
      </p>

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {view.tiles.map((tile) => (
          <li key={tile.position} className="min-w-0">
            <CoverThumb cover={tile.photo} layout="tile" />
            <p className="text-admin-muted mt-1 text-xs [overflow-wrap:anywhere]">
              {tile.position}
            </p>
            {tile.rejected && <Badge tone="warning">Na výšku</Badge>}
          </li>
        ))}
      </ul>

      {gallery && (rejected > 0 || view.missing > 0 || view.unused > 0) && (
        <ul className="text-admin-muted text-caption list-disc pl-5">
          {rejected > 0 && (
            <li>
              Na výšku: {pluralize(rejected, FORMS.photo)}. Tady fungují jen fotky na šířku, web
              nechá původní.
            </li>
          )}
          {view.missing > rejected && (
            <li>
              Chybí {pluralize(view.missing - rejected, FORMS.photo)}. Tam web nechá původní fotku.
            </li>
          )}
          {view.unused > 0 && (
            <li>Navíc v galerii: {pluralize(view.unused, FORMS.photo)}. Web je nepoužije.</li>
          )}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {gallery ? (
          <>
            <p className="text-sm font-semibold">{gallery.title}</p>
            <form action={clear}>
              <Button type="submit" variant="ghost">
                Odebrat z místa
              </Button>
            </form>
          </>
        ) : (
          <form action={create}>
            <Button type="submit" variant="secondary">
              Založit galerii
            </Button>
          </form>
        )}
        {options.length > 0 && (
          <form action={assign} className="flex flex-wrap items-center gap-2">
            <select
              name="galleryId"
              required
              defaultValue=""
              aria-label={`Galerie pro místo ${place.label}`}
              className="border-admin-border h-10 max-w-64 rounded border bg-white px-2 text-sm"
            >
              <option value="" disabled>
                {gallery ? "Vyměnit za…" : "Dosadit galerii…"}
              </option>
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.title}
                </option>
              ))}
            </select>
            <Button type="submit" variant="secondary">
              Dosadit
            </Button>
          </form>
        )}
        {/* The row's main button, on the right: what this place is filled from. */}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <a
            href={page}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClasses("secondary", "md")}
          >
            Na webu ↗
          </a>
          {gallery && (
            <Link href={`/admin/g/${gallery.id}`} className={buttonClasses("primary", "md")}>
              Otevřít galerii
            </Link>
          )}
        </div>
      </div>
    </Card>
  );
}
