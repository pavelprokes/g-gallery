import { getLocale, getTranslations } from "next-intl/server";
import Image from "next/image";
import Link from "next/link";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { SiteFooterIdentity } from "@/components/site-footer-identity";
import { CameraIcon, ChevronRightIcon } from "@/components/ui/icons";
import { formatDate } from "@/lib/format-date";
import type { EventCard, ResolvedEvent } from "@/lib/event-access";
import { splitEventCards } from "@/lib/event-cards";
import type { SignedImageGrant } from "@/lib/image-signing";
import { mintImageGrant } from "@/lib/shared-gallery";
import { srcFor } from "@/lib/image-src";

/**
 * The wedding page's rozcestník (docs/GUEST-GALLERIES.md §2).
 *
 * The identity — couple, date, venue — sits in the header once. Cards carry
 * only what tells them apart: naming each card with the full
 * "12. 8. 2026 Pavel a Patricie, Statek Benice — …" stacks three near-identical
 * paragraphs on a phone with the distinguishing word at the end of each.
 *
 * Two kinds of card, because a wedding page holds one to three galleries of
 * two very different weights — one or two from the photographer and, beside
 * them, the guests' phone photos:
 *
 *   - The photographer's galleries are large cover tiles with the caption laid
 *     over the photo. The tile's height comes from its aspect ratio alone, so
 *     two tiles side by side are always the same height whatever their titles
 *     do — the previous card put the text underneath, and a title that wrapped
 *     to a second line made its card taller than its neighbour.
 *   - The guests' gallery is a compact row under them: a small thumbnail, the
 *     count, and the one line that says what it is for. It is the bonus, not
 *     the delivery, and a third full-size tile made it look like a third set
 *     of professional photos.
 *
 * No section headings: the guest gallery is called "Od hostů" by default, and
 * a heading above it would say the same thing twice.
 */
export async function EventHub({
  event,
  eventToken,
}: {
  event: ResolvedEvent;
  eventToken: string;
}) {
  // One grant per gallery: a grant covers a single storagePrefix, and each
  // gallery has its own. Cheap — an HMAC each, no database work.
  const grants = new Map<string, SignedImageGrant | null>();
  await Promise.all(
    event.cards.map(async (card) => {
      grants.set(card.id, await mintImageGrant(card.storagePrefix));
    }),
  );
  const locale = await getLocale();
  const t = await getTranslations("gallery");

  const { main, guest } = splitEventCards(event.cards);
  const hrefFor = (card: EventCard) =>
    `/s/${encodeURIComponent(eventToken)}/${event.slug}/${card.eventKey}`;
  const metaFor = (card: EventCard) =>
    [
      card.photoCount > 0 ? t("photoCount", { count: card.photoCount }) : t("emptyCard"),
      card.latestPhotoAt ? formatDate(card.latestPhotoAt, locale) : null,
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:py-10">
      <div className="mb-4 flex justify-end">
        <LocaleSwitcher />
      </div>
      <header>
        <h1 className="text-page sm:text-display font-semibold text-balance">{event.title}</h1>
        <p className="text-body text-brand-ink/60 dark:text-brand-tint/60 mt-1">
          {[event.eventDate ? formatDate(event.eventDate, locale) : null, event.venue]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </header>

      {event.cards.length === 0 ? (
        <p className="text-body mt-10 text-neutral-500">{t("emptyEvent")}</p>
      ) : (
        <div className="mt-8 flex flex-col gap-3 sm:gap-4">
          {main.length > 0 && (
            <ul className="grid gap-3 sm:grid-cols-2 sm:gap-4">
              {main.map((card, index) => {
                // A lone tile — the only main gallery, or the odd one out at
                // the end of a row — takes the full width at 2:1 rather than
                // leaving half the row empty beside it.
                const wide = index === main.length - 1 && main.length % 2 === 1;
                return (
                  <li key={card.id} className={wide ? "sm:col-span-2" : undefined}>
                    <Link
                      href={hrefFor(card)}
                      className={`group relative block overflow-hidden rounded-xl bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 dark:bg-neutral-900 ${
                        wide ? "aspect-[4/3] sm:aspect-[2/1]" : "aspect-[4/3] sm:aspect-[3/2]"
                      }`}
                      style={
                        card.cover?.placeholder
                          ? { backgroundColor: card.cover.placeholder }
                          : undefined
                      }
                    >
                      {card.cover && (
                        <Image
                          src={srcFor(card.cover.objectKey, grants.get(card.id) ?? null)}
                          alt=""
                          fill
                          sizes={
                            wide
                              ? "(max-width: 1024px) 100vw, 992px"
                              : "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 488px"
                          }
                          className="duration-toggle ease-standard object-cover transition-transform group-hover:scale-[1.02]"
                        />
                      )}
                      {/* Scrim under the caption. Brand ink rather than black so
                          the photo keeps its warmth where the gradient bites. */}
                      <div
                        aria-hidden
                        className="from-brand-ink/75 via-brand-ink/25 pointer-events-none absolute inset-0 bg-gradient-to-t to-transparent"
                      />
                      <div
                        className={`absolute inset-x-0 bottom-0 ${wide ? "p-5 sm:p-6" : "p-4 sm:p-5"}`}
                      >
                        <p
                          className={`font-semibold text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.25)] ${
                            wide ? "text-title sm:text-2xl" : "text-title"
                          }`}
                        >
                          {card.title}
                        </p>
                        <p className="text-caption mt-0.5 text-white/80">{metaFor(card)}</p>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}

          {guest.length > 0 && (
            <ul className="flex flex-col gap-3">
              {guest.map((card) => (
                <li key={card.id}>
                  <Link
                    href={hrefFor(card)}
                    className="duration-flip flex items-center gap-4 rounded-xl border p-3 transition-colors hover:border-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-2 dark:hover:border-neutral-600"
                  >
                    <div
                      className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-neutral-100 dark:bg-neutral-900"
                      style={
                        card.cover?.placeholder
                          ? { backgroundColor: card.cover.placeholder }
                          : undefined
                      }
                    >
                      {card.cover && (
                        <Image
                          src={srcFor(card.cover.objectKey, grants.get(card.id) ?? null)}
                          alt=""
                          fill
                          sizes="80px"
                          className="object-cover"
                        />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-lead font-medium">{card.title}</p>
                      <p className="text-caption text-brand-ink/60 dark:text-brand-tint/60">
                        {metaFor(card)}
                      </p>
                      <p className="text-caption text-brand-primary dark:text-brand-border mt-1 flex items-center gap-1.5">
                        <CameraIcon className="h-4 w-4 shrink-0" />
                        <span>{t("guestCardHint")}</span>
                      </p>
                    </div>
                    <ChevronRightIcon className="text-brand-ink/45 dark:text-brand-tint/45 h-5 w-5 shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <footer className="text-caption text-brand-ink/60 dark:text-brand-tint/60 mt-10 border-t pt-4">
        <SiteFooterIdentity />
      </footer>
    </main>
  );
}
