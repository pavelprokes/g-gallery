"use client";

import { useTranslations } from "next-intl";
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

  const label =
    others.names.length > 0
      ? t("named", { names: others.names.slice(0, 3).join(", "), count: others.names.length })
      : others.count === 1
        ? t("someone")
        : t("count", { count: others.count });

  return (
    <span className="flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
      <span className="relative flex h-2 w-2" aria-hidden>
        <span className="motion-loop absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
      </span>
      {label}
    </span>
  );
}
