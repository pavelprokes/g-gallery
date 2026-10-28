"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { disconnectInstagram, searchInstagramAudio } from "@/app/admin/instagram-actions";
import type { InstagramStatus } from "@/lib/instagram/connection";
import type { AudioKind, InstagramAudio } from "@/lib/instagram/graph";
import { formatDuration } from "@/lib/video";
import { Alert } from "@/components/ui/alert";
import { Button, buttonClasses } from "@/components/ui/button";

export interface InstagramState {
  /** META_APP_ID and META_APP_SECRET are set. */
  configured: boolean;
  account: InstagramStatus | null;
  /** What the sign-in just did, from the callback's `?instagram=`. */
  outcome: string | null;
}

const OUTCOME: Record<string, { tone: "success" | "warning"; text: string }> = {
  connected: { tone: "success", text: "Instagram je připojený." },
  denied: { tone: "warning", text: "Přihlášení k Facebooku bylo zrušené." },
  "bad-state": {
    tone: "warning",
    text: "Přihlášení vypršelo nebo nepřišlo z této stránky. Zkus to znovu.",
  },
  "bad-request": { tone: "warning", text: "Facebook vrátil neúplnou odpověď. Zkus to znovu." },
  "no-instagram": {
    tone: "warning",
    text: "Na žádné tvé facebookové stránce není připojený firemní Instagram (docs/INSTAGRAM-AUDIO.md, kroky 2–3).",
  },
  "token-rejected": {
    tone: "warning",
    text: "Instagram nepřijal přístup od Facebooku — chybí některé oprávnění. Při přihlášení povol všechno, co aplikace žádá.",
  },
  "no-cipher": {
    tone: "warning",
    text: "Chybí TOKEN_ENCRYPTION_KEY — tokeny by se nedaly bezpečně uložit.",
  },
  "not-configured": {
    tone: "warning",
    text: "Chybí META_APP_ID nebo META_APP_SECRET ve Vercelu.",
  },
  graph: { tone: "warning", text: "Meta při připojování vrátila chybu. Zkus to znovu za chvíli." },
};

const length = (ms: number | null) => (ms ? formatDuration(ms) : null);

/**
 * Instagram's own music for a reel (docs/INSTAGRAM-AUDIO.md): search the
 * catalogue Meta offers to the connected account and take a track's sound —
 * for its beat, and into the video if the photographer wants it there.
 */
export function InstagramMusic({
  state,
  returnTo,
  disabled,
  onPicked,
}: {
  state: InstagramState;
  /** This page with its galleries — where the sign-in brings the photographer back. */
  returnTo: string;
  disabled: boolean;
  onPicked(blob: Blob, name: string, audioId: string, durationMs: number | null): Promise<void>;
}) {
  const [kind, setKind] = useState<AudioKind>("music");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<InstagramAudio[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();
  const [taking, setTaking] = useState<string | null>(null);
  // One song heard at a time, straight from Meta's address — an <audio> needs
  // no CORS, and nothing is kept until "Použít".
  const player = useRef<HTMLAudioElement | null>(null);
  const [hearing, setHearing] = useState<string | null>(null);
  const stopHearing = () => {
    player.current?.pause();
    setHearing(null);
  };
  useEffect(() => () => player.current?.pause(), []);
  const hear = (item: InstagramAudio) => {
    if (hearing === item.audioId) return stopHearing();
    if (!item.downloadUrl) return;
    player.current ??= new Audio();
    const audio = player.current;
    audio.onended = () => setHearing(null);
    audio.onerror = () => {
      setHearing(null);
      setError("Ukázku se nepodařilo přehrát.");
    };
    audio.src = item.downloadUrl;
    setError(null);
    setHearing(item.audioId);
    void audio.play().catch(() => setHearing(null));
  };
  // The sign-in's outcome is said once: kept here, taken off the address so a
  // reload or a later disconnect does not repeat it.
  const [outcomeKey, setOutcomeKey] = useState(state.outcome);
  useEffect(() => {
    if (!state.outcome) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("instagram");
    window.history.replaceState(window.history.state, "", url);
  }, [state.outcome]);
  const outcome = outcomeKey ? OUTCOME[outcomeKey] : null;
  // Open on arrival from the sign-in, then the photographer's to open and close.
  const [expanded, setExpanded] = useState(state.outcome !== null);

  const search = () =>
    startSearch(async () => {
      stopHearing();
      setError(null);
      const result = await searchInstagramAudio({ kind, query });
      if (result.ok) setItems(result.items);
      else setError(result.error);
    });

  const take = async (item: InstagramAudio) => {
    if (!item.downloadUrl) return;
    stopHearing();
    setError(null);
    setTaking(item.audioId);
    try {
      const response = await fetch(item.downloadUrl, { mode: "cors", credentials: "omit" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const name = [item.title, item.artist].filter(Boolean).join(" · ");
      await onPicked(await response.blob(), name, item.audioId, item.durationMs);
    } catch (cause) {
      console.warn("[g-gallery/instagram] audio fetch failed", cause);
      setError(
        "Skladbu se nepodařilo stáhnout do prohlížeče — Meta ji nejspíš nepouští přímo (docs/INSTAGRAM-AUDIO.md, otázka U3).",
      );
    } finally {
      setTaking(null);
    }
  };

  return (
    <details className="mt-4" open={expanded} onToggle={(e) => setExpanded(e.currentTarget.open)}>
      <summary className="cursor-pointer text-sm font-semibold">Hudba z Instagramu</summary>
      <div className="mt-3 space-y-3 text-sm">
        {outcome && (
          <Alert tone={outcome.tone} compact>
            {outcome.text}
          </Alert>
        )}
        {!state.configured ? (
          <p className="text-admin-muted text-caption dark:text-neutral-400">
            Napojení na Instagram ještě není nastavené — chybí aplikace u Mety a její klíče ve
            Vercelu (docs/INSTAGRAM-AUDIO.md).
          </p>
        ) : !state.account ? (
          <div className="space-y-2">
            <p className="text-admin-muted text-caption dark:text-neutral-400">
              Po připojení vybereš hudbu přímo z knihovny Instagramu: střihy se nastaví na její
              rytmus a video vznikne se zvukem, nebo bez — jak zvolíš. Nic se odsud nepublikuje.
            </p>
            {/* A link, not a button: the sign-in is a full-page trip to Facebook. */}
            <a
              href={`/api/instagram/connect?next=${encodeURIComponent(returnTo)}`}
              className={buttonClasses("secondary", "md")}
            >
              Připojit Instagram
            </a>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p>
                <strong>@{state.account.username}</strong>{" "}
                <span className="text-admin-muted dark:text-neutral-400">
                  · {state.account.pageName}
                </span>
              </p>
              <form action={disconnectInstagram} onSubmit={() => setOutcomeKey(null)}>
                <Button size="sm" variant="secondary" type="submit">
                  Odpojit Instagram
                </Button>
              </form>
            </div>
            {state.account.expiresAt && (
              <p className="text-admin-muted text-caption dark:text-neutral-400">
                Přístup platí do {new Date(state.account.expiresAt).toLocaleDateString("cs")}, pak
                se připoj znovu.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <div className="flex gap-1" role="radiogroup" aria-label="Druh zvuku">
                {(
                  [
                    ["music", "Hudba"],
                    ["original_sound", "Původní zvuky"],
                  ] as const
                ).map(([value, label]) => (
                  <Button
                    key={value}
                    size="sm"
                    role="radio"
                    aria-checked={kind === value}
                    variant={kind === value ? "primary" : "secondary"}
                    onClick={() => setKind(value)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && search()}
                placeholder="Písnička nebo interpret (prázdné = populární)"
                maxLength={100}
                aria-label="Hledat hudbu na Instagramu"
                className="border-admin-border min-h-11 min-w-0 flex-1 rounded-lg border px-3 dark:border-neutral-700 dark:bg-neutral-900"
              />
              <Button onClick={search} disabled={searching}>
                {searching ? "Hledám…" : "Hledat"}
              </Button>
            </div>
            {items && items.length === 0 && <p>Nic nenalezeno.</p>}
            {items && items.length > 0 && (
              <ul className="divide-admin-border max-h-80 divide-y overflow-y-auto dark:divide-neutral-800">
                {items.map((item) => (
                  <li key={item.audioId} className="flex items-center gap-3 py-2">
                    {item.coverUrl ? (
                      // Meta's own thumbnail, shown as Meta serves it — not one of our photos.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.coverUrl}
                        alt=""
                        className="size-11 shrink-0 rounded object-cover"
                      />
                    ) : (
                      <span className="bg-brand-tint size-11 shrink-0 rounded" aria-hidden />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{item.title}</span>
                      <span className="text-admin-muted text-caption block truncate dark:text-neutral-400">
                        {[
                          item.artist,
                          length(item.durationMs),
                          item.adsEligible === false ? "ne do reklam" : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                    {item.downloadUrl && (
                      <button
                        type="button"
                        onClick={() => hear(item)}
                        aria-pressed={hearing === item.audioId}
                        aria-label={
                          hearing === item.audioId
                            ? `Zastavit ukázku: ${item.title}`
                            : `Přehrát ukázku: ${item.title}`
                        }
                        className="border-admin-border hover:bg-admin-accent-soft grid size-11 shrink-0 place-items-center rounded-full border dark:border-neutral-700"
                      >
                        {/* Drawn, not "▶": some systems paint that as a colour emoji. */}
                        <svg viewBox="0 0 24 24" aria-hidden className="size-5 fill-current">
                          {hearing === item.audioId ? (
                            <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
                          ) : (
                            <path d="M8 5v14l11-7z" />
                          )}
                        </svg>
                      </button>
                    )}
                    {item.downloadUrl ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={disabled || taking !== null}
                        onClick={() => void take(item)}
                      >
                        {taking === item.audioId ? "Stahuji…" : "Použít"}
                      </Button>
                    ) : (
                      <span className="text-admin-muted text-caption">bez ukázky</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-admin-muted text-caption dark:text-neutral-400">
              Zvuk je ukázka, kterou Meta k písničce dává. Pokud je kratší než celá skladba, uvidíš
              to na délce u písničky v seznamu.
            </p>
          </>
        )}
        {error && (
          <Alert tone="warning" compact>
            {error}
          </Alert>
        )}
      </div>
    </details>
  );
}
