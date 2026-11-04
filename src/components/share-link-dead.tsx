import { useTranslations } from "next-intl";
import Link from "next/link";
import { ContactLine, DeadEnd } from "@/components/dead-end";
import { buttonClasses } from "@/components/ui/button";

/**
 * Tells the offline service worker (public/sw.js) that this URL no longer
 * opens a gallery. These screens answer 200 (an App Router page cannot set its
 * own status), so without a marker the worker would keep a saved gallery's
 * photos and replace its page with this one, where docs/GUEST-GALLERIES.md §2
 * expects the copy dropped. The worker looks for the literal
 * `gg-share-link-dead` in the HTML; keep the two in step. React hoists the tag
 * into `<head>`.
 */
function DeadLinkMarker() {
  return <meta name="gg-share-link-dead" content="1" />;
}

/**
 * A share link that resolved but is no longer open: expired, or revoked.
 *
 * Both read identically on purpose. Telling them apart would say whether the
 * photographer cut somebody off deliberately, which is nobody else's business.
 */
export function ShareLinkDead() {
  const t = useTranslations("errors");
  return (
    <>
      <DeadLinkMarker />
      <DeadEnd
        title={t("shareLinkDeadTitle")}
        lead={t("shareLinkDeadLead")}
        hint={t("shareLinkDeadHint")}
        action={<ContactLine />}
      />
    </>
  );
}

/**
 * One gallery on a wedding page that is no longer listed, reached from a stale
 * card or a bookmark.
 *
 * The way back is offered here and nowhere else: this visitor arrived on a URL
 * that already contains the wedding's token, so the link gives them nothing
 * they were not holding. A `/g/` link never contains it, which is why the
 * component above offers no such thing.
 */
export function EventPartGone({ backHref, eventTitle }: { backHref: string; eventTitle: string }) {
  const t = useTranslations("errors");
  return (
    <>
      <DeadLinkMarker />
      <DeadEnd
        title={t("eventPartGoneTitle")}
        lead={t("eventPartGoneLead")}
        action={
          // A wedding title may be up to 200 characters and a button does not
          // wrap: cut it to the card's width, with the full title on hover.
          <Link href={backHref} className={`${buttonClasses()} max-w-full`} title={eventTitle}>
            <span aria-hidden>←</span>
            <span className="min-w-0 truncate">{eventTitle}</span>
          </Link>
        }
      />
    </>
  );
}
