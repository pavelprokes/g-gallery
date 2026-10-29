"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TimelinePosition } from "@/lib/gallery-chapters";
import { FORMS, pluralize } from "@/lib/czech-plural";
import { analyzeTrack, applyEnvelope, clockFor, decodeTrack, unlockAudio } from "@/lib/reels/audio";
import {
  PACES,
  REEL_LENGTHS,
  sections,
  shiftSection,
  type Pace,
  type ReelLength,
} from "@/lib/reels/cuts";
import {
  deleteTrack,
  isCurrent,
  kindOf,
  listTracks,
  saveTrack,
  type MusicTrack,
  type TrackKind,
} from "@/lib/reels/music-library";
import { reelVariants, type ReelSource, type ReelVariant } from "@/lib/reels/variants";
import { FORMATS, type VideoFormat } from "@/lib/social-video/camera";
import { chooseCodec, type EncodeCodec } from "@/lib/social-video/encode";
import { formatDuration } from "@/lib/video";
import { startHint } from "@/lib/reels/start-hint";
import type { PhotoFaces } from "@/lib/social-video/faces";
import { drawFrame } from "@/lib/social-video/frame";
import { SlideImages } from "@/lib/social-video/slide-images";
import { slidesAt, slidesToDecode, type Timeline } from "@/lib/social-video/timeline";
import {
  reelFramePlan,
  reelSlides,
  renderReel,
  type ReelFraming,
  type ReelPhoto,
  type RenderProgress,
} from "@/components/admin/reel-render";
import type { StudioPhoto } from "@/components/admin/social-video-studio";
import { AdminPhotoImage } from "@/components/admin/admin-photo-image";
import { ListenPanel } from "@/components/admin/reel-listen";
import { SongSection } from "@/components/admin/reel-section";
import { ReelPhotoPick } from "@/components/admin/reel-photo-pick";
import { reelsHref } from "@/lib/reels/sources";
import { InstagramMusic, type InstagramState } from "@/components/admin/reel-instagram-music";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { ChoiceGroup } from "@/components/ui/choice-group";

// docs/REELS.md is the flow: galleries (the picker above), a song, the
// length and pace, three variants cut on its beat, one rendered with the
// music. The beat, the cuts and the picking live in src/lib/reels/; the
// camera, the frame and the encoder are the social video's.

export interface ReelGallery {
  id: string;
  title: string;
  chapterStarts: TimelinePosition[];
  photos: StudioPhoto[];
}

const FORMAT = FORMATS["9:16"];
/** The previews are drawn at this share of the output's size — three of them play side by side. */
const PREVIEW_SCALE = 0.4;
const PREVIEW_FORMAT: VideoFormat = {
  ...FORMAT,
  width: Math.round(FORMAT.width * PREVIEW_SCALE),
  height: Math.round(FORMAT.height * PREVIEW_SCALE),
};
/** Seconds of slides the playing preview keeps decoded ahead of the music. */
const PREVIEW_AHEAD = 2;
/** A song file larger than this is not a song (or not one a reel needs). */
const MAX_TRACK_BYTES = 60 * 1024 * 1024;

const PACE_LABEL: Record<Pace, string> = {
  song: "Podle písničky",
  fast: "Rychle · cca ½ s",
  beat: "Co vteřina, to fotka",
  calm: "Klidněji · cca 2 s",
};

const LAST_TRACK_KEY = "g-gallery:reels:track";
/** The photos clicked for a set of galleries, per browser (a convenience, not a record). */
const PICKED_KEY = "g-gallery:reels:picked";

function readPicked(key: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function writePicked(key: string, ids: string[]) {
  try {
    if (ids.length > 0) localStorage.setItem(key, JSON.stringify(ids));
    else localStorage.removeItem(key);
  } catch {
    // A convenience only.
  }
}
/** What `playing` holds while the song's part is heard rather than a variant. */
const SECTION_KEY = "section";

const clock = (seconds: number) => formatDuration(seconds * 1000);
/** "14,0": seconds to a tenth, with the Czech decimal comma. */
const tenths = (seconds: number) =>
  seconds.toLocaleString("cs", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** "0,6–1,7 s": the shortest and longest photo, the held last one aside. */
function lengthRange(timeline: Timeline): string {
  const lengths = timeline.slides.slice(0, -1).map((s) => s.end - s.start);
  if (lengths.length === 0) return `${tenths(timeline.duration)} s`;
  const f = (v: number) => v.toLocaleString("cs", { maximumFractionDigits: 1 });
  const [lo, hi] = [Math.min(...lengths), Math.max(...lengths)];
  return lo.toFixed(1) === hi.toFixed(1) ? `${f(lo)} s` : `${f(lo)}–${f(hi)} s`;
}

function trackNote(track: MusicTrack): string {
  switch (kindOf(track)) {
    case "listened":
      return track.listenSource === "mic" ? " · poslech mikrofonem" : " · poslech karty";
    case "instagram":
      return " · z Instagramu";
    default:
      return "";
  }
}

function readLastTrack(): string | null {
  try {
    return localStorage.getItem(LAST_TRACK_KEY);
  } catch {
    return null;
  }
}

function writeLastTrack(id: string) {
  try {
    localStorage.setItem(LAST_TRACK_KEY, id);
  } catch {
    // A convenience only.
  }
}

type RenderState =
  | { kind: "idle" }
  | { kind: "busy"; key: string; progress: RenderProgress }
  | { kind: "error"; key: string };

interface Result {
  /** What the file was made from: a variant that has changed since is another video. */
  signature: string;
  url: string;
  file: File;
}

const signatureOf = (
  v: ReelVariant,
  trackId: string | null,
  withSound: boolean,
  framing: ReelFraming,
) =>
  `${trackId}|${withSound}|${framing.zoom}|${framing.wholeAcross}|${v.photoIds.join()}|${v.plan.offset}|${v.plan.timeline.slides
    .map((slide) => slide.start)
    .join()}|${v.plan.timeline.duration}`;

export function ReelStudio({
  galleries,
  instagram,
}: {
  galleries: ReelGallery[];
  instagram: InstagramState;
}) {
  // ---- The photos, from every chosen gallery ----
  const photos = useMemo(() => {
    const map = new Map<string, ReelPhoto & { studio: StudioPhoto }>();
    for (const gallery of galleries) {
      for (const photo of gallery.photos) {
        const { width, height, coupleTags } = photo.candidate;
        if (!width || !height) continue;
        map.set(photo.id, {
          id: photo.id,
          objectKey: photo.objectKey,
          width,
          height,
          coupleTags,
          studio: photo,
        });
      }
    }
    return map;
  }, [galleries]);
  const faces = useMemo(
    () =>
      Object.fromEntries(
        galleries.flatMap((g) => g.photos.map((p) => [p.id, p.candidate.faces] as const)),
      ) as Record<string, PhotoFaces | null>,
    [galleries],
  );
  const sources: ReelSource[] = useMemo(
    () =>
      galleries.map((g) => ({
        id: g.id,
        chapterStarts: g.chapterStarts,
        candidates: g.photos.map((p) => p.candidate),
      })),
    [galleries],
  );
  const title = galleries.length === 1 ? galleries[0]!.title : "svatby";
  const allOwn = galleries.reduce((n, g) => n + g.photos.filter((p) => p.candidate.own).length, 0);

  // ---- Which photos: the suggestion's, or the ones clicked in each gallery ----
  const pickKey = `${PICKED_KEY}:${galleries
    .map((g) => g.id)
    .toSorted()
    .join(",")}`;
  const [manual, setManual] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [mixGalleries, setMixGalleries] = useState(true);
  useEffect(() => {
    // The photos clicked last time for these galleries, if this browser kept them.
    const kept = readPicked(pickKey).filter((id) => photos.has(id));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restored once per set of galleries
    setPicked(new Set(kept));
    setManual(kept.length > 0);
  }, [pickKey, photos]);
  const changePicked = (next: Set<string>) => {
    setPicked(next);
    writePicked(pickKey, [...next]);
  };
  const only = manual && picked.size > 0 ? picked : undefined;

  // ---- Music: this browser's library ----
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [libraryReady, setLibraryReady] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [trackId, setTrackId] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const decoded = useRef(new Map<string, Promise<AudioBuffer>>());
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const list = await listTracks();
        const last = readLastTrack();
        // A track analysed by an older build gets its beat found again — one
        // at a time: a whole library decoded at once is gigabytes of samples.
        // The song that will be chosen keeps its decode for the preview.
        const current: MusicTrack[] = [];
        for (const t of list) {
          if (!live) return;
          if (isCurrent(t)) {
            current.push(t);
            continue;
          }
          const audio = await decodeTrack(t.blob);
          const fresh = { ...t, analysis: analyzeTrack(audio) };
          if (t.id === (last ?? list[0]?.id)) decoded.current.set(t.id, Promise.resolve(audio));
          await saveTrack(fresh).catch(() => {});
          current.push(fresh);
        }
        if (!live) return;
        setTracks(current);
        setTrackId(current.find((t) => t.id === last)?.id ?? current[0]?.id ?? null);
      } catch {
        if (live) {
          setLibraryError(
            "Prohlížeč si hudbu nepamatuje (soukromé okno?) — skladby platí jen do zavření stránky.",
          );
        }
      } finally {
        if (live) setLibraryReady(true);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const track = tracks.find((t) => t.id === trackId) ?? null;
  // Keyed on the song, not on its row: editing its note makes a new object
  // for the same song, which must neither re-decode it nor reset its choices.
  const trackBlob = track?.blob ?? null;
  useEffect(() => {
    // Silence until the new song is decoded, rather than the old one under new cuts.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the sound follows the track
    setBuffer(null);
    if (!trackId || !trackBlob) return;
    let live = true;
    let pending = decoded.current.get(trackId);
    if (!pending) {
      pending = decodeTrack(trackBlob);
      pending.catch(() => decoded.current.delete(trackId));
      decoded.current.set(trackId, pending);
    }
    pending.then((b) => live && setBuffer(b)).catch(() => live && setBuffer(null));
    return () => {
      live = false;
    };
  }, [trackId, trackBlob]);

  /** Decoded, its beat found, kept in this browser and chosen. Throws when
   * the browser cannot decode it. */
  const addTrack = async (
    blob: Blob,
    name: string,
    kind: TrackKind,
    extra: Pick<MusicTrack, "origin" | "audioId" | "listenSource" | "startAt" | "durationMs"> = {},
  ): Promise<void> => {
    const audio = await decodeTrack(blob);
    const entry: MusicTrack = {
      id: crypto.randomUUID(),
      name,
      source: "",
      addedAt: Date.now(),
      blob,
      analysis: analyzeTrack(audio),
      kind,
      ...extra,
    };
    decoded.current.set(entry.id, Promise.resolve(audio));
    await saveTrack(entry).catch(() =>
      setLibraryError("Skladbu se nepodařilo uložit v prohlížeči — platí jen do zavření stránky."),
    );
    setTracks((prev) => [entry, ...prev]);
    setTrackId(entry.id);
    writeLastTrack(entry.id);
  };

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    setLibraryError(null);
    for (const file of Array.from(files)) {
      if (file.size > MAX_TRACK_BYTES) {
        setLibraryError(`${file.name}: soubor je větší než 60 MB.`);
        continue;
      }
      setAdding(`Hledám rytmus: ${file.name}`);
      try {
        await addTrack(file, file.name.replace(/\.[^.]+$/, ""), "file");
      } catch {
        setLibraryError(
          `${file.name}: tenhle soubor prohlížeč nepřehraje. Zkus MP3, M4A nebo WAV.`,
        );
      }
    }
    setAdding(null);
  };

  const addInstagram = async (
    blob: Blob,
    name: string,
    audioId: string,
    durationMs: number | null,
  ) => {
    setLibraryError(null);
    setAdding(`Hledám rytmus: ${name}`);
    try {
      await addTrack(blob, name, "instagram", { audioId, durationMs: durationMs ?? undefined });
    } catch {
      setLibraryError(`${name}: zvuk z Instagramu se nepodařilo přečíst.`);
    }
    setAdding(null);
  };

  const addHeard = async (
    blob: Blob,
    name: string,
    listenSource: "mic" | "tab",
    details: Pick<MusicTrack, "origin" | "startAt">,
  ) => {
    setLibraryError(null);
    setAdding("Hledám rytmus v poslechu…");
    try {
      await addTrack(blob, name, "listened", { ...details, listenSource });
    } catch {
      setLibraryError("Z poslechu se nepodařilo nic přečíst. Zkus to znovu a hlasitěji.");
    }
    setAdding(null);
  };

  const removeTrack = async (id: string) => {
    setTracks((prev) => prev.filter((t) => t.id !== id));
    if (trackId === id) setTrackId(null);
    decoded.current.delete(id);
    await deleteTrack(id).catch(() => {});
  };

  const updateSource = (id: string, source: string) => {
    const entry = tracks.find((t) => t.id === id);
    if (!entry || entry.source === source) return;
    setTracks((prev) => prev.map((t) => (t.id === id ? { ...t, source } : t)));
    void saveTrack({ ...entry, source }).catch(() => {});
  };

  // ---- Settings and variants ----
  const [seconds, setSeconds] = useState<ReelLength>(15);
  const [pace, setPace] = useState<Pace>("song");
  const [exclude, setExclude] = useState<Set<string>>(() => new Set());
  // The photos the variants can show: the ones picked by hand, or every own
  // photo — less the ones taken out.
  const ownPhotos = only
    ? [...only].filter((id) => !exclude.has(id)).length
    : allOwn - [...exclude].filter((id) => photos.get(id)?.studio.candidate.own).length;
  const [round, setRound] = useState(0);
  const [shown, setShown] = useState<Set<string>>(() => new Set());
  const [startBeats, setStartBeats] = useState<Record<string, number>>({});
  // The part of the song every variant plays, once the photographer picks one.
  const [songStart, setSongStart] = useState<number | null>(null);
  const [byGuests, setByGuests] = useState(true);
  // How the photos are framed: still and cut to the video's shape unless asked.
  const [zoom, setZoom] = useState(false);
  const [wholeAcross, setWholeAcross] = useState(false);
  const framing = useMemo(() => ({ zoom, wholeAcross }), [zoom, wholeAcross]);

  const analysis = track?.analysis ?? null;
  const trackKind = track ? kindOf(track) : null;
  // Plain values read off the song, so nothing below hands the song itself to
  // a function (the React Compiler then keeps the memos).
  const defaultSound = !(trackKind === "listened" && track?.listenSource === "mic");
  const trackStartAt = track?.startAt;
  const trackDurationMs = track?.durationMs;
  const decodedMs = (track?.analysis.duration ?? 0) * 1000;
  // The file with the song's sound, or silent for the song to be added in
  // Instagram (Pavel, 2026-10-28). A microphone's room recording starts silent.
  const [withSound, setWithSound] = useState(true);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- each song starts from its own default
    setWithSound(defaultSound);
  }, [trackId, defaultSound]);
  const variants = useMemo(
    () =>
      analysis
        ? reelVariants({
            sources,
            format: FORMAT,
            analysis,
            settings: { seconds, pace },
            exclude,
            shown,
            round,
            startBeats,
            songStart,
            byGuests,
            mixGalleries,
            only,
            wholeAcross,
          })
        : [],
    [
      analysis,
      sources,
      seconds,
      pace,
      exclude,
      shown,
      round,
      startBeats,
      songStart,
      byGuests,
      mixGalleries,
      only,
      wholeAcross,
    ],
  );
  const loudest = useMemo(
    () => (analysis ? (sections(analysis, seconds, 1)[0] ?? 0) : 0),
    [analysis, seconds],
  );
  const chooseSongStart = (beat: number | null) => {
    setSongStart(beat);
    setStartBeats({});
  };
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a chosen part belongs to one song
    setSongStart(null);
  }, [trackId]);

  // A new song or length starts the music where the song is loudest again.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- moved starts belong to one song
    setStartBeats({});
  }, [trackId, seconds]);

  const moreVariants = () => {
    setShown((prev) => new Set([...prev, ...variants.flatMap((v) => v.photoIds)]));
    setRound((r) => r + 1);
    setStartBeats({});
  };
  const resetVariants = () => {
    setShown(new Set());
    setRound(0);
    setStartBeats({});
  };
  const excludePhoto = (id: string) => setExclude((prev) => new Set([...prev, id]));

  // ---- Playback: one variant at a time, with its music ----
  const [playing, setPlaying] = useState<string | null>(null);
  // ---- The variants on a phone: a strip to swipe through ----
  const stripRef = useRef<HTMLDivElement>(null);
  const [shownVariant, setShownVariant] = useState(0);
  const onStripScroll = () => {
    const strip = stripRef.current;
    if (!strip || strip.scrollWidth <= strip.clientWidth) return;
    const cards = [...strip.children] as HTMLElement[];
    const middle = strip.scrollLeft + strip.clientWidth / 2;
    const index = cards.reduce(
      (best, card, i) =>
        Math.abs(card.offsetLeft + card.offsetWidth / 2 - middle) <
        Math.abs(cards[best]!.offsetLeft + cards[best]!.offsetWidth / 2 - middle)
          ? i
          : best,
      0,
    );
    if (index === shownVariant) return;
    setShownVariant(index);
    // A variant swiped away stops playing.
    setPlaying((p) => (p === SECTION_KEY ? p : null));
  };
  const showVariant = (index: number) => {
    setShownVariant(index);
    const card = stripRef.current?.children[index] as HTMLElement | undefined;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    card?.scrollIntoView({
      behavior: still ? "auto" : "smooth",
      block: "nearest",
      inline: "center",
    });
  };
  const audioContext = useRef<AudioContext | null>(null);
  const contextFor = useCallback(() => {
    audioContext.current ??= new AudioContext();
    void audioContext.current.resume();
    return audioContext.current;
  }, []);
  useEffect(() => () => void audioContext.current?.close(), []);
  /** Starts or stops a preview from a tap: the sound is woken inside the tap (iOS). */
  const togglePlaying = (key: string) => {
    unlockAudio(contextFor());
    setPlaying((p) => (p === key ? null : key));
  };

  // ---- Render ----
  const [codec, setCodec] = useState<EncodeCodec | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void chooseCodec(FORMAT.width, FORMAT.height).then((c) => live && setCodec(c));
    return () => {
      live = false;
    };
  }, []);
  const [renderState, setRenderState] = useState<RenderState>({ kind: "idle" });
  const [results, setResults] = useState<Result[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);
  // The variants on screen, for a render that ends after its variant changed:
  // its file belongs to nothing and is released at once.
  const liveSignatures = useRef(new Set<string>());
  // Every file still held, released when the page goes.
  const heldUrls = useRef(new Set<string>());
  useEffect(() => {
    const held = heldUrls.current;
    return () => {
      for (const url of held) URL.revokeObjectURL(url);
    };
  }, []);

  const silent = !withSound;
  const render = async (variant: ReelVariant) => {
    if (!buffer || !codec || renderState.kind === "busy") return;
    setPlaying(null);
    const controller = new AbortController();
    abortRef.current = controller;
    setRenderState({ kind: "busy", key: variant.key, progress: { step: "render", share: 0 } });
    try {
      const file = await renderReel({
        variant,
        photos,
        faces,
        format: FORMAT,
        framing,
        track: withSound ? buffer : null,
        codec,
        title,
        signal: controller.signal,
        onProgress: (progress) => setRenderState({ kind: "busy", key: variant.key, progress }),
      });
      const signature = signatureOf(variant, trackId, withSound, framing);
      setRenderState({ kind: "idle" });
      if (!liveSignatures.current.has(signature)) return;
      const url = URL.createObjectURL(file);
      heldUrls.current.add(url);
      setResults((prev) => {
        for (const r of prev) {
          if (r.signature !== signature) continue;
          URL.revokeObjectURL(r.url);
          heldUrls.current.delete(r.url);
        }
        return [...prev.filter((r) => r.signature !== signature), { signature, url, file }];
      });
    } catch (cause) {
      if (controller.signal.aborted) setRenderState({ kind: "idle" });
      else {
        console.error("[g-gallery/reels] render failed", cause);
        setRenderState({ kind: "error", key: variant.key });
      }
    } finally {
      abortRef.current = null;
    }
  };
  // A changed variant is a different video: its old file goes.
  useEffect(() => {
    const live = new Set(variants.map((v) => signatureOf(v, trackId, withSound, framing)));
    setResults((prev) => {
      const kept = prev.filter((r) => live.has(r.signature));
      for (const r of prev) {
        if (kept.includes(r)) continue;
        URL.revokeObjectURL(r.url);
        heldUrls.current.delete(r.url);
      }
      return kept.length === prev.length ? prev : kept;
    });
    liveSignatures.current = live;
  }, [variants, trackId, withSound, framing]);

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <Card as="section">
          <CardTitle>Hudba</CardTitle>
          {!libraryReady ? (
            <p className="text-sm">Načítám…</p>
          ) : (
            <>
              {tracks.length === 0 ? (
                <p className="mb-3 text-sm">
                  Přidej písničku z počítače, nebo ji nech stránku poslechnout — rytmus se najde sám
                  a střihy padnou na doby. Skladby zůstávají jen v tomhle prohlížeči, nikam se
                  nenahrávají.
                </p>
              ) : (
                <ul className="mb-3 space-y-2" role="radiogroup" aria-label="Písnička">
                  {tracks.map((t) => (
                    <li
                      key={t.id}
                      className="border-admin-border has-checked:border-brand-primary has-checked:ring-brand-primary rounded-lg border p-2 has-checked:ring-1 dark:border-neutral-700"
                    >
                      <div className="flex items-center gap-3">
                        <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3">
                          <input
                            type="radio"
                            name="reel-track"
                            checked={t.id === trackId}
                            onChange={() => {
                              setTrackId(t.id);
                              writeLastTrack(t.id);
                            }}
                            className="accent-brand-primary size-5 shrink-0"
                          />
                          <span className="min-w-0">
                            <span className="block truncate font-semibold">{t.name}</span>
                            <span className="text-admin-muted text-caption dark:text-neutral-400">
                              {Math.round(t.analysis.bpm)} BPM · {clock(t.analysis.duration)}
                              {trackNote(t)}
                            </span>
                          </span>
                        </label>
                        <button
                          type="button"
                          onClick={() => void removeTrack(t.id)}
                          aria-label={`Odebrat skladbu ${t.name}`}
                          className="text-admin-muted hover:text-admin-danger grid size-11 shrink-0 place-items-center rounded-lg"
                        >
                          <span aria-hidden>×</span>
                        </button>
                      </div>
                      <input
                        type="text"
                        defaultValue={t.source}
                        onBlur={(e) => updateSource(t.id, e.target.value.trim())}
                        placeholder="Odkud je a jaká licence (pro tebe)"
                        aria-label={`Odkud je skladba ${t.name}`}
                        className="border-admin-border mt-1 min-h-11 w-full rounded border px-2 text-base sm:text-xs dark:border-neutral-700 dark:bg-neutral-900"
                      />
                    </li>
                  ))}
                </ul>
              )}
              <label className="border-brand-primary text-brand-primary-dark hover:bg-admin-accent-soft inline-flex min-h-11 cursor-pointer items-center rounded-lg border px-4 text-sm font-semibold">
                {adding ? "Pracuji…" : "Přidat písničku…"}
                <input
                  type="file"
                  accept="audio/*,.mp3,.m4a,.wav,.aac"
                  multiple
                  disabled={adding !== null}
                  className="sr-only"
                  onChange={(e) => {
                    void addFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
              </label>
              <ListenPanel disabled={adding !== null} onHeard={addHeard} />
              <InstagramMusic
                state={instagram}
                returnTo={reelsHref(galleries.map((g) => g.id))}
                disabled={adding !== null}
                onPicked={addInstagram}
              />
              {adding && (
                <p className="text-caption mt-2" role="status">
                  {adding}
                </p>
              )}
              {libraryError && (
                <Alert tone="warning" compact className="mt-3">
                  {libraryError}
                </Alert>
              )}
              <MusicSources />
            </>
          )}
        </Card>

        <Card as="section">
          <CardTitle>Délka a tempo</CardTitle>
          <ChoiceGroup
            label="Délka"
            value={seconds}
            onChange={setSeconds}
            choices={REEL_LENGTHS.map((l) => ({ value: l, label: `${l} s` }))}
          />
          <ChoiceGroup
            label="Tempo střihů"
            className="mt-3"
            value={pace}
            onChange={setPace}
            choices={(Object.keys(PACES) as Pace[]).map((p) => ({
              value: p,
              label: PACE_LABEL[p],
            }))}
          />
          <p className="text-admin-muted text-caption mt-3 dark:text-neutral-400">
            {pace === "song"
              ? "Střihy jdou s písničkou: v klidné části fotka chvíli vydrží, v refrénu se mění na každou dobu, nová část i výrazný úder dostanou vlastní střih."
              : "Střih vždy padne na dobu, v pravidelném rytmu."}{" "}
            Video začne na první době taktu tam, kde písnička hraje naplno, a skončí s doznívající
            hudbou.{" "}
            {only
              ? `Bere se jen ${pluralize(ownPhotos, FORMS.photo)}, které jsi vybral.`
              : `Vybírá se z ${pluralize(ownPhotos, FORMS.photo)} — tvé fotky, ne fotky hostů.`}
          </p>
          <label className="mt-3 flex min-h-11 cursor-pointer items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={byGuests}
              onChange={(e) => setByGuests(e.target.checked)}
              className="accent-brand-primary mt-0.5 size-5 shrink-0"
            />
            <span>
              Fotky podle hostů
              <span className="text-admin-muted text-caption block dark:text-neutral-400">
                Bere hlavně ty, které si hosté nejvíc prohlíželi, dávali do tisku, do oblíbených a
                reagovali na ně. Kde o nich hosté ještě nic neřekli, vybírá podle tvých hvězdiček.
              </span>
            </span>
          </label>
          <ChoiceGroup
            label="Zvuk ve videu"
            className="mt-3"
            value={withSound}
            onChange={setWithSound}
            choices={[
              { value: true, label: "Se zvukem" },
              { value: false, label: "Bez zvuku" },
            ]}
          />
          <p className="text-admin-muted text-caption mt-2 dark:text-neutral-400">
            Bez zvuku přidáš písničku až v Instagramu — z jeho knihovny, licencovanou.
          </p>
          <ChoiceGroup
            label="Kamera"
            className="mt-4"
            value={zoom}
            onChange={setZoom}
            choices={[
              { value: false, label: "Bez přiblížení" },
              { value: true, label: "Jemné přiblížení" },
            ]}
          />
          <ChoiceGroup
            label="Fotky na šířku"
            className="mt-3"
            value={wholeAcross}
            onChange={setWholeAcross}
            choices={[
              { value: false, label: "Oříznout na výšku" },
              { value: true, label: "Celé, s rozmazaným okrajem" },
            ]}
          />
          <p className="text-admin-muted text-caption mt-2 dark:text-neutral-400">
            Ořez se drží obličejů a žádnou hlavu nepřeřízne. Přiblížení jen u fotek, které vydrží
            aspoň necelou vteřinu — u rychlých střihů by jen škubalo.
          </p>
          {exclude.size > 0 && (
            <Button
              size="sm"
              variant="secondary"
              className="mt-3"
              onClick={() => setExclude(new Set())}
            >
              Vrátit vyřazené fotky ({exclude.size})
            </Button>
          )}
        </Card>
      </div>

      {codec === null && (
        <Alert>
          Tenhle prohlížeč neumí video vytvořit (chybí WebCodecs). Otevři stránku v Chrome nebo v
          Safari 26+.
        </Alert>
      )}

      {analysis && (
        <SongSection
          analysis={analysis}
          buffer={buffer}
          seconds={seconds}
          pace={pace}
          chosen={songStart}
          automatic={loudest}
          onChoose={chooseSongStart}
          playing={playing === SECTION_KEY}
          onTogglePlay={() => togglePlaying(SECTION_KEY)}
          contextFor={contextFor}
        />
      )}

      <ReelPhotoPick
        galleries={galleries}
        manual={manual}
        onManual={setManual}
        picked={picked}
        onPicked={changePicked}
        mixGalleries={mixGalleries}
        onMixGalleries={setMixGalleries}
        wanted={Math.round(seconds * 1.3)}
      />

      {!analysis ? (
        <Alert tone="info">Vyber nebo přidej písničku — varianty se pak objeví tady.</Alert>
      ) : ownPhotos < 2 ? (
        <Alert>
          {only
            ? "Vyber aspoň dvě fotky — nebo nech vybírat samo."
            : "Ve vybraných galeriích nejsou aspoň dvě tvoje fotky."}
        </Alert>
      ) : (
        <section aria-label="Varianty">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">Varianty</h2>
            <div className="flex flex-wrap gap-2">
              {round > 0 && (
                <Button size="sm" variant="secondary" onClick={resetVariants}>
                  Zpět na první návrh
                </Button>
              )}
              <Button size="sm" variant="secondary" onClick={moreVariants}>
                Další varianty
              </Button>
            </div>
          </div>
          {/* On a phone the variants sit side by side to swipe through, not
              three screens tall each; the row above says which one is shown. */}
          <ChoiceGroup
            label="Zobrazená varianta"
            size="sm"
            className="mb-3 md:hidden"
            value={Math.min(shownVariant, variants.length - 1)}
            onChange={showVariant}
            choices={variants.map((v, i) => ({ value: i, label: v.label }))}
          />
          <div
            ref={stripRef}
            onScroll={onStripScroll}
            className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-3 md:gap-4 md:overflow-visible md:px-0 md:pb-0"
          >
            {variants.map((variant) => (
              <div key={variant.key} className="w-[86%] shrink-0 snap-center md:w-auto">
                <VariantCard
                  variant={variant}
                  photos={photos}
                  faces={faces}
                  buffer={buffer}
                  bpm={analysis.bpm}
                  playing={playing === variant.key}
                  onTogglePlay={() => togglePlaying(variant.key)}
                  contextFor={contextFor}
                  framing={framing}
                  onShift={(bars) =>
                    setStartBeats((prev) => ({
                      ...prev,
                      [variant.key]: shiftSection(analysis, variant.plan.startBeat, bars),
                    }))
                  }
                  onExclude={excludePhoto}
                  canRender={codec != null && buffer !== null}
                  silent={silent}
                  trackKind={trackKind}
                  hintStartAt={trackStartAt}
                  hintDurationMs={trackDurationMs}
                  hintDecodedMs={decodedMs}
                  renderState={renderState}
                  result={
                    results.find(
                      (r) => r.signature === signatureOf(variant, trackId, withSound, framing),
                    ) ?? null
                  }
                  onRender={() => void render(variant)}
                  onCancel={() => abortRef.current?.abort()}
                />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** Where music that may go into a business's Reels comes from (docs/REELS.md §7). */
function MusicSources() {
  return (
    <details className="text-caption mt-4">
      <summary className="cursor-pointer py-3.5 font-semibold">
        Kde vzít hudbu, aby Instagram video neztlumil
      </summary>
      <div className="mt-2 space-y-2 leading-relaxed">
        <p>
          Firemní účet smí použít jen hudbu, na kterou má licenci. Písnička ze Spotify nebo z CD
          video ztlumí nebo zablokuje.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Meta Sound Collection</strong> — zdarma, i komerčně, ale jen pro Facebook a
            Instagram. Business Suite → Všechny nástroje → Sound Collection, stáhnout na počítači.
          </li>
          <li>
            <strong>Mixkit</strong> — zdarma, komerční použití i bez uvedení autora.
          </li>
          <li>
            <strong>Epidemic Sound</strong> — placené, pro firmu tarif Business; po propojení účtů
            se video nezablokuje.
          </li>
          <li>
            Skladby pod <strong>CC BY</strong> (Kevin MacLeod, Free Music Archive) — autora uveď v
            popisku příspěvku. CC BY-NC na reklamu nejde.
          </li>
        </ul>
        <p>Pro rychlé střihy sedí písničky kolem 120–130 BPM.</p>
      </div>
    </details>
  );
}

function VariantCard({
  variant,
  photos,
  faces,
  buffer,
  bpm,
  playing,
  onTogglePlay,
  contextFor,
  framing,
  onShift,
  onExclude,
  canRender,
  silent,
  trackKind,
  hintStartAt,
  hintDurationMs,
  hintDecodedMs,
  renderState,
  result,
  onRender,
  onCancel,
}: {
  variant: ReelVariant;
  photos: ReadonlyMap<string, ReelPhoto & { studio: StudioPhoto }>;
  faces: Readonly<Record<string, PhotoFaces | null>>;
  buffer: AudioBuffer | null;
  bpm: number;
  playing: boolean;
  onTogglePlay(): void;
  contextFor(): AudioContext;
  framing: ReelFraming;
  onShift(bars: number): void;
  onExclude(id: string): void;
  canRender: boolean;
  /** The file is made without sound. */
  silent: boolean;
  trackKind: TrackKind | null;
  /** What `startHint` needs to say where to slide the song in Instagram. */
  hintStartAt: number | undefined;
  hintDurationMs: number | undefined;
  hintDecodedMs: number;
  renderState: RenderState;
  result: Result | null;
  onRender(): void;
  onCancel(): void;
}) {
  const { plan } = variant;
  const { timeline } = plan;
  const { slides, shots } = useMemo(
    () => reelSlides(variant, photos, faces, PREVIEW_FORMAT, framing),
    [variant, photos, faces, framing],
  );
  const store = useMemo(() => new SlideImages(), []);
  useEffect(() => () => store.close(), [store]);
  // Fetching the photos before the first play: "3 / 18".
  const [preparing, setPreparing] = useState<{ done: number; total: number } | null>(null);
  // Playing, but the browser would not start the sound.
  const [unheard, setUnheard] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || timeline.duration === 0) return;
    canvas.width = PREVIEW_FORMAT.width;
    canvas.height = PREVIEW_FORMAT.height;

    // The music is the clock: the picture follows the sound, never the other
    // way — or the page's clock, when the browser would not start the sound.
    let audio: AudioContext | null = null;
    let now = () => 0;
    let audible = false;
    let source: AudioBufferSourceNode | null = null;
    let startedAt = 0;
    let cancelled = false;
    const startSound = () => {
      if (!audio || !buffer) return;
      source?.stop();
      const gain = audio.createGain();
      startedAt = audio.currentTime + 0.05;
      applyEnvelope(gain.gain, startedAt, timeline.duration, plan.fadeOut);
      source = audio.createBufferSource();
      source.buffer = buffer;
      source.connect(gain).connect(audio.destination);
      source.start(startedAt, plan.offset, timeline.duration);
    };

    let frame = 0;
    let windowKey = "";
    let drawnStill = false;
    const tick = () => {
      let t = 0;
      if (playing && audio) {
        t = Math.max(0, now() - startedAt);
        if (t >= timeline.duration) {
          if (audible && buffer) startSound();
          else startedAt = now();
          t = 0;
        }
      }
      const wanted = slidesToDecode(timeline, slides, t, playing ? PREVIEW_AHEAD : 0);
      const key = wanted.map((p) => p.id).join();
      if (key !== windowKey) {
        windowKey = key;
        void store.keepOnly(wanted).catch(() => {});
      }
      // Only a frame whose photos are in is drawn: one still decoding keeps
      // the last frame on screen rather than a black one. Standing still, the
      // first frame is drawn once — three previews redrawing an unchanged
      // frame 60 times a second slowed a render in the same tab to a third.
      const visible = slidesAt(timeline, t).map((v) => slides[v.index]!);
      const onScreen = visible.every((p) => store.draws(p.id));
      // Decoded but drawing nothing — emptied by the browser: decoded again.
      if (visible.some((p) => store.imageOf(p.id) && !store.draws(p.id))) {
        void store.ensureDrawn(visible).catch(() => {});
      }
      if (onScreen && (playing || !drawnStill)) {
        drawFrame(ctx, reelFramePlan(store, slides, shots, PREVIEW_FORMAT, timeline), t);
        drawnStill = !playing;
      }
      frame = requestAnimationFrame(tick);
    };

    if (!playing) {
      frame = requestAnimationFrame(tick);
    } else {
      // Every photo fetched and the first seconds decoded before the music
      // starts: a reel cuts every half second, faster than a photo arrives.
      void (async () => {
        let done = 0;
        setPreparing({ done, total: slides.length });
        try {
          await Promise.all(
            slides.map((p) =>
              store.fetch(p).then(() => {
                if (!cancelled) setPreparing({ done: ++done, total: slides.length });
              }),
            ),
          );
          await store.keepOnly(slidesToDecode(timeline, slides, 0, PREVIEW_AHEAD));
        } catch {
          // A photo that did not come stays black; the rest still plays.
        }
        if (cancelled) return;
        audio = contextFor();
        const clock = await clockFor(audio);
        if (cancelled) return;
        setPreparing(null);
        ({ now, audible } = clock);
        setUnheard(!audible && buffer !== null);
        if (audible && buffer) startSound();
        else startedAt = now();
        frame = requestAnimationFrame(tick);
      })();
    }
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      source?.stop();
      setPreparing(null);
      setUnheard(false);
    };
  }, [playing, buffer, contextFor, timeline, plan.offset, plan.fadeOut, slides, shots, store]);

  const busyHere = renderState.kind === "busy" && renderState.key === variant.key;
  const busyElsewhere = renderState.kind === "busy" && !busyHere;
  const perCut = plan.beatsPerCut;

  return (
    <Card as="section" aria-label={`Varianta ${variant.label}`} className="min-w-0">
      <CardTitle as="h3">{variant.label}</CardTitle>
      <div className="relative mx-auto aspect-[9/16] max-w-[15rem] overflow-hidden rounded bg-black">
        <canvas
          ref={canvasRef}
          className="size-full"
          role="img"
          aria-label={`Náhled: ${variant.label}`}
        />
        {/* Outside the button: a status inside one is read as part of its name. */}
        <p
          role="status"
          className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center"
        >
          {preparing && (
            <span className="rounded-full bg-black/65 px-3 py-1 text-sm text-white tabular-nums">
              Načítám fotky {preparing.done}/{preparing.total}
            </span>
          )}
          {unheard && playing && (
            <span className="mx-3 rounded-lg bg-black/65 px-3 py-1 text-center text-sm text-white">
              Prohlížeč nepustil zvuk — zastav a klepni na přehrát znovu
            </span>
          )}
        </p>
        <button
          type="button"
          onClick={onTogglePlay}
          aria-pressed={playing}
          aria-label={playing ? "Zastavit náhled" : "Přehrát náhled s hudbou"}
          className="absolute inset-0 grid place-items-center text-white"
        >
          {!playing && (
            <span aria-hidden className="grid size-14 place-items-center rounded-full bg-black/55">
              {/* Drawn, not "▶": some systems paint that as a colour emoji. */}
              <svg viewBox="0 0 24 24" className="ml-1 size-6 fill-current">
                <path d="M7 4.5v15l12.5-7.5z" />
              </svg>
            </span>
          )}
        </button>
      </div>
      <p className="text-caption mt-3 tabular-nums">
        {pluralize(variant.photoIds.length, FORMS.photo)} · {tenths(timeline.duration)} s ·{" "}
        {plan.adaptive
          ? `střihy podle hudby, ${lengthRange(timeline)}`
          : `střih ${perCut === 1 ? "na každou dobu" : `po ${perCut} dobách`}`}{" "}
        ({Math.round(bpm)} BPM)
        {variant.accents && (plan.adaptive ? " · rychlejší" : " · zrychlení na konci frází")}
      </p>
      <div className="text-caption mt-2 flex flex-wrap items-center gap-2">
        <span>
          {trackKind === "listened"
            ? `Od ${tenths(plan.offset)} s poslechu`
            : `Hudba od ${clock(plan.offset)}`}
        </span>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onShift(-4)}
          aria-label="Hudba o čtyři takty dřív"
        >
          ← dřív
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onShift(4)}
          aria-label="Hudba o čtyři takty později"
        >
          později →
        </Button>
      </div>

      <details className="mt-3">
        <summary className="cursor-pointer py-3 text-sm font-semibold">
          Fotky ve variantě ({variant.photoIds.length})
        </summary>
        <p className="text-admin-muted text-caption mt-1 dark:text-neutral-400">
          × fotku vyřadí ze všech variant a nahradí jinou.
        </p>
        <ul className="mt-2 grid grid-cols-4 gap-1.5">
          {variant.photoIds.map((id, i) => {
            const photo = photos.get(id)?.studio;
            if (!photo) return null;
            return (
              <li key={id} className="bg-brand-tint relative aspect-square overflow-hidden rounded">
                <AdminPhotoImage
                  objectKey={photo.objectKey}
                  thumbObjectKey={photo.thumbObjectKey}
                  alt={photo.fileName}
                  sizes="80px"
                />
                <span className="text-caption absolute bottom-0.5 left-0.5 rounded-full bg-black/60 px-1.5 font-semibold text-white tabular-nums">
                  {i + 1}
                </span>
                <button
                  type="button"
                  onClick={() => onExclude(id)}
                  aria-label={`Vyřadit fotku ${photo.fileName}`}
                  className="absolute top-0.5 right-0.5 grid size-8 place-items-center rounded-full bg-black/55 text-white pointer-coarse:size-11"
                >
                  <span aria-hidden>×</span>
                </button>
              </li>
            );
          })}
        </ul>
      </details>

      <div className="mt-4 space-y-2">
        {busyHere ? (
          <div className="space-y-2" role="status">
            <p className="text-sm">
              {renderState.progress.step === "photos"
                ? `Načítám fotky ${renderState.progress.done}/${renderState.progress.total}`
                : `Vykresluji… ${Math.round(renderState.progress.share * 100)} %`}
            </p>
            <progress
              className="w-full"
              value={
                renderState.progress.step === "photos"
                  ? renderState.progress.done / Math.max(1, renderState.progress.total)
                  : renderState.progress.share
              }
              max={1}
            />
            <Button size="sm" variant="secondary" onClick={onCancel}>
              Zrušit
            </Button>
          </div>
        ) : (
          <Button className="w-full" disabled={!canRender || busyElsewhere} onClick={onRender}>
            {result
              ? "Vytvořit znovu"
              : silent
                ? "Vytvořit video bez zvuku"
                : "Vytvořit video se zvukem"}
          </Button>
        )}
        {renderState.kind === "error" && renderState.key === variant.key && (
          <Alert tone="danger" compact>
            Video se nepodařilo vytvořit — nejspíš se nenačetla některá fotka. Zkus to znovu,
            případně v Chrome.
          </Alert>
        )}
        {result && (
          <div className="space-y-2">
            <video
              src={result.url}
              controls
              playsInline
              className="mx-auto w-full max-w-[15rem] rounded bg-black"
            />
            <a
              href={result.url}
              download={result.file.name}
              className="border-brand-primary bg-brand-primary hover:bg-brand-primary-dark flex min-h-11 items-center justify-center rounded-lg border px-5 text-sm font-semibold text-white"
            >
              Stáhnout MP4 ({(result.file.size / 1024 / 1024).toFixed(0)} MB)
            </a>
            {silent && (
              <p className="text-admin-muted text-caption dark:text-neutral-400">
                Video je bez zvuku. V Instagramu přidej stejnou písničku a začátek posuň{" "}
                {startHint(
                  {
                    kind: trackKind ?? "file",
                    startAt: hintStartAt,
                    durationMs: hintDurationMs,
                    decodedMs: hintDecodedMs,
                  },
                  plan.offset,
                )}{" "}
                — první střih padne na první dobu taktu. Doladíš uchem.
              </p>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
