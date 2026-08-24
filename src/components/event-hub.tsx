import { getLocale, getTranslations } from "next-intl/server";
import Image from "next/image";
import Link from "next/link";
import { LocaleSwitcher } from "@/components/locale-switcher";
import type { ResolvedEvent } from "@/lib/event-access";
import { mintImageGrant } from "@/lib/shared-gallery";
import { srcFor } from "@/lib/image-src";

/**
 * The wedding page's rozcestník (docs/GUEST-GALLERIES.md §2).
 *
 * The identity — couple, date, venue — sits in the header once. Cards carry
 * only what tells them apart: naming each card with the full
 * "12. 8. 2026 Pavel a Patricie, Statek Benice — …" stacks three near-identical
 * paragraphs on a phone with the distinguishing word at the end of each.
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
  const grants = await Promise.all(event.cards.map((card) => mintImageGrant(card.storagePrefix)));
  const locale = await getLocale();
  const t = await getTranslations("gallery");

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <div className="mb-4 flex justify-end">
        <LocaleSwitcher />
      </div>
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">{event.title}</h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          {[event.eventDate?.toLocaleDateString(locale === "en" ? "en-US" : "cs-CZ"), event.venue]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </header>

      {event.cards.length === 0 ? (
        <p className="mt-10 text-sm text-neutral-500">{t("emptyEvent")}</p>
      ) : (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {event.cards.map((card, index) => (
            <li key={card.id}>
              <Link
                href={`/s/${encodeURIComponent(eventToken)}/${event.slug}/${card.eventKey}`}
                className="group block overflow-hidden rounded-xl border transition hover:border-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-2 dark:hover:border-neutral-600"
              >
                <div
                  className="relative aspect-[4/3] bg-neutral-100 dark:bg-neutral-900"
                  style={
                    card.cover?.placeholder
                      ? { backgroundColor: card.cover.placeholder }
                      : undefined
                  }
                >
                  {card.cover && (
                    <Image
                      src={srcFor(card.cover.objectKey, grants[index] ?? null)}
                      alt=""
                      fill
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 340px"
                      className="object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                    />
                  )}
                </div>
                <div className="p-4">
                  <p className="font-medium">{card.title}</p>
                  <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                    {card.photoCount > 0
                      ? t("photoCount", { count: card.photoCount })
                      : t("emptyCard")}
                    {card.latestPhotoAt &&
                      ` · ${card.latestPhotoAt.toLocaleDateString(locale === "en" ? "en-US" : "cs-CZ")}`}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
