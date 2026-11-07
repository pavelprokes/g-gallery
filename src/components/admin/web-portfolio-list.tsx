import Link from "next/link";
import { CoverThumb, type AdminCover } from "@/components/admin/cover-thumb";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { FORMS, pluralize } from "@/lib/czech-plural";
import type { WebStats } from "@/lib/web-places";

interface PortfolioGallery {
  id: string;
  title: string;
  status: string;
  webSlug: string | null;
  coverPhoto: AdminCover | null;
  photos: AdminCover[];
  _count: { photos: number };
}

/** The web galleries that are portfolio pages: to the page on the website, or to work on them. */
export function WebPortfolioList({
  galleries,
  websiteBase,
  stats,
}: {
  galleries: PortfolioGallery[];
  websiteBase: string;
  /** The website's visit numbers; null without them. */
  stats: WebStats | null;
}) {
  if (galleries.length === 0) return null;
  const statsOf = new Map(stats?.galleries.map((gallery) => [gallery.uid, gallery]));
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <CardTitle className="mb-0">Portfolio</CardTitle>
        {stats && (
          <p className="text-admin-muted text-caption">
            Přehled portfolia na webu: {stats.indexViews} zobrazení za 90 dní
          </p>
        )}
      </div>
      <Card as="ul" flush className="divide-admin-border divide-y">
        {galleries.map((gallery) => {
          // A draft may have no page on the website yet.
          const page =
            gallery.status === "PUBLISHED" ? `${websiteBase}/portfolio/${gallery.webSlug}` : null;
          return (
            <li key={gallery.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3">
              <CoverThumb cover={gallery.coverPhoto ?? gallery.photos[0] ?? null} />
              <div className="min-w-0 flex-1 basis-48">
                {page ? (
                  <a
                    href={page}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium hover:underline"
                  >
                    {gallery.title}
                  </a>
                ) : (
                  <p className="font-medium">{gallery.title}</p>
                )}
                <p className="text-admin-muted mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  {gallery.status !== "PUBLISHED" && <Badge tone="warning">Koncept</Badge>}
                  <span>
                    {gallery.webSlug} · {pluralize(gallery._count.photos, FORMS.photo)}
                  </span>
                </p>
                {stats && page && <WebsiteVisits visits={statsOf.get(gallery.webSlug ?? "")} />}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {page && (
                  <a
                    href={page}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={buttonClasses("secondary", "md")}
                  >
                    Na webu ↗
                  </a>
                )}
                <Link href={`/admin/g/${gallery.id}`} className={buttonClasses("primary", "md")}>
                  Otevřít galerii
                </Link>
              </div>
            </li>
          );
        })}
      </Card>
    </section>
  );
}

function WebsiteVisits({ visits }: { visits: WebStats["galleries"][number] | undefined }) {
  // The website lists only pages with visits, so this may also be an address that differs from it.
  if (!visits) {
    return (
      <p className="text-admin-muted mt-1 text-xs">
        Za 90 dní bez návštěv, nebo se adresa liší od stránky v portfoliu.
      </p>
    );
  }
  return (
    <p className="text-admin-muted mt-1 text-xs tabular-nums">
      <span className="text-brand-ink font-semibold">
        {pluralize(visits.albumVisits, FORMS.visit)} alba
      </span>
      , z toho {visits.photoOpens} s otevřenou fotkou · {visits.photoViews} zobrazení fotek za 90
      dní
    </p>
  );
}
