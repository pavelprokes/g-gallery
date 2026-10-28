"use client";

import { useEffect, useMemo, useRef } from "react";
import type { BeatAnalysis } from "@/lib/reels/beats";
import { applyEnvelope } from "@/lib/reels/audio";
import { barAt, loudness, planReel, shiftSection, type Pace } from "@/lib/reels/cuts";
import { formatDuration } from "@/lib/video";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";

// The part of the song the reels play (docs/REELS.md §3): the song's
// loudness drawn across its length, the reel's stretch marked on it, moved by
// a click, a drag or the arrows — always onto a bar's first beat — and heard
// before any variant is.

/** Slices of the song drawn; enough for a minute-long stretch to show its shape. */
const COLUMNS = 120;

const clock = (seconds: number) => formatDuration(seconds * 1000);

export function SongSection({
  analysis,
  buffer,
  seconds,
  pace,
  chosen,
  automatic,
  onChoose,
  playing,
  onTogglePlay,
  contextFor,
}: {
  analysis: BeatAnalysis;
  buffer: AudioBuffer | null;
  seconds: number;
  pace: Pace;
  /** The bar the photographer chose, or null for the loudest stretch. */
  chosen: number | null;
  /** Where the loudest stretch starts — the first variant's music. */
  automatic: number;
  onChoose(startBeat: number | null): void;
  playing: boolean;
  onTogglePlay(): void;
  contextFor(): AudioContext;
}) {
  const shape = useMemo(() => loudness(analysis, COLUMNS), [analysis]);
  const start = chosen ?? automatic;
  // The stretch as a variant cuts it: from the bar to the bar it ends on, plus the hold.
  const plan = useMemo(
    () => planReel(analysis, { startBeat: start, seconds, pace, accents: false, maxPhotos: 1000 }),
    [analysis, start, seconds, pace],
  );
  const { offset, fadeOut } = plan;
  const length = plan.timeline.duration;
  const total = Math.max(analysis.duration, 0.001);
  const share = (t: number) => `${Math.min(100, Math.max(0, (t / total) * 100))}%`;

  const headRef = useRef<HTMLDivElement>(null);
  const onTogglePlayRef = useRef(onTogglePlay);
  useEffect(() => {
    onTogglePlayRef.current = onTogglePlay;
  }, [onTogglePlay]);
  useEffect(() => {
    const head = headRef.current;
    if (!playing || !buffer) {
      if (head) head.hidden = true;
      return;
    }
    const audio = contextFor();
    const gain = audio.createGain();
    const startedAt = audio.currentTime + 0.05;
    applyEnvelope(gain.gain, startedAt, length, fadeOut);
    const source = audio.createBufferSource();
    source.buffer = buffer;
    source.connect(gain).connect(audio.destination);
    source.start(startedAt, offset, length);
    // Played to its end, the button goes back to "listen".
    source.onended = () => {
      if (audio.currentTime >= startedAt + length - 0.05) onTogglePlayRef.current();
    };
    let frame = 0;
    const tick = () => {
      if (head) {
        head.hidden = false;
        const t = offset + Math.max(0, audio.currentTime - startedAt);
        head.style.left = `${Math.min(100, (t / total) * 100)}%`;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      source.onended = null;
      source.stop();
      if (head) head.hidden = true;
    };
  }, [playing, buffer, contextFor, offset, length, fadeOut, total]);

  // A drag fires many times a bar: only a new bar is news (every variant is re-planned on it).
  const choose = (bar: number) => {
    if (bar !== chosen) onChoose(bar);
  };
  const move = (bars: number) => choose(shiftSection(analysis, start, bars));
  /** A place in the song: the bar nearest it that still leaves the reel room to play. */
  const chooseAt = (t: number) => choose(barAt(analysis, Math.min(t, total - length)));

  return (
    <Card as="section" aria-label="Část písničky">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <CardTitle>Část písničky</CardTitle>
        <p className="text-caption tabular-nums">
          {clock(offset)}–{clock(offset + length)}
          <span className="text-admin-muted dark:text-neutral-400">
            {chosen === null ? " · nejsilnější místo, vybrané samo" : " · vybráno tebou"}
          </span>
        </p>
      </div>
      <div className="has-[:focus-visible]:ring-brand-primary relative mt-2 h-16 rounded select-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-offset-2">
        <div className="flex h-full items-end gap-px" aria-hidden>
          {shape.map((v, i) => {
            const t = ((i + 0.5) / COLUMNS) * total;
            const inside = t >= offset && t <= offset + length;
            return (
              <span
                key={i}
                className={`flex-1 rounded-t-sm ${inside ? "bg-brand-primary" : "bg-brand-primary/25 dark:bg-neutral-600"}`}
                style={{ height: `${8 + v * 92}%` }}
              />
            );
          })}
        </div>
        <div
          aria-hidden
          className="border-brand-primary pointer-events-none absolute inset-y-0 rounded border-2"
          style={{ left: share(offset), width: share(length) }}
        />
        <div
          ref={headRef}
          hidden
          aria-hidden
          className="pointer-events-none absolute inset-y-0 w-0.5 bg-black dark:bg-white"
        />
        {/* The whole strip is the slider: a click or a drag puts the start there. */}
        <input
          type="range"
          min={0}
          max={Math.round(total * 10)}
          step={1}
          value={Math.round(offset * 10)}
          onChange={(e) => chooseAt(Number(e.target.value) / 10)}
          onKeyDown={(e) => {
            const bars = {
              ArrowLeft: -1,
              ArrowDown: -1,
              ArrowRight: 1,
              ArrowUp: 1,
              PageDown: -4,
              PageUp: 4,
            }[e.key];
            if (bars === undefined) return;
            e.preventDefault();
            move(bars);
          }}
          aria-label="Začátek hudby ve videu"
          aria-valuetext={`od ${clock(offset)} do ${clock(offset + length)}`}
          className="absolute inset-0 size-full cursor-pointer opacity-0"
        />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={onTogglePlay} disabled={!buffer} aria-pressed={playing}>
          {playing ? "Zastavit" : "Poslechnout tuhle část"}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => move(-1)}
          aria-label="Hudba o takt dřív"
        >
          ← o takt
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => move(1)}
          aria-label="Hudba o takt později"
        >
          o takt →
        </Button>
        {chosen !== null && (
          <Button size="sm" variant="secondary" onClick={() => onChoose(null)}>
            Vybrat samo
          </Button>
        )}
      </div>
      <p className="text-admin-muted text-caption mt-2 dark:text-neutral-400">
        Klikni nebo táhni do písničky tam, odkud má hudba začít — začátek se přichytí na první dobu
        taktu. Platí pro všechny varianty; každou pak ještě můžeš posunout zvlášť.
      </p>
    </Card>
  );
}
