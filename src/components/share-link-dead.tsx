import { useTranslations } from "next-intl";
import Link from "next/link";
import { ContactLine, DeadEnd } from "@/components/dead-end";
import { buttonClasses } from "@/components/ui/button";

/**
 * A share link that resolved but is no longer open: expired, or revoked.
 *
 * Both read identically on purpose. Telling them apart would say whether the
 * photographer cut somebody off deliberately, which is nobody else's business.
 */
export function ShareLinkDead() {
  const t = useTranslations("errors");
  return (
    <DeadEnd
      title={t("shareLinkDeadTitle")}
      lead={t("shareLinkDeadLead")}
      hint={t("shareLinkDeadHint")}
      action={<ContactLine />}
    />
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
    <DeadEnd
      title={t("eventPartGoneTitle")}
      lead={t("eventPartGoneLead")}
      action={
        <Link href={backHref} className={buttonClasses()}>
          ← {eventTitle}
        </Link>
      }
    />
  );
}
