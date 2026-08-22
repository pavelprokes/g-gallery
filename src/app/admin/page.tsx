import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getAdminSession } from "@/lib/auth-guard";
import { BADGE_CAP, unreadCount } from "@/lib/feed";
import { FORMS, pluralize } from "@/lib/czech-plural";
import { createGallery, restoreGallery } from "./actions";

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

  const [galleries, trashed] = await Promise.all([
    prisma.gallery.findMany({
      where: { ownerId: session.user.id, trashedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        status: true,
        eventDate: true,
        _count: { select: { photos: true, viewers: true, events: true } },
      },
    }),
    prisma.gallery.findMany({
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
        <h1 className="text-2xl font-semibold">Galerie</h1>
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

      <form action={create} className="mt-6 flex flex-wrap items-end gap-3 rounded-lg border p-4">
        <label className="flex flex-col gap-1 text-sm">
          Název
          <input name="title" required maxLength={200} className="rounded border px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Datum akce
          <input name="eventDate" type="date" className="rounded border px-2 py-1" />
        </label>
        <button type="submit" className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white">
          Vytvořit
        </button>
      </form>

      <ul className="mt-6 divide-y rounded-lg border">
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
