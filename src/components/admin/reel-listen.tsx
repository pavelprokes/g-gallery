"use client";

import { useEffect, useRef, useState } from "react";
import {
  listen,
  listenSources,
  NoTabAudioError,
  type Listening,
  type ListenSource,
} from "@/lib/reels/listen";
import { youtubeEmbedUrl, youtubeId } from "@/lib/reels/youtube";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** Fewer seconds than this rarely hold a tempo worth trusting. */
const MIN_SECONDS = 10;

function clock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * The song listened to rather than added as a file (docs/REELS.md §2): from a
 * YouTube player on this page, any other tab, or the microphone. Only its
 * beat is kept for the cuts; the reel is made without sound.
 */
export function ListenPanel({
  disabled,
  onHeard,
}: {
  disabled: boolean;
  onHeard(blob: Blob, name: string, origin?: string): Promise<void>;
}) {
  // What the browser offers is only known in the browser.
  const [sources, setSources] = useState({ mic: false, tab: false });
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- capabilities exist only client-side
    setSources(listenSources());
  }, []);

  const [link, setLink] = useState("");
  const [videoId, setVideoId] = useState<string | null>(null);
  const [linkError, setLinkError] = useState(false);
  const [state, setState] = useState<{ source: ListenSource; since: number } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const listening = useRef<Listening | null>(null);
  // The same as `state`, for the end the browser reports (sharing stopped, the
  // time limit) — that callback was made before `state` was set.
  const started = useRef<{ source: ListenSource; since: number } | null>(null);

  useEffect(() => {
    if (!state) return;
    const timer = setInterval(() => setElapsed((Date.now() - state.since) / 1000), 250);
    return () => clearInterval(timer);
  }, [state]);
  useEffect(() => () => listening.current?.cancel(), []);

  const showVideo = () => {
    const id = youtubeId(link);
    setLinkError(id === null);
    setVideoId(id);
  };

  const finish = async () => {
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
    await onHeard(
      blob,
      name,
      was.source === "tab" && videoId ? `https://youtu.be/${videoId}` : undefined,
    );
  };

  const start = async (source: ListenSource) => {
    setError(null);
    try {
      listening.current = await listen(source, () => void finish());
      setElapsed(0);
      started.current = { source, since: Date.now() };
      setState(started.current);
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
    }
  };

  if (!sources.mic && !sources.tab) return null;

  return (
    <details className="mt-4" open={state !== null || undefined}>
      <summary className="cursor-pointer text-sm font-semibold">
        Nebo písničku poslechnout (YouTube, Instagram, reproduktor)
      </summary>
      <div className="mt-3 space-y-3 text-sm">
        <p className="text-admin-muted text-caption dark:text-neutral-400">
          Stránka si písničku jen poslechne, najde rytmus a střihy na něj nastaví. Video pak bude{" "}
          <strong>bez zvuku</strong> — stejnou písničku přidáš až v Instagramu, kde je licencovaná.
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
                  className="border-admin-border min-h-11 min-w-0 flex-1 rounded-lg border px-3 dark:border-neutral-700 dark:bg-neutral-900"
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
              <iframe
                src={youtubeEmbedUrl(videoId)}
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
              {state.source === "tab"
                ? "Pusť písničku od místa, kde má video začít. Stačí 30–60 sekund."
                : "Pusť písničku nahlas poblíž mikrofonu, od místa, kde má video začít. Stačí 30–60 sekund."}
            </p>
            <div className="flex gap-2">
              <Button onClick={() => void finish()}>Hotovo</Button>
              <Button
                variant="secondary"
                onClick={() => {
                  listening.current?.cancel();
                  listening.current = null;
                  started.current = null;
                  setState(null);
                }}
              >
                Zrušit
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {sources.tab && (
              <Button variant="secondary" disabled={disabled} onClick={() => void start("tab")}>
                Poslouchat kartu
              </Button>
            )}
            {sources.mic && (
              <Button variant="secondary" disabled={disabled} onClick={() => void start("mic")}>
                Poslouchat mikrofonem
              </Button>
            )}
          </div>
        )}
        {sources.tab && !state && (
          <p className="text-admin-muted text-caption dark:text-neutral-400">
            „Poslouchat kartu“: v okně sdílení vyber <strong>tuto kartu</strong> (nebo kartu s
            písničkou) a zapni <strong>Sdílet i zvuk karty</strong>. Pak pusť video.
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
