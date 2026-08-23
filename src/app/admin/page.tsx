import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getAdminSession } from "@/lib/auth-guard";
import { FORMS, pluralize } from "@/lib/czech-plural";
import { createGallery, restoreGallery, restoreEvent } from "./actions";
import { AdminCreateBar } from "@/components/admin-create-bar";
import { CopyableLink, UnrecoverableLink } from "@/components/copy-button";
import { decryptToken } from "@/lib/token-cipher";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days left before the purge cron permanently deletes this gallery. */
function daysUntilPurge(purgeAt: Date): number {
  return Math.max(0, Math.ceil((purgeAt.getTime() - Date.now()) / DAY_MS));
}

export default async function AdminPage() {
  const session = await getAdminSession();
  if (!session) redirect("/sign-in?next=/admin");

  const [galleries, trashed, events, trashedEvents] = await Promise.all([
    prisma.gallery.findMany({
      where: { ownerId: session.user.id, trashedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        status: true,
        eventDate: true,
        _count: { select: { photos: true, viewers: true, activityEvents: true } },
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
        _count: { select: { galleries: true } },
      },
    }),
    prisma.event.findMany({
      where: { ownerId: session.user.id, trashedAt: { not: null } },
      orderBy: { trashedAt: "desc" },
      select: { id: true, title: true, purgeAt: true },
    }),
  ]);

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
          <CardTitle className="mt-8">Svatby</CardTitle>
          <Card as="ul" className="divide-admin-border divide-y p-0 sm:p-0 dark:divide-neutral-800">
            {events.map((event) => {
              const token = decryptToken(event.tokenCipher);
              return (
                <li key={event.id} className="space-y-2 p-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <div>
                      <Link href={`/admin/e/${event.id}`} className="font-medium hover:underline">
                        {event.title}
                      </Link>
                      <p className="text-admin-muted text-xs dark:text-neutral-400">
                        {event._count.galleries} galerií
                        {event.venue && ` · ${event.venue}`}
                      </p>
                    </div>
                    <span className="text-admin-muted text-xs dark:text-neutral-400">
                      {event.eventDate?.toLocaleDateString("cs-CZ") ?? "—"}
                    </span>
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

      <CardTitle className="mt-8">Galerie</CardTitle>
      <Card as="ul" className="divide-admin-border divide-y p-0 sm:p-0 dark:divide-neutral-800">
        {galleries.length === 0 && (
          <li className="text-admin-muted p-4 text-sm dark:text-neutral-400">
            Zatím žádná galerie.
          </li>
        )}
        {galleries.map((gallery) => (
          <li key={gallery.id} className="flex items-center justify-between p-4">
            <div>
              <Link href={`/admin/g/${gallery.id}`} className="font-medium hover:underline">
                {gallery.title}
              </Link>
              <p className="text-admin-muted text-xs dark:text-neutral-400">
                {gallery.status} · {gallery._count.photos} fotek · {gallery._count.viewers} diváků
              </p>
            </div>
            <span className="text-admin-muted text-xs dark:text-neutral-400">
              {gallery.eventDate?.toLocaleDateString("cs-CZ") ?? "—"}
            </span>
          </li>
        ))}
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
