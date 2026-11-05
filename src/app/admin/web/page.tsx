import { redirect } from "next/navigation";
import { WebPlaceCard } from "@/components/admin/web-place-card";
import { PageHeader } from "@/components/ui/page-header";
import { getAdminSession } from "@/lib/auth-guard";
import { fetchWebPlaces, placeGalleriesFor, selectableGalleriesFor } from "@/lib/web-places";
import { assignWebPlace, clearWebPlace, createWebPlaceGallery } from "../web-place-actions";

/**
 * The places on the wedding website and what fills them (docs/WEB-GALLERIES.md). A published
 * gallery in a place is on the website within a minute, so this page says what will show.
 */
export default async function WebPlacesPage() {
  const session = await getAdminSession();
  if (!session) redirect("/sign-in?next=/admin/web");

  const places = await fetchWebPlaces();
  const [galleries, options] = places
    ? await Promise.all([
        placeGalleriesFor(session.user.id, places),
        selectableGalleriesFor(session.user.id),
      ])
    : [new Map(), []];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Místa na webu"
        subtitle="Publikovaná galerie v místě je na webu do minuty. Místo bez fotky ukazuje to, co dosud. Galerii plníš tlačítkem Kopírovat na web ve výběru fotek."
      />
      {!places && (
        <p role="alert" className="text-admin-muted text-sm">
          Seznam míst se z webu nepodařilo načíst, zkus to prosím znovu.
        </p>
      )}
      {places?.map((place) => (
        <WebPlaceCard
          key={place.key}
          place={place}
          gallery={galleries.get(place.key) ?? null}
          options={options}
          assign={assignWebPlace.bind(null, place.key)}
          clear={clearWebPlace.bind(null, place.key)}
          create={createWebPlaceGallery.bind(null, place.key, place.label)}
        />
      ))}
    </div>
  );
}
