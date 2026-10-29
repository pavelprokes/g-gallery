"use client";

import { useEffect, useRef, useState } from "react";
import {
  listen,
  listenSources,
  NoTabAudioError,
  type Listening,
  type ListenSource,
} from "@/lib/reels/listen";
import {
  parseClock,
  playerCommand,
  YOUTUBE_PLAYER_ORIGIN,
  youtubeEmbedUrl,
  youtubeId,
} from "@/lib/reels/youtube";
import { formatDuration } from "@/lib/video";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** Fewer seconds than this rarely hold a tempo worth trusting. */
const MIN_SECONDS = 10;
/** How long a YouTube song is listened to before the page stops on its own —
 * a 30 s reel and room to choose its loudest stretch. */
const LISTEN_CHOICES = [30, 45, 60, 90] as const;

const clock = (seconds: number) => formatDuration(seconds * 1000);

/**
 * The song listened to rather than added as a file (docs/REELS.md §2): from a
 * YouTube player on this page, any other tab, or the microphone. What is
 * heard gives the beat, and — for a tab — can be the reel's sound as well.
 */
export function ListenPanel({
  disabled,
  onHeard,
}: {
  disabled: boolean;
  onHeard(
    blob: Blob,
    name: string,
    source: ListenSource,
    details: { origin?: string; startAt?: number },
  ): Promise<void>;
}) {
  // What the browser offers is only known in the browser.
  const [sources, setSources] = useState({ mic: false, tab: false });
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- capabilities exist only client-side
    setSources(listenSources());
  }, []);

  const [link, setLink] = useState("");
  const [from, setFrom] = useState("");
  const [listenFor, setListenFor] = useState<(typeof LISTEN_CHOICES)[number]>(45);
  const player = useRef<HTMLIFrameElement>(null);
  const [pageOrigin, setPageOrigin] = useState<string | undefined>(undefined);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the origin exists only client-side
    setPageOrigin(window.location.origin);
  }, []);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [linkError, setLinkError] = useState(false);
  const [state, setState] = useState<{ source: ListenSource; since: number } | null>(null);
  // Between the click and the browser's answer (a permission prompt, the
  // share picker): a second click must not start a second recorder.
  const [starting, setStarting] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const listening = useRef<Listening | null>(null);
  // The same as `state`, for the end the browser reports (sharing stopped, the
  // time limit) — that callback was made before `state` was set. `startAt` is
  // where the YouTube player was sent.
  const started = useRef<{ source: ListenSource; since: number; startAt?: number } | null>(null);

  useEffect(() => {
    if (!state) return;
    const timer = setInterval(() => setElapsed((Date.now() - state.since) / 1000), 250);
    return () => clearInterval(timer);
  }, [state]);
  const autoStop = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Leaving the page drops a listening in progress, its timer with it.
  useEffect(
    () => () => {
      clearTimeout(autoStop.current ?? undefined);
      listening.current?.cancel();
    },
    [],
  );

  /** Tells the YouTube player on the page what to do (its IFrame API). */
  const command = (...message: Parameters<typeof playerCommand>) => {
    player.current?.contentWindow?.postMessage(playerCommand(...message), YOUTUBE_PLAYER_ORIGIN);
  };

  const showVideo = () => {
    const id = youtubeId(link);
    setLinkError(id === null);
    setVideoId(id);
  };

  /** Ends the listening without keeping it: recorder, timer and player. */
  const cancel = () => {
    clearTimeout(autoStop.current ?? undefined);
    autoStop.current = null;
    if (started.current?.startAt !== undefined) command("pauseVideo");
    listening.current?.cancel();
    listening.current = null;
    started.current = null;
    setState(null);
  };

  const finish = async () => {
    clearTimeout(autoStop.current ?? undefined);
    autoStop.current = null;
    if (started.current?.startAt !== undefined) command("pauseVideo");
    const current = listening.current;
    const was = started.current;
    listening.current = null;
    started.current = null;
    setState(null);
    if (!current || !was) return;
    const seconds = (Date.now() - was.since) / 1000;
    const blob = await current.stop();
    if (seconds < MIN_SECONDS) {
      setError(`Poslouchej aspoň ${MIN_SECONDS} sekund — líp 30 až 60.`);
      return;
    }
    const when = new Date().toLocaleString("cs", {
      day: "numeric",
      month: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    const name =
      was.source === "tab" && videoId
        ? `Poslech z YouTube (${videoId})`
        : was.source === "tab"
          ? `Poslech karty · ${when}`
          : `Poslech mikrofonem · ${when}`;
    await onHeard(blob, name, was.source, {
      origin: was.startAt !== undefined && videoId ? `https://youtu.be/${videoId}` : undefined,
      startAt: was.startAt,
    });
  };

  const start = async (source: ListenSource) => {
    if (starting || listening.current) return;
    setError(null);
    setStarting(true);
    try {
      listening.current = await listen(source, () => void finish());
      setElapsed(0);
      const youtube = source === "tab" && videoId !== null;
      const startAt = youtube ? (parseClock(from) ?? 0) : undefined;
      started.current = { source, since: Date.now(), startAt };
      setState(started.current);
      if (youtube) {
        // The player starts once the page hears the tab, from the chosen
        // second, and the listening stops on its own.
        command("seekTo", [startAt, true]);
        command("playVideo");
        autoStop.current = setTimeout(() => void finish(), listenFor * 1000);
      }
    } catch (cause) {
      listening.current = null;
      if (cause instanceof NoTabAudioError) {
        setError("Ve sdílení chyběl zvuk. Vyber znovu kartu a zapni „Sdílet i zvuk karty“.");
      } else if (cause instanceof DOMException && cause.name === "NotAllowedError") {
        setError(
          source === "mic"
            ? "Prohlížeč nedovolil mikrofon. Povol ho u adresy stránky a zkus to znovu."
            : "Sdílení bylo zrušené.",
        );
      } else {
        console.warn("[g-gallery/reels] listening failed", cause);
        setError("Poslech se nepodařilo spustit.");
      }
    } finally {
      setStarting(false);
    }
  };

  if (!sources.mic && !sources.tab) return null;

  return (
    // Opened by the photographer, it stays open when a listening ends — React
    // owning `open` would close it the moment the listening's state cleared.
    <details
      className="mt-4"
      open={expanded || state !== null}
      onToggle={(e) => setExpanded(e.currentTarget.open)}
    >
      <summary className="cursor-pointer py-3 text-sm font-semibold">
        Nebo písničku poslechnout (YouTube, Instagram, reproduktor)
      </summary>
      <div className="mt-3 space-y-3 text-sm">
        <p className="text-admin-muted text-caption dark:text-neutral-400">
          Stránka písničku poslechne, najde rytmus a střihy na něj nastaví. Poslech karty může jít
          do videa i jako zvuk; z YouTube nic nestahuje — jen slyší, co karta hraje.
        </p>

        {sources.tab && (
          <div className="space-y-2">
            <label className="block">
              <span className="text-caption font-semibold">Odkaz na YouTube (nepovinné)</span>
              <span className="mt-1 flex gap-2">
                <input
                  type="url"
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && showVideo()}
                  placeholder="https://youtu.be/…"
                  className="border-admin-border min-h-11 min-w-0 flex-1 rounded-lg border px-3 text-base sm:text-sm dark:border-neutral-700 dark:bg-neutral-900"
                />
                <Button variant="secondary" onClick={showVideo} disabled={!link.trim()}>
                  Zobrazit
                </Button>
              </span>
            </label>
            {linkError && (
              <p className="text-admin-danger text-caption">Tohle není odkaz na video z YouTube.</p>
            )}
            {videoId && (
              <div className="flex flex-wrap gap-3">
                <label className="text-caption">
                  <span className="font-semibold">Začít od</span>
                  <input
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                    placeholder="0:00"
                    inputMode="numeric"
                    aria-invalid={from.trim() !== "" && parseClock(from) === null}
                    className="border-admin-border mt-1 block min-h-11 w-24 rounded-lg border px-3 text-base aria-invalid:border-red-500 sm:text-sm dark:border-neutral-700 dark:bg-neutral-900"
                  />
                </label>
                <label className="text-caption">
                  <span className="font-semibold">Poslouchat</span>
                  <select
                    value={listenFor}
                    onChange={(e) =>
                      setListenFor(Number(e.target.value) as (typeof LISTEN_CHOICES)[number])
                    }
                    className="border-admin-border mt-1 block min-h-11 rounded-lg border px-3 text-base sm:text-sm dark:border-neutral-700 dark:bg-neutral-900"
                  >
                    {LISTEN_CHOICES.map((s) => (
                      <option key={s} value={s}>
                        {s} s
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            {videoId && (
              <iframe
                ref={player}
                src={youtubeEmbedUrl(videoId, pageOrigin)}
                title="Přehrávač YouTube"
                allow="autoplay; encrypted-media; picture-in-picture"
                referrerPolicy="strict-origin-when-cross-origin"
                className="aspect-video w-full rounded"
              />
            )}
          </div>
        )}

        {state ? (
          <div
            className="bg-admin-accent-soft space-y-2 rounded-lg p-3 dark:bg-neutral-800"
            role="status"
          >
            <p className="font-semibold tabular-nums">Poslouchám… {clock(elapsed)}</p>
            <p className="text-caption">
              {state.source === "tab" && videoId
                ? `Video z YouTube se pustí samo a poslech skončí po ${listenFor} s. Když se nepustí, klikni na Přehrát v přehrávači.`
                : state.source === "tab"
                  ? "Pusť písničku od místa, kde má video začít. Stačí 30–60 sekund."
                  : "Pusť písničku nahlas poblíž mikrofonu, od místa, kde má video začít. Stačí 30–60 sekund."}
            </p>
            <div className="flex gap-2">
              <Button onClick={() => void finish()}>Hotovo</Button>
              <Button variant="secondary" onClick={cancel}>
                Zrušit
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {sources.tab && (
              <Button
                variant="secondary"
                disabled={disabled || starting}
                onClick={() => void start("tab")}
              >
                Poslouchat kartu
              </Button>
            )}
            {sources.mic && (
              <Button
                variant="secondary"
                disabled={disabled || starting}
                onClick={() => void start("mic")}
              >
                Poslouchat mikrofonem
              </Button>
            )}
          </div>
        )}
        {sources.tab && !state && (
          <p className="text-admin-muted text-caption dark:text-neutral-400">
            „Poslouchat kartu“: v okně sdílení vyber <strong>tuto kartu</strong> (nebo kartu s
            písničkou) a zapni <strong>Sdílet i zvuk karty</strong>.
            {videoId ? " Video z YouTube se pak pustí samo." : " Pak pusť písničku."}
          </p>
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
