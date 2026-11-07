import Link from "next/link";
import { CoverThumb, type AdminCover } from "@/components/admin/cover-thumb";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { FORMS, pluralize } from "@/lib/czech-plural";

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
}: {
  galleries: PortfolioGallery[];
  websiteBase: string;
}) {
  if (galleries.length === 0) return null;
  return (
    <section>
      <CardTitle className="mb-3">Portfolio</CardTitle>
      <Card as="ul" flush className="divide-admin-border divide-y">
        {galleries.map((gallery) => {
          const page = `${websiteBase}/portfolio/${gallery.webSlug}`;
          return (
            <li key={gallery.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3">
              <CoverThumb cover={gallery.coverPhoto ?? gallery.photos[0] ?? null} />
              <div className="min-w-0 flex-1 basis-48">
                <a
                  href={page}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium hover:underline"
                >
                  {gallery.title}
                </a>
                <p className="text-admin-muted mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  {gallery.status !== "PUBLISHED" && <Badge tone="warning">Koncept</Badge>}
                  <span>
                    {gallery.webSlug} · {pluralize(gallery._count.photos, FORMS.photo)}
                  </span>
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={page}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonClasses("secondary", "md")}
                >
                  Na webu ↗
                </a>
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
