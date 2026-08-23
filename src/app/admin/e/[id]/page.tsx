import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getAdminSession } from "@/lib/auth-guard";
import {
  attachGalleryToEvent,
  detachGalleryFromEvent,
  setGalleryEventLink,
  setGalleryListed,
  trashEvent,
} from "../../actions";
import { isCardVisible } from "@/lib/event-cards";

export const dynamic = "force-dynamic";

/**
 * One wedding page in the admin (docs/GUEST-GALLERIES.md §2).
 *
 * The two switches are shown as two switches, on purpose: whether a gallery has
 * a live share link and whether it is listed here are independent, and the
 * common mistake — assuming un-listing revokes access — is exactly what the
 * layout has to make impossible to believe.
 *
 * The wedding URL is not shown: only the token's hash is stored, so it exists
 * exactly once, right after creation, on the admin list page.
 */
export default async function AdminEventPage(props: PageProps<"/admin/e/[id]">) {
  const session = await getAdminSession();
  if (!session) redirect("/sign-in?next=/admin");

  const { id } = await props.params;

  const event = await prisma.event.findFirst({
    where: { id, ownerId: session.user.id },
    select: {
      id: true,
      title: true,
      eventDate: true,
      venue: true,
      slug: true,
      trashedAt: true,
      galleries: {
        orderBy: [{ position: "asc" }, { title: "asc" }],
        select: {
          id: true,
          title: true,
          eventKey: true,
          position: true,
          listedOnEvent: true,
          status: true,
          trashedAt: true,
          eventLinkId: true,
          eventLink: { select: { revokedAt: true, expiresAt: true } },
          _count: { select: { photos: true } },
          shareLinks: {
            where: { revokedAt: null },
            orderBy: { createdAt: "desc" },
            select: { id: true, label: true, allowUpload: true, createdAt: true },
          },
        },
      },
    },
  });
  if (!event) notFound();

  const unattached = await prisma.gallery.findMany({
    where: { ownerId: session.user.id, eventId: null, trashedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true },
  });

  const now = new Date();

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <Link href="/admin" className="text-sm text-neutral-500 underline">
            ← Galerie
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">{event.title}</h1>
          <p className="text-sm text-neutral-500">
            {[event.eventDate?.toLocaleDateString("cs-CZ"), event.venue]
              .filter(Boolean)
              .join(" · ") || "Bez data a místa"}
          </p>
        </div>
        <form action={trashEvent.bind(null, event.id)}>
          <button type="submit" className="rounded border px-3 py-1.5 text-sm text-red-600">
            Do koše
          </button>
        </form>
      </header>

      <section className="rounded-lg border p-4">
        <h2 className="text-sm font-medium">Galerie na této svatbě</h2>
        <p className="mt-1 text-xs text-neutral-500">
          „Na stránce“ řídí jen kartu na rozcestníku. Vlastní odkaz galerie tím nezaniká — kdo ho
          dostal, chodí dál.
        </p>

        <ul className="mt-4 divide-y">
          {event.galleries.length === 0 && (
            <li className="py-3 text-sm text-neutral-500">Zatím žádná galerie.</li>
          )}
          {event.galleries.map((gallery) => {
            const visible = isCardVisible(
              {
                id: gallery.id,
                title: gallery.title,
                eventKey: gallery.eventKey,
                position: gallery.position,
                listedOnEvent: gallery.listedOnEvent,
                status: gallery.status,
                trashedAt: gallery.trashedAt,
                eventLink: gallery.eventLink,
              },
              now,
            );

            return (
              <li key={gallery.id} className="space-y-2 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <div>
                    <Link href={`/admin/g/${gallery.id}`} className="font-medium hover:underline">
                      {gallery.title}
                    </Link>
                    <p className="text-xs text-neutral-500">
                      <code>{gallery.eventKey ?? "—"}</code> · {gallery._count.photos} fotek ·{" "}
                      {gallery.status}
                    </p>
                  </div>
                  <span
                    className={
                      visible
                        ? "text-xs text-emerald-700 dark:text-emerald-400"
                        : "text-xs text-neutral-500"
                    }
                  >
                    {visible ? "Vidí ji hosté" : "Na rozcestníku není"}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <form action={setGalleryListed.bind(null, gallery.id, !gallery.listedOnEvent)}>
                    <button type="submit" className="rounded border px-2 py-1">
                      {gallery.listedOnEvent ? "Skrýt ze stránky" : "Zobrazit na stránce"}
                    </button>
                  </form>

                  <form
                    action={async (formData: FormData) => {
                      "use server";
                      const value = String(formData.get("shareLinkId") ?? "");
                      await setGalleryEventLink(gallery.id, value || null);
                    }}
                    className="flex items-center gap-2"
                  >
                    <label className="text-neutral-500">Karta vede přes</label>
                    <select
                      name="shareLinkId"
                      defaultValue={gallery.eventLinkId ?? ""}
                      className="rounded border px-2 py-1"
                    >
                      <option value="">— žádný —</option>
                      {gallery.shareLinks.map((link) => (
                        <option key={link.id} value={link.id}>
                          {link.label ?? link.createdAt.toLocaleDateString("cs-CZ")}
                          {link.allowUpload ? " · hosté nahrávají" : ""}
                        </option>
                      ))}
                    </select>
                    <button type="submit" className="rounded border px-2 py-1">
                      Uložit
                    </button>
                  </form>

                  <form action={detachGalleryFromEvent.bind(null, gallery.id)}>
                    <button type="submit" className="rounded border px-2 py-1 text-red-600">
                      Odebrat ze svatby
                    </button>
                  </form>
                </div>

                {gallery.listedOnEvent && !gallery.eventLinkId && (
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    Karta nemá odkaz, přes který by pustila dovnitř — hostům se nezobrazí.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {unattached.length > 0 && (
        <section className="rounded-lg border p-4">
          <h2 className="text-sm font-medium">Přidat galerii</h2>
          <form
            action={async (formData: FormData) => {
              "use server";
              await attachGalleryToEvent(event.id, String(formData.get("galleryId")));
            }}
            className="mt-3 flex flex-wrap items-end gap-3"
          >
            <select name="galleryId" className="rounded border px-2 py-1 text-sm">
              {unattached.map((gallery) => (
                <option key={gallery.id} value={gallery.id}>
                  {gallery.title}
                </option>
              ))}
            </select>
            <button type="submit" className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white">
              Přidat
            </button>
          </form>
        </section>
      )}
    </main>
  );
}
