import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth-guard";
import { ownerFeed, markFeedRead, type FeedEntry } from "@/lib/feed";
import { REACTION_EMOJI } from "@/lib/reactions-shared";
import { PushToggle } from "@/components/push-toggle";
import { Card } from "@/components/ui/card";

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
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Aktivita</h1>
        <Link href="/admin" className="text-sm underline">
          Zpět na galerie
        </Link>
      </header>

      <Card>
        <p className="text-sm font-medium">Upozornění na návštěvu</p>
        <p className="mt-1 mb-3 text-xs text-neutral-500">
          Nejvýš jedno za 30 minut na galerii. Denní souhrn chodí e-mailem vždy.
        </p>
        <PushToggle />
      </Card>

      {entries.length === 0 ? (
        <p className="text-sm text-neutral-500">
          Zatím žádná aktivita. Objeví se tu reakce, oblíbené fotky a stažení — ne samotná
          zobrazení, těch by byly stovky.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {entries.map((entry) => (
            <FeedRow key={entry.id} entry={entry} />
          ))}
        </ul>
      )}
    </main>
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
        <span className="block text-xs text-neutral-500">
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
  return date.toLocaleString("cs-CZ", {
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
