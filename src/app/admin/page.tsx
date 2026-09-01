import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { PhotoStatus } from "@/generated/prisma/enums";
import { pickCover } from "@/lib/event-access";
import { getAdminSession } from "@/lib/auth-guard";
import { FORMS, pluralize } from "@/lib/czech-plural";
import { createGallery, restoreGallery, restoreEvent } from "./actions";
import { AdminCreateBar } from "@/components/admin-create-bar";
import { CopyableLink, UnrecoverableLink } from "@/components/copy-button";
import { CoverThumb, type AdminCover } from "@/components/admin/cover-thumb";
import { ViewSparkline, ViewSparklineLegend } from "@/components/admin/view-sparkline";
import { decryptToken } from "@/lib/token-cipher";
import { Badge } from "@/components/ui/badge";
import { GALLERY_STATUS } from "@/lib/gallery-status";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import {
  buildViewSeries,
  emptySeries,
  lastDays,
  seriesMax,
  windowStart,
  type ViewSeries,
} from "@/lib/view-series";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

/** What both cover queries below select — `status` is what {@link pickCover} judges by. */
type CoverRow = AdminCover & { status: PhotoStatus };

/** The photographer's pick, in the shape the thumbnail wants; newest as fallback. */
function coverOf(chosen: CoverRow | null, newest: CoverRow[]): AdminCover | null {
  return pickCover(chosen, newest[0]);
}

/** Whole days left before the purge cron permanently deletes this gallery. */
function daysUntilPurge(purgeAt: Date): number {
  return Math.max(0, Math.ceil((purgeAt.getTime() - Date.now()) / DAY_MS));
}

/** The chart plus the two numbers it splits — the numbers are the accessible
 *  twin of the columns, never a caption for them. */
function ViewStats({ series, max, label }: { series: ViewSeries; max: number; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <ViewSparkline series={series} max={max} label={label} />
      <div className="w-24 text-xs tabular-nums">
        <p className="font-semibold">{pluralize(series.unique, FORMS.viewer)}</p>
        <p className="text-admin-muted">{pluralize(series.total, FORMS.visit)}</p>
      </div>
    </div>
  );
}

export default async function AdminPage() {
  const session = await getAdminSession();
  if (!session) redirect("/sign-in?next=/admin");

  const now = new Date();
  const days = lastDays(now);

  const coverFields = {
    objectKey: true,
    thumbObjectKey: true,
    placeholder: true,
    status: true,
  } as const;

  // Two halves of the same rule the wedding page uses (src/lib/event-access.ts):
  // the photographer's chosen cover, and the newest confirmed photo it falls
  // back to. Both are fetched because a gallery is usually missing the first.
  const chosenCover = { select: coverFields } satisfies Prisma.Gallery$coverPhotoArgs;
  const newestPhoto = {
    where: { status: "CONFIRMED" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 1,
    select: coverFields,
  } satisfies Prisma.Gallery$photosArgs;

  const [galleries, trashed, events, trashedEvents, sessions] = await Promise.all([
    prisma.gallery.findMany({
      where: { ownerId: session.user.id, trashedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        status: true,
        eventDate: true,
        coverPhoto: chosenCover,
        photos: newestPhoto,
        _count: {
          select: { photos: { where: { status: "CONFIRMED" } }, viewers: true },
        },
      },
    }),
    prisma.gallery.findMany({
      where: { ownerId: session.user.id, trashedAt: { not: null } },
      orderBy: { trashedAt: "desc" },
      select: { id: true, title: true, purgeAt: true },
    }),
    prisma.event.findMany({
      where: { ownerId: session.user.id, trashedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        eventDate: true,
        venue: true,
        slug: true,
        tokenCipher: true,
        // Both the cover and which galleries this wedding's chart sums over.
        // Ordered like the cards on the wedding page, so "this wedding's cover"
        // is the lead gallery's cover rather than whichever row came back first.
        galleries: {
          where: { trashedAt: null },
          orderBy: [{ position: "asc" }, { title: "asc" }],
          select: { id: true, coverPhoto: chosenCover, photos: newestPhoto },
        },
      },
    }),
    prisma.event.findMany({
      where: { ownerId: session.user.id, trashedAt: { not: null } },
      orderBy: { trashedAt: "desc" },
      select: { id: true, title: true, purgeAt: true },
    }),
    // One query for every row's chart: the window is two weeks of one
    // photographer's traffic, and bucketing it per day is cheaper in memory
    // than fourteen grouped queries per row would be on the database.
    prisma.viewSession.findMany({
      where: { gallery: { ownerId: session.user.id }, startedAt: { gte: windowStart(now) } },
      select: { galleryId: true, viewerId: true, startedAt: true },
    }),
  ]);

  // Rows carry the scale, so a gallery in the trash must not stretch it.
  const listed = new Set(galleries.map((gallery) => gallery.id));
  const gallerySeries = buildViewSeries(sessions, days, (id) => (listed.has(id) ? id : undefined));
  const galleryMax = seriesMax(gallerySeries.values());

  const eventOfGallery = new Map<string, string>();
  for (const event of events) {
    for (const gallery of event.galleries) eventOfGallery.set(gallery.id, event.id);
  }
  const eventSeries = buildViewSeries(sessions, days, (id) => eventOfGallery.get(id));
  // A wedding's chart sums its galleries, so it shares a scale with the other
  // weddings — never with the single galleries below, which count smaller by
  // construction.
  const eventMax = seriesMax(eventSeries.values());

  async function create(formData: FormData) {
    "use server";
    const id = await createGallery(formData);
    redirect(`/admin/g/${id}`);
  }

  return (
    <>
      <PageHeader title="Přehled" />

      <AdminCreateBar createGalleryAction={create} />

      {events.length > 0 && (
        <>
          <div className="mt-8 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <CardTitle className="mb-0">Svatby</CardTitle>
            <ViewSparklineLegend />
          </div>
          <Card
            as="ul"
            className="divide-admin-border mt-3 divide-y p-0 sm:p-0 dark:divide-neutral-800"
          >
            {events.map((event) => {
              const token = decryptToken(event.tokenCipher);
              const cover = coverOf(
                event.galleries.find((gallery) => gallery.coverPhoto)?.coverPhoto ?? null,
                event.galleries.flatMap((gallery) => gallery.photos),
              );
              const series = eventSeries.get(event.id) ?? emptySeries(days);
              return (
                <li key={event.id} className="space-y-3 p-4">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                    <CoverThumb cover={cover} />
                    <div className="min-w-0 flex-1 basis-48">
                      <Link href={`/admin/e/${event.id}`} className="font-medium hover:underline">
                        {event.title}
                      </Link>
                      <p className="text-admin-muted mt-1 text-xs dark:text-neutral-400">
                        {[
                          pluralize(event.galleries.length, FORMS.gallery),
                          event.venue,
                          event.eventDate?.toLocaleDateString("cs-CZ"),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <ViewStats series={series} max={eventMax} label={event.title} />
                  </div>
                  {token ? (
                    <CopyableLink href={`/s/${token}/${event.slug}`} />
                  ) : (
                    <UnrecoverableLink reason="Adresu už nelze zobrazit — svatba vznikla dřív, než se odkazy ukládaly čitelně." />
                  )}
                </li>
              );
            })}
          </Card>
        </>
      )}

      <div className="mt-8 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <CardTitle className="mb-0">Galerie</CardTitle>
        {galleries.length > 0 && <ViewSparklineLegend />}
      </div>
      <Card
        as="ul"
        className="divide-admin-border mt-3 divide-y p-0 sm:p-0 dark:divide-neutral-800"
      >
        {galleries.length === 0 && (
          <li className="text-admin-muted p-4 text-sm dark:text-neutral-400">
            Zatím žádná galerie.
          </li>
        )}
        {galleries.map((gallery) => {
          const status = GALLERY_STATUS[gallery.status];
          const series = gallerySeries.get(gallery.id) ?? emptySeries(days);
          return (
            <li key={gallery.id} className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
              <CoverThumb cover={coverOf(gallery.coverPhoto, gallery.photos)} />
              <div className="min-w-0 flex-1 basis-48">
                <Link href={`/admin/g/${gallery.id}`} className="font-medium hover:underline">
                  {gallery.title}
                </Link>
                <p className="text-admin-muted mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs dark:text-neutral-400">
                  <Badge tone={status.tone}>{status.label}</Badge>
                  <span>
                    {[
                      pluralize(gallery._count.photos, FORMS.photo),
                      gallery.eventDate?.toLocaleDateString("cs-CZ"),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </p>
              </div>
              <ViewStats series={series} max={galleryMax} label={gallery.title} />
            </li>
          );
        })}
      </Card>

      {trashedEvents.length > 0 && (
        <Card as="details" className="mt-6 p-0 sm:p-0">
          <summary className="text-admin-muted cursor-pointer p-4 text-sm font-semibold dark:text-neutral-400">
            Svatby v koši ({trashedEvents.length})
          </summary>
          <ul className="divide-admin-border border-admin-border divide-y border-t dark:divide-neutral-800 dark:border-neutral-800">
            {trashedEvents.map((event) => {
              const daysLeft = event.purgeAt ? daysUntilPurge(event.purgeAt) : 0;
              return (
                <li key={event.id} className="flex items-center justify-between p-4">
                  <div>
                    <p className="text-admin-muted font-medium dark:text-neutral-400">
                      {event.title}
                    </p>
                    <p className="text-admin-muted text-xs dark:text-neutral-400">
                      {daysLeft > 0
                        ? `Smazána natrvalo za ${pluralize(daysLeft, FORMS.day)}`
                        : "Bude smazána natrvalo brzy"}
                    </p>
                  </div>
                  <form action={restoreEvent.bind(null, event.id)}>
                    <Button type="submit" variant="secondary" size="sm">
                      Obnovit
                    </Button>
                  </form>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {trashed.length > 0 && (
        <Card as="details" className="mt-6 p-0 sm:p-0">
          <summary className="text-admin-muted cursor-pointer p-4 text-sm font-semibold dark:text-neutral-400">
            Koš ({trashed.length})
          </summary>
          <ul className="divide-admin-border border-admin-border divide-y border-t dark:divide-neutral-800 dark:border-neutral-800">
            {trashed.map((gallery) => {
              const daysLeft = gallery.purgeAt ? daysUntilPurge(gallery.purgeAt) : 0;
              return (
                <li key={gallery.id} className="flex items-center justify-between p-4">
                  <div>
                    <p className="text-admin-muted font-medium dark:text-neutral-400">
                      {gallery.title}
                    </p>
                    <p className="text-admin-muted text-xs dark:text-neutral-400">
                      {daysLeft > 0
                        ? `Smazána natrvalo za ${pluralize(daysLeft, FORMS.day)}`
                        : "Bude smazána natrvalo brzy"}
                    </p>
                  </div>
                  <form action={restoreGallery.bind(null, gallery.id)}>
                    <Button type="submit" variant="secondary" size="sm">
                      Obnovit
                    </Button>
                  </form>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </>
  );
}
