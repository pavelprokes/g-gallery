import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { formatDateTime } from "@/lib/format-date";
import { getAdminSession } from "@/lib/auth-guard";
import { ownerFeed, markFeedRead, type FeedEntry } from "@/lib/feed";
import { REACTION_EMOJI } from "@/lib/reactions-shared";
import { PushToggle } from "@/components/push-toggle";
import { Card, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { updatesCrumbs } from "@/lib/admin-breadcrumbs";
import { FeedReadSync } from "@/components/admin/feed-read-sync";

export const dynamic = "force-dynamic";

/**
 * The owner's Updates feed. Opening the page marks it read — the same
 * behaviour as Google Photos' activity view, and the reason the badge exists
 * at all (docs/PLAN.md §8).
 */
export default async function UpdatesPage() {
  const session = await getAdminSession();
  if (!session) redirect("/sign-in?next=/admin/updates");

  // Read the feed BEFORE marking it read, or the "new" divider would never
  // have anything below it on the very visit that clears the badge.
  const entries = await ownerFeed(session.user.id);
  await markFeedRead(session.user.id);

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Aktivita" crumbs={updatesCrumbs()} />
      <FeedReadSync />

      <Card>
        <CardTitle>Upozornění na návštěvu</CardTitle>
        <p className="text-admin-muted mb-3 text-sm dark:text-neutral-400">
          Nejvýš jedno za 30 minut na galerii. Denní souhrn chodí e-mailem vždy.
        </p>
        <PushToggle />
      </Card>

      {entries.length === 0 ? (
        <p className="text-admin-muted text-sm dark:text-neutral-400">
          Zatím žádná aktivita. Objeví se tu reakce, oblíbené fotky a stažení — ne samotná
          zobrazení, těch by byly stovky.
        </p>
      ) : (
        <Card as="ul" className="divide-admin-border divide-y p-0 sm:p-0 dark:divide-neutral-800">
          {entries.map((entry) => (
            <FeedRow key={entry.id} entry={entry} />
          ))}
        </Card>
      )}
    </div>
  );
}

function FeedRow({ entry }: { entry: FeedEntry }) {
  return (
    <li className="flex items-center gap-3 p-3">
      <span aria-hidden className="text-lg">
        {iconFor(entry)}
      </span>

      {entry.photoObjectKey && (
        <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded bg-neutral-100 dark:bg-neutral-900">
          <Image src={entry.photoObjectKey} alt="" fill sizes="40px" className="object-cover" />
        </span>
      )}

      <span className="min-w-0 flex-1 text-sm">
        <Link href={`/admin/g/${entry.galleryId}`} className="hover:underline">
          {describe(entry)}
        </Link>
        <span className="text-admin-muted block text-xs dark:text-neutral-400">
          {entry.galleryTitle} · {formatWhen(entry.createdAt)}
        </span>
      </span>
    </li>
  );
}

function iconFor(entry: FeedEntry): string {
  switch (entry.type) {
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
function describe(entry: FeedEntry): string {
  const who = entry.viewerName ?? "Někdo";
  switch (entry.type) {
    case "REACTION":
      return `${who} zareagoval na fotku`;
    case "FAVORITE":
      return `${who} přidal fotku do oblíbených`;
    case "DOWNLOAD":
      return `${who} stáhl fotku`;
    case "VISITOR_IDENTIFIED":
      return `${who} se představil`;
    default:
      return `${who} byl v galerii`;
  }
}

function formatWhen(date: Date): string {
  return formatDateTime(date, "cs");
}
