import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getAdminSession } from "@/lib/auth-guard";
import { BADGE_CAP, unreadCount } from "@/lib/feed";
import { createGallery } from "./actions";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await getAdminSession();
  if (!session) redirect("/sign-in?next=/admin");

  const unread = await unreadCount(session.user.id);

  const galleries = await prisma.gallery.findMany({
    where: { ownerId: session.user.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      status: true,
      eventDate: true,
      _count: { select: { photos: true, viewers: true, events: true } },
    },
  });

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
    </main>
  );
}
