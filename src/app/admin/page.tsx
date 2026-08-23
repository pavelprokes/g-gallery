import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getAdminSession } from "@/lib/auth-guard";
import { BADGE_CAP, unreadCount } from "@/lib/feed";
import { FORMS, pluralize } from "@/lib/czech-plural";
import { createGallery, restoreGallery, restoreEvent } from "./actions";
import { AdminCreateBar } from "@/components/admin-create-bar";
import { CopyableLink, UnrecoverableLink } from "@/components/copy-button";
import { decryptToken } from "@/lib/token-cipher";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days left before the purge cron permanently deletes this gallery. */
function daysUntilPurge(purgeAt: Date): number {
  return Math.max(0, Math.ceil((purgeAt.getTime() - Date.now()) / DAY_MS));
}

export default async function AdminPage() {
  const session = await getAdminSession();
  if (!session) redirect("/sign-in?next=/admin");

  const unread = await unreadCount(session.user.id);

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
    <main className="mx-auto max-w-4xl p-8">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Přehled</h1>
        <div className="flex items-center gap-4">
          <Link href="/admin/updates" className="relative text-sm underline">
            Aktivita
            {unread > 0 && (
              <span className="absolute -top-2 -right-4 rounded-full bg-rose-600 px-1.5 text-xs font-medium text-white tabular-nums">
                {unread > BADGE_CAP ? `${BADGE_CAP}+` : unread}
              </span>
            )}
          </Link>
          <span className="text-sm text-neutral-500">{session.user.email}</span>
        </div>
      </header>

      <AdminCreateBar createGalleryAction={create} />

      {events.length > 0 && (
        <>
          <h2 className="mt-8 text-sm font-medium text-neutral-500">Svatby</h2>
          <ul className="mt-2 divide-y rounded-lg border">
            {events.map((event) => {
              const token = decryptToken(event.tokenCipher);
              return (
                <li key={event.id} className="space-y-2 p-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <div>
                      <Link href={`/admin/e/${event.id}`} className="font-medium hover:underline">
                        {event.title}
                      </Link>
                      <p className="text-xs text-neutral-500">
                        {event._count.galleries} galerií
                        {event.venue && ` · ${event.venue}`}
                      </p>
                    </div>
                    <span className="text-xs text-neutral-400">
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
          </ul>
        </>
      )}

      <h2 className="mt-8 text-sm font-medium text-neutral-500">Galerie</h2>
      <ul className="mt-2 divide-y rounded-lg border">
        {galleries.length === 0 && (
          <li className="p-4 text-sm text-neutral-500">Zatím žádná galerie.</li>
        )}
        {galleries.map((gallery) => (
          <li key={gallery.id} className="flex items-center justify-between p-4">
            <div>
              <Link href={`/admin/g/${gallery.id}`} className="font-medium hover:underline">
                {gallery.title}
              </Link>
              <p className="text-xs text-neutral-500">
                {gallery.status} · {gallery._count.photos} fotek · {gallery._count.viewers} diváků
              </p>
            </div>
            <span className="text-xs text-neutral-400">
              {gallery.eventDate?.toLocaleDateString("cs-CZ") ?? "—"}
            </span>
          </li>
        ))}
      </ul>

      {trashedEvents.length > 0 && (
        <details className="mt-6 rounded-lg border">
          <summary className="cursor-pointer p-4 text-sm font-medium text-neutral-500">
            Svatby v koši ({trashedEvents.length})
          </summary>
          <ul className="divide-y border-t">
            {trashedEvents.map((event) => {
              const daysLeft = event.purgeAt ? daysUntilPurge(event.purgeAt) : 0;
              return (
                <li key={event.id} className="flex items-center justify-between p-4">
                  <div>
                    <p className="font-medium text-neutral-500">{event.title}</p>
                    <p className="text-xs text-neutral-400">
                      {daysLeft > 0
                        ? `Smazána natrvalo za ${pluralize(daysLeft, FORMS.day)}`
                        : "Bude smazána natrvalo brzy"}
                    </p>
                  </div>
                  <form action={restoreEvent.bind(null, event.id)}>
                    <button type="submit" className="rounded border px-2 py-1 text-xs">
                      Obnovit
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        </details>
      )}

      {trashed.length > 0 && (
        <details className="mt-6 rounded-lg border">
          <summary className="cursor-pointer p-4 text-sm font-medium text-neutral-500">
            Koš ({trashed.length})
          </summary>
          <ul className="divide-y border-t">
            {trashed.map((gallery) => {
              const daysLeft = gallery.purgeAt ? daysUntilPurge(gallery.purgeAt) : 0;
              return (
                <li key={gallery.id} className="flex items-center justify-between p-4">
                  <div>
                    <p className="font-medium text-neutral-500">{gallery.title}</p>
                    <p className="text-xs text-neutral-400">
                      {daysLeft > 0
                        ? `Smazána natrvalo za ${pluralize(daysLeft, FORMS.day)}`
                        : "Bude smazána natrvalo brzy"}
                    </p>
                  </div>
                  <form action={restoreGallery.bind(null, gallery.id)}>
                    <button type="submit" className="rounded border px-2 py-1 text-xs">
                      Obnovit
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </main>
  );
}
