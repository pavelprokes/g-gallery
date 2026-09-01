import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/format-date";
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
import { CoverThumb } from "@/components/admin/cover-thumb";
import { NewGalleryInEvent } from "@/components/new-gallery-in-event";
import { EventSettings } from "@/components/event-settings";
import { Alert } from "@/components/ui/alert";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { eventCrumbs } from "@/lib/admin-breadcrumbs";
import { FORMS, pluralize } from "@/lib/czech-plural";
import { GALLERY_STATUS } from "@/lib/gallery-status";

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
          _count: { select: { photos: { where: { status: "CONFIRMED" } } } },
          // Its cover — the newest confirmed photo, same rule as the wedding
          // page and the overview (src/components/admin/cover-thumb.tsx).
          photos: {
            where: { status: "CONFIRMED" },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 1,
            select: { objectKey: true, thumbObjectKey: true, placeholder: true },
          },
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
    <div className="space-y-6">
      <PageHeader
        title={event.title}
        crumbs={eventCrumbs(event)}
        subtitle={
          [event.eventDate ? formatDate(event.eventDate, "cs") : null, event.venue]
            .filter(Boolean)
            .join(" · ") || "Bez data a místa"
        }
        actions={
          <>
            <EventSettings
              eventId={event.id}
              title={event.title}
              eventDate={event.eventDate?.toISOString().slice(0, 10) ?? null}
              venue={event.venue}
            />
            <form action={trashEvent.bind(null, event.id)}>
              <Button type="submit" variant="destructive">
                Do koše
              </Button>
            </form>
          </>
        }
      />

      <Card as="section">
        <CardTitle className="mb-1">Adresa svatby</CardTitle>
        <p className="text-admin-muted mb-3 text-sm dark:text-neutral-400">
          Tohle dáš na QR ceduli. Vede sem každá připojená galerie a adresa se nemění, ani když
          galerie přibývají.
        </p>
        {eventUrl ? (
          <>
            <CopyableLink href={eventUrl} />
            <Link
              href={`/admin/e/${event.id}/sign`}
              className={`mt-2 inline-block ${buttonClasses("secondary", "sm")}`}
            >
              Cedulka k tisku
            </Link>
          </>
        ) : (
          <UnrecoverableLink reason={NO_LINK} />
        )}
      </Card>

      <Card as="section">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <CardTitle className="mb-0">Galerie na této svatbě</CardTitle>
          <span className="text-admin-muted text-xs dark:text-neutral-400">
            {event.galleries.length}
          </span>
        </div>
        <p className="text-admin-muted mt-2 text-sm dark:text-neutral-400">
          „Na stránce“ řídí jen kartu na rozcestníku. Vlastní odkaz galerie tím nezaniká — kdo ho
          dostal, chodí dál.
        </p>

        <ul className="divide-admin-border mt-4 divide-y dark:divide-neutral-800">
          {event.galleries.length === 0 && (
            <li className="text-admin-muted py-3 text-sm dark:text-neutral-400">
              Zatím žádná galerie. Přidej ji níže.
            </li>
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
                <div className="flex items-start gap-3">
                  <CoverThumb cover={gallery.photos[0] ?? null} />
                  <div className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <div className="min-w-0">
                      <Link href={`/admin/g/${gallery.id}`} className="font-medium hover:underline">
                        {gallery.title}
                      </Link>
                      <p className="text-admin-muted text-xs dark:text-neutral-400">
                        {pluralize(gallery._count.photos, FORMS.photo)} ·{" "}
                        {GALLERY_STATUS[gallery.status].label}
                      </p>
                    </div>
                    <Badge tone={visible ? "success" : "muted"}>
                      {visible ? "Vidí ji hosté" : "Na rozcestníku není"}
                    </Badge>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <p className="text-admin-muted text-sm font-semibold dark:text-neutral-400">
                    Ze stránky svatby
                  </p>
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
                  <p className="text-admin-muted text-sm font-semibold dark:text-neutral-400">
                    Vlastní odkazy galerie — pošli je někomu, kdo nemá vidět zbytek svatby
                  </p>
                  {gallery.shareLinks.length === 0 && (
                    <p className="text-admin-muted text-xs dark:text-neutral-400">
                      Žádný živý odkaz. Vytvoř ho v detailu galerie.
                    </p>
                  )}
                  {gallery.shareLinks.map((link) => {
                    const token = decryptToken(link.tokenCipher);
                    const note = [
                      link.label ?? formatDate(link.createdAt, "cs"),
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
                    <Button type="submit" variant="secondary" size="sm">
                      {gallery.listedOnEvent ? "Skrýt ze stránky" : "Zobrazit na stránce"}
                    </Button>
                  </form>

                  <form
                    action={async (formData: FormData) => {
                      "use server";
                      const value = String(formData.get("shareLinkId") ?? "");
                      await setGalleryEventLink(gallery.id, value || null);
                    }}
                    className="flex items-center gap-2"
                  >
                    <Label htmlFor={`event-link-${gallery.id}`} className="mb-0 shrink-0">
                      Karta vede přes
                    </Label>
                    <Select
                      id={`event-link-${gallery.id}`}
                      name="shareLinkId"
                      defaultValue={gallery.eventLinkId ?? ""}
                      className="w-auto"
                    >
                      <option value="">— žádný —</option>
                      {gallery.shareLinks.map((link) => (
                        <option key={link.id} value={link.id}>
                          {link.label ?? formatDate(link.createdAt, "cs")}
                          {link.allowUpload ? " · hosté nahrávají" : ""}
                        </option>
                      ))}
                    </Select>
                    <Button type="submit" variant="secondary" size="sm">
                      Uložit
                    </Button>
                  </form>

                  {event.galleries.length > 1 && (
                    <span className="flex items-center gap-1">
                      <form action={moveGalleryInEvent.bind(null, gallery.id, "up")}>
                        <Button
                          type="submit"
                          variant="secondary"
                          size="sm"
                          disabled={index === 0}
                          aria-label="Posunout nahoru"
                        >
                          ↑
                        </Button>
                      </form>
                      <form action={moveGalleryInEvent.bind(null, gallery.id, "down")}>
                        <Button
                          type="submit"
                          variant="secondary"
                          size="sm"
                          disabled={index === event.galleries.length - 1}
                          aria-label="Posunout dolů"
                        >
                          ↓
                        </Button>
                      </form>
                    </span>
                  )}

                  <form action={detachGalleryFromEvent.bind(null, gallery.id)}>
                    <Button type="submit" variant="destructive" size="sm">
                      Odebrat ze svatby
                    </Button>
                  </form>
                </div>

                {gallery.listedOnEvent && !gallery.eventLinkId && (
                  <Alert compact>
                    Karta nemá odkaz, přes který by pustila dovnitř — hostům se nezobrazí. Vyber ho
                    výše u „Karta vede přes“.
                  </Alert>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      <NewGalleryInEvent eventId={event.id} unattached={unattached} attach={attachGalleryToEvent} />
    </div>
  );
}
