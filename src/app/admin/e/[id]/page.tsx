import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getAdminSession } from "@/lib/auth-guard";
import {
  attachGalleryToEvent,
  detachGalleryFromEvent,
  moveGalleryInEvent,
  setGalleryEventLink,
  setGalleryListed,
  trashEvent,
} from "../../actions";
import { isCardVisible } from "@/lib/event-cards";
import { decryptToken } from "@/lib/token-cipher";
import { CopyableLink, UnrecoverableLink } from "@/components/copy-button";
import { NewGalleryInEvent } from "@/components/new-gallery-in-event";
import { EventSettings } from "@/components/event-settings";

export const dynamic = "force-dynamic";

/** Shown where a link would be, when the ciphertext cannot be read back. */
const NO_LINK =
  "Adresu už nelze zobrazit — vznikla dřív, než se odkazy ukládaly čitelně. Vytvoř nový odkaz.";

/**
 * One wedding page in the admin (docs/GUEST-GALLERIES.md §2).
 *
 * The two switches are shown as two switches, on purpose: whether a gallery has
 * a live share link and whether it is listed here are independent, and the
 * common mistake — assuming un-listing revokes access — is exactly what the
 * layout has to make impossible to believe.
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
      tokenCipher: true,
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
            select: {
              id: true,
              label: true,
              allowUpload: true,
              slug: true,
              tokenCipher: true,
              createdAt: true,
            },
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

  const eventToken = decryptToken(event.tokenCipher);
  const eventUrl = eventToken ? `/s/${eventToken}/${event.slug}` : null;
  const now = new Date();

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <Link href="/admin" className="text-sm text-neutral-500 underline">
            ← Přehled
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">{event.title}</h1>
          <p className="text-sm text-neutral-500">
            {[event.eventDate?.toLocaleDateString("cs-CZ"), event.venue]
              .filter(Boolean)
              .join(" · ") || "Bez data a místa"}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex gap-2">
            <EventSettings
              eventId={event.id}
              title={event.title}
              eventDate={event.eventDate?.toISOString().slice(0, 10) ?? null}
              venue={event.venue}
            />
            <form action={trashEvent.bind(null, event.id)}>
              <button type="submit" className="rounded border px-3 py-1.5 text-sm text-red-600">
                Do koše
              </button>
            </form>
          </div>
        </div>
      </header>

      <section className="rounded-lg border p-4">
        <h2 className="text-sm font-medium">Adresa svatby</h2>
        <p className="mt-1 mb-2 text-xs text-neutral-500">
          Tohle dáš na QR ceduli. Vede sem každá připojená galerie a adresa se nemění, ani když
          galerie přibývají.
        </p>
        {eventUrl ? <CopyableLink href={eventUrl} /> : <UnrecoverableLink reason={NO_LINK} />}
      </section>

      <section className="rounded-lg border p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium">Galerie na této svatbě</h2>
          <span className="text-xs text-neutral-500">{event.galleries.length}</span>
        </div>
        <p className="mt-1 text-xs text-neutral-500">
          „Na stránce“ řídí jen kartu na rozcestníku. Vlastní odkaz galerie tím nezaniká — kdo ho
          dostal, chodí dál.
        </p>

        <ul className="mt-4 divide-y">
          {event.galleries.length === 0 && (
            <li className="py-3 text-sm text-neutral-500">Zatím žádná galerie. Přidej ji níže.</li>
          )}
          {event.galleries.map((gallery, index) => {
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
            const cardUrl =
              eventToken && gallery.eventKey
                ? `/s/${eventToken}/${event.slug}/${gallery.eventKey}`
                : null;

            return (
              <li key={gallery.id} className="space-y-3 py-4">
                <div className="flex items-baseline justify-between gap-3">
                  <div>
                    <Link href={`/admin/g/${gallery.id}`} className="font-medium hover:underline">
                      {gallery.title}
                    </Link>
                    <p className="text-xs text-neutral-500">
                      {gallery._count.photos} fotek · {gallery.status}
                    </p>
                  </div>
                  <span
                    className={
                      visible
                        ? "rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                        : "rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500 dark:bg-neutral-900"
                    }
                  >
                    {visible ? "Vidí ji hosté" : "Na rozcestníku není"}
                  </span>
                </div>

                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-neutral-500">Ze stránky svatby</p>
                  {cardUrl ? (
                    <CopyableLink href={cardUrl} />
                  ) : (
                    <UnrecoverableLink
                      reason={
                        eventToken
                          ? "Galerie nemá klíč — odpoj ji a přidej znovu."
                          : "Nejdřív je potřeba zobrazitelná adresa svatby."
                      }
                    />
                  )}
                </div>

                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-neutral-500">
                    Vlastní odkazy galerie — pošli je někomu, kdo nemá vidět zbytek svatby
                  </p>
                  {gallery.shareLinks.length === 0 && (
                    <p className="text-xs text-neutral-500">
                      Žádný živý odkaz. Vytvoř ho v detailu galerie.
                    </p>
                  )}
                  {gallery.shareLinks.map((link) => {
                    const token = decryptToken(link.tokenCipher);
                    const note = [
                      link.label ?? link.createdAt.toLocaleDateString("cs-CZ"),
                      link.allowUpload ? "hosté nahrávají" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ");

                    return token ? (
                      <CopyableLink
                        key={link.id}
                        href={`/g/${token}/${link.slug ?? ""}`}
                        note={note}
                      />
                    ) : (
                      <UnrecoverableLink key={link.id} reason={`${note} — ${NO_LINK}`} />
                    );
                  })}
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

                  {event.galleries.length > 1 && (
                    <span className="flex items-center gap-1">
                      <form action={moveGalleryInEvent.bind(null, gallery.id, "up")}>
                        <button
                          type="submit"
                          disabled={index === 0}
                          aria-label="Posunout nahoru"
                          className="rounded border px-2 py-1 disabled:opacity-30"
                        >
                          ↑
                        </button>
                      </form>
                      <form action={moveGalleryInEvent.bind(null, gallery.id, "down")}>
                        <button
                          type="submit"
                          disabled={index === event.galleries.length - 1}
                          aria-label="Posunout dolů"
                          className="rounded border px-2 py-1 disabled:opacity-30"
                        >
                          ↓
                        </button>
                      </form>
                    </span>
                  )}

                  <form action={detachGalleryFromEvent.bind(null, gallery.id)}>
                    <button type="submit" className="rounded border px-2 py-1 text-red-600">
                      Odebrat ze svatby
                    </button>
                  </form>
                </div>

                {gallery.listedOnEvent && !gallery.eventLinkId && (
                  <p className="rounded border border-amber-400 bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                    Karta nemá odkaz, přes který by pustila dovnitř — hostům se nezobrazí. Vyber ho
                    výše u „Karta vede přes“.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <NewGalleryInEvent eventId={event.id} unattached={unattached} attach={attachGalleryToEvent} />
    </main>
  );
}
