"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import {
  channelForGallery,
  distinctViewers,
  realtimeConfig,
  type PresenceState,
} from "@/lib/realtime-channel";
import { getViewerId, getViewerName } from "@/lib/viewer-id";

/**
 * "Someone is viewing now", over Supabase Realtime Presence.
 *
 * Realtime deliberately does NOT run on Vercel: a function billed for
 * provisioned memory would be charged for the entire open connection and would
 * be killed at maxDuration anyway (CLAUDE.md invariant #6).
 *
 * Renders nothing at all when Supabase is unconfigured, when the viewer opted
 * out, or when nobody else is here — an empty strip that says "0 viewers" is
 * worse than no strip.
 */
export function PresenceStrip({ galleryId, optedOut }: { galleryId: string; optedOut: boolean }) {
  const t = useTranslations("presence");
  const locale = useLocale();
  const [others, setOthers] = useState<{ count: number; names: string[] }>({
    count: 0,
    names: [],
  });

  useEffect(() => {
    const config = realtimeConfig();
    // Opted-out viewers are not broadcast and do not subscribe: presence is
    // still a form of being counted (docs/PLAN.md §8, GDPR).
    if (!config || optedOut) return;

    const viewerKey = getViewerId();
    if (!viewerKey) return;

    let cancelled = false;
    let cleanup: (() => void) | undefined;

    void (async () => {
      // Imported lazily so the Realtime client is only downloaded by viewers
      // of a gallery, never by the admin or the sign-in page.
      const { createClient } = await import("@supabase/supabase-js");
      const topic = await channelForGallery(galleryId);
      // No topic means no secure context, so no presence — see
      // channelForGallery. Everything else on the page carries on.
      if (cancelled || !topic) return;

      const client = createClient(config.url, config.anonKey, {
        realtime: { params: { eventsPerSecond: 1 } },
      });

      const channel = client.channel(topic, {
        config: { presence: { key: viewerKey } },
      });

      channel
        .on("presence", { event: "sync" }, () => {
          const state = channel.presenceState<PresenceState>();
          const all = distinctViewers(state as Record<string, PresenceState[]>);
          // "Others", not "everyone" — nobody needs telling they are here.
          setOthers({
            count: Math.max(0, all.count - 1),
            names: all.names.filter((name) => name !== getViewerName()),
          });
        })
        .subscribe((status) => {
          // track() is rate limited to 5 calls / 30s, so it happens once, on
          // join, and never on re-render.
          if (status === "SUBSCRIBED") {
            void channel.track({ name: getViewerName(), viewerKey } satisfies PresenceState);
          }
        });

      cleanup = () => {
        void channel.unsubscribe();
        void client.removeAllChannels();
      };
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [galleryId, optedOut]);

  if (others.count === 0) return null;

  const label = presenceLabel(others, locale, t);

  return (
    <span
      title={label}
      className="flex max-w-64 min-w-0 items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
    >
      {/* The ping is decoration (the words already say someone is here), so it
          has no `.motion-loop`: under reduced motion it stops, the dot stays. */}
      <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
      </span>
      <span className="min-w-0 truncate">{label}</span>
    </span>
  );
}

/** At most this many names; everyone past them is "and N others". */
const MAX_NAMES = 3;

/**
 * "Jana, Petr a další 2 se dívají". Names joined the locale's way
 * (`Intl.ListFormat`, "a" / "and" / "et" …, with the serial comma where the
 * language uses one), and the overflow counted from the real total — the
 * viewers who never gave a name included — rather than from the names alone,
 * which used to say "Jana se dívá" with five people watching.
 */
export function presenceLabel(
  others: { count: number; names: string[] },
  locale: string,
  t: (
    key: "named" | "others" | "someone" | "count",
    values?: Record<string, string | number>,
  ) => string,
): string {
  if (others.names.length === 0) {
    return others.count === 1 ? t("someone") : t("count", { count: others.count });
  }
  const shown = others.names.slice(0, MAX_NAMES);
  const overflow = Math.max(0, others.count - shown.length);
  const parts = overflow > 0 ? [...shown, t("others", { count: overflow })] : shown;
  const names = new Intl.ListFormat(locale, { type: "conjunction" }).format(parts);
  return t("named", { names, count: shown.length + overflow });
}
