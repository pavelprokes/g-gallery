import { redirect } from "next/navigation";
import { WebPlaceCard } from "@/components/admin/web-place-card";
import { WebPortfolioList } from "@/components/admin/web-portfolio-list";
import { WebSuggestionCard } from "@/components/admin/web-suggestion-card";
import { Alert } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button";
import { CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { getAdminSession } from "@/lib/auth-guard";
import {
  fetchWebPlaces,
  fetchWebStats,
  placeGalleriesFor,
  portfolioGalleriesFor,
  selectableGalleriesFor,
  SUGGESTIONS_PER_PAGE,
  webSuggestionsFor,
  websiteBase,
} from "@/lib/web-places";
import { assignWebPlace, clearWebPlace, createWebPlaceGallery } from "../web-place-actions";

/**
 * The places on the wedding website and what fills them (docs/WEB-GALLERIES.md). A published
 * gallery in a place is on the website within a minute, so this page says what will show.
 */
export default async function WebPlacesPage(props: PageProps<"/admin/web">) {
  const session = await getAdminSession();
  if (!session) redirect("/sign-in?next=/admin/web");

  const search = await props.searchParams;
  const askedFrom = Math.max(Number(search.doporuceni) || 0, 0);
  const base = websiteBase();
  const [places, { suggestions, total, from }, portfolio, stats] = await Promise.all([
    fetchWebPlaces(),
    webSuggestionsFor(session.user.id, askedFrom),
    portfolioGalleriesFor(session.user.id),
    fetchWebStats(),
  ]);
  const [galleries, options] = places
    ? await Promise.all([
        placeGalleriesFor(session.user.id, places),
        selectableGalleriesFor(session.user.id),
      ])
    : [new Map(), []];
  const next = from + SUGGESTIONS_PER_PAGE;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Web"
        subtitle="Publikovaná galerie je na webu do minuty. Místo bez fotky ukazuje to, co dosud. Galerii plníš tlačítkem Kopírovat na web ve výběru fotek."
      />
      {search.chyba === "adresa" && (
        <Alert tone="danger">Tahle adresa v portfoliu už je obsazená, vyber prosím jinou.</Alert>
      )}
      {search.chyba === "kopie" && (
        <Alert tone="danger">Fotky se nepodařilo zkopírovat, nic nevzniklo. Zkus to znovu.</Alert>
      )}
      {search.chyba === "cast" && (
        <Alert tone="danger">
          Některé fotky se nepodařilo zkopírovat. Koncept je v Portfoliu, zbylé fotky doplníš
          tlačítkem Kopírovat na web ve výběru fotek.
        </Alert>
      )}
      {search.chyba === "vstup" && (
        <Alert tone="danger">
          Vyber aspoň jednu fotku a adresu jen z malých písmen bez diakritiky, číslic a pomlček.
        </Alert>
      )}
      {suggestions.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <CardTitle className="mb-0">Přidat do portfolia ({total})</CardTitle>
            {total > SUGGESTIONS_PER_PAGE && (
              <a
                href={next < total ? `/admin/web?doporuceni=${next}` : "/admin/web"}
                className={buttonClasses("ghost", "sm")}
              >
                {next < total ? "Další návrhy" : "Zpět na první"}
              </a>
            )}
          </div>
          {suggestions.map((suggestion) => (
            <WebSuggestionCard key={suggestion.id} suggestion={suggestion} from={from} />
          ))}
        </section>
      )}
      <WebPortfolioList galleries={portfolio} websiteBase={base} stats={stats} />
      <CardTitle className="mt-2 mb-0">Místa na webu</CardTitle>
      {!places && (
        <p role="alert" className="text-admin-muted text-sm">
          Seznam míst se z webu nepodařilo načíst, zkus to prosím znovu.
        </p>
      )}
      {places?.map((place) => (
        <WebPlaceCard
          key={place.key}
          place={place}
          websiteBase={base}
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
