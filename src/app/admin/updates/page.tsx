import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { formatDate, formatDateTime, formatTime, previousDay } from "@/lib/format-date";
import { getAdminSession } from "@/lib/auth-guard";
import { ownerFeed, markFeedRead, type FeedCursor } from "@/lib/feed";
import { groupFeed, type FeedGroup } from "@/lib/feed-group";
import { FORMS, pluralize } from "@/lib/czech-plural";
import { REACTION_EMOJI } from "@/lib/reactions-shared";
import { PushToggle } from "@/components/push-toggle";
import { Card, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { buttonClasses } from "@/components/ui/button";
import { updatesCrumbs } from "@/lib/admin-breadcrumbs";
import { FeedReadSync } from "@/components/admin/feed-read-sync";

export const dynamic = "force-dynamic";

/** `?before=<ISO time>_<event id>` — the page after the one that ended there. */
const cursorSchema = z
  .string()
  .max(120)
  .transform((value, ctx): FeedCursor => {
    const cut = value.lastIndexOf("_");
    const createdAt = new Date(value.slice(0, cut));
    const id = value.slice(cut + 1);
    if (cut < 1 || Number.isNaN(createdAt.getTime()) || !id) {
      ctx.addIssue({ code: "custom", message: "bad cursor" });
      return z.NEVER;
    }
    return { createdAt, id };
  });

/**
 * The owner's Updates feed. Opening the page marks it read — the same
 * behaviour as Google Photos' activity view, and the reason the badge exists
 * at all (docs/PLAN.md §8). Rows are grouped (twenty downloads in a sitting
 * are one row) and paged by cursor, newest first.
 */
export default async function UpdatesPage(props: PageProps<"/admin/updates">) {
  const session = await getAdminSession();
  if (!session) redirect("/sign-in?next=/admin/updates");

  const { before } = await props.searchParams;
  const cursor = cursorSchema.safeParse(before);
  const olderPage = cursor.success;

  // Read the feed BEFORE marking it read, or the "new" divider would never
  // have anything below it on the very visit that clears the badge.
  const { entries, next } = await ownerFeed(session.user.id, cursor.data);
  if (!olderPage) await markFeedRead(session.user.id);
  const days = byDay(groupFeed(entries));

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Aktivita" crumbs={updatesCrumbs()} />
      {!olderPage && <FeedReadSync />}

      {!olderPage && (
        <Card>
          <CardTitle>Upozornění na návštěvu</CardTitle>
          <p className="text-admin-muted mb-3 text-sm dark:text-neutral-400">
            Nejvýš jedno za 30 minut na galerii. Denní souhrn chodí e-mailem vždy.
          </p>
          <PushToggle />
        </Card>
      )}

      {days.length === 0 ? (
        <p className="text-admin-muted text-sm dark:text-neutral-400">
          {olderPage
            ? "Starší aktivita už není."
            : "Zatím žádná aktivita. Objeví se tu reakce, oblíbené fotky a stažení — ne samotná zobrazení, těch by byly stovky."}
        </p>
      ) : (
        days.map(([day, groups], index) => (
          // An index id: a date label has spaces, which an IDREF cannot hold.
          <section key={day} aria-labelledby={`day-${index}`}>
            <h2
              id={`day-${index}`}
              className="text-admin-muted mb-2 text-xs font-semibold tracking-wide uppercase"
            >
              {day}
            </h2>
            <Card as="ul" flush className="divide-admin-border divide-y dark:divide-neutral-800">
              {groups.map((group) => (
                <FeedRow key={group.id} group={group} />
              ))}
            </Card>
          </section>
        ))
      )}

      {next && (
        <Link
          href={`?before=${encodeURIComponent(`${next.createdAt.toISOString()}_${next.id}`)}`}
          className={buttonClasses("secondary", "lg")}
        >
          Načíst starší
        </Link>
      )}
      {olderPage && (
        <Link
          href="/admin/updates"
          className="text-brand-primary-dark ml-3 text-sm font-semibold underline underline-offset-4"
        >
          Zpět na nejnovější
        </Link>
      )}
    </div>
  );
}

/** "Dnes", "Včera", or the date — in Prague time, like every date here. */
function byDay(groups: FeedGroup[]): [string, FeedGroup[]][] {
  const now = new Date();
  const today = formatDate(now, "cs");
  const yesterday = formatDate(previousDay(now), "cs");
  const days = new Map<string, FeedGroup[]>();
  for (const group of groups) {
    const date = formatDate(group.latest, "cs");
    const label = date === today ? "Dnes" : date === yesterday ? "Včera" : date;
    const day = days.get(label);
    if (day) day.push(group);
    else days.set(label, [group]);
  }
  return [...days];
}

function FeedRow({ group }: { group: FeedGroup }) {
  return (
    <li className="flex items-start gap-3 p-3">
      <span aria-hidden className="w-5 shrink-0 pt-0.5 text-center text-lg">
        {iconFor(group)}
      </span>

      <span className="min-w-0 flex-1 text-sm">
        <Link href={`/admin/g/${group.galleryId}`} className="hover:underline">
          {describe(group)}
        </Link>
        <span className="text-admin-muted block text-xs dark:text-neutral-400">
          {group.galleryTitle} · {when(group)}
        </span>
        {group.photos.length > 0 && (
          <span className="mt-2 flex gap-1.5">
            {group.photos.map((key) => (
              <span
                key={key}
                className="relative size-10 shrink-0 overflow-hidden rounded bg-neutral-100 dark:bg-neutral-900"
              >
                <Image src={key} alt="" fill sizes="40px" className="object-cover" />
              </span>
            ))}
            {group.photoCount > group.photos.length && (
              <span className="text-admin-muted self-center text-xs">
                +{group.photoCount - group.photos.length}
              </span>
            )}
          </span>
        )}
      </span>
    </li>
  );
}

function iconFor(group: FeedGroup): string {
  switch (group.type) {
    case "REACTION":
      // The kind is not on the event, so the generic face stands in.
      return REACTION_EMOJI.WOW;
    case "FAVORITE":
      return "♥";
    case "DOWNLOAD":
      return "⤓";
    default:
      return "👋";
  }
}

/** Viewers who never entered a name stay anonymous, by design. */
function describe(group: FeedGroup): string {
  const who = group.viewerName ?? "Někdo";
  const photos = pluralize(group.photoCount, FORMS.photoAccusative);
  const many = group.photoCount > 1;
  switch (group.type) {
    case "REACTION":
      return many ? `${who} zareagoval na ${photos}` : `${who} zareagoval na fotku`;
    case "FAVORITE":
      return many ? `${who} přidal ${photos} do oblíbených` : `${who} přidal fotku do oblíbených`;
    case "DOWNLOAD":
      // The archive route records neither who nor how many photos (one photo
      // or the whole gallery), so the row claims only that it happened.
      return group.events > 1 ? `Stažení z galerie · ${group.events}×` : "Stažení z galerie";
    case "VISITOR_IDENTIFIED":
      return `${who} se představil`;
    default:
      return `${who} byl v galerii`;
  }
}

/** "27. 9. 2026 9:14", or "9:08–9:14" for a run within one day. */
function when(group: FeedGroup): string {
  if (group.events === 1) return formatDateTime(group.latest, "cs");
  const sameDay = formatDate(group.earliest, "cs") === formatDate(group.latest, "cs");
  return sameDay
    ? `${formatTime(group.earliest, "cs")}–${formatTime(group.latest, "cs")}`
    : `${formatDateTime(group.earliest, "cs")} – ${formatDateTime(group.latest, "cs")}`;
}
