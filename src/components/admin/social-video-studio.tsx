"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import imageLoader from "@/lib/image-loader";
import { QUALITY } from "@/lib/image-sizes";
import type { TimelinePosition } from "@/lib/gallery-chapters";
import { FORMS, pluralize } from "@/lib/czech-plural";
import { slugify } from "@/lib/gallery-slug";
import { placeholderStyle } from "@/lib/placeholder";
import {
  directShots,
  FORMATS,
  planShot,
  sourceWidth,
  type Aspect,
} from "@/lib/social-video/camera";
import { createFaceFinder, type FaceFinder } from "@/lib/social-video/detect";
import { chooseCodec, encodeVideo, type EncodeCodec } from "@/lib/social-video/encode";
import { scanFaces } from "@/lib/social-video/face-scan";
import type { PhotoFaces } from "@/lib/social-video/faces";
import { drawFrame, type FramePlan } from "@/lib/social-video/frame";
import { SlideImages, type SlidePhoto } from "@/lib/social-video/slide-images";
import { suggestPhotos, type VideoCandidate } from "@/lib/social-video/suggest";
import {
  buildTimeline,
  LENGTHS,
  moveSeconds,
  photoCountFor,
  slidesAt,
  type Length,
} from "@/lib/social-video/timeline";
import { runUploads } from "@/lib/upload-run";
import { saveFaces } from "@/app/admin/social-video-actions";
import { AdminPhotoImage } from "@/components/admin/admin-photo-image";
import { SortableList } from "@/components/admin/sortable-list";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";

// docs/SOCIAL-VIDEO.md §2 is the flow this page follows: pick, faces, preview,
// render, download or add to the gallery. The camera, the timing and the
// frame itself live in src/lib/social-video/ — this is only their controls.

export interface StudioPhoto {
  id: string;
  objectKey: string;
  thumbObjectKey: string | null;
  fileName: string;
  placeholder: string | null;
  candidate: VideoCandidate;
}

/** The preview is drawn at this share of the output's size — it only has to
 * fill a column on screen, and a smaller canvas keeps the playback smooth. */
const PREVIEW_SCALE = 0.4;
/** Photos fetched at once while preparing. */
const FETCH_CONCURRENCY = 4;

const ASPECT_LABEL: Record<Aspect, string> = {
  "9:16": "Na výšku 9:16 · Reels, Stories",
  "16:9": "Na šířku 16:9 · web, YouTube",
};

interface Draft {
  aspect: Aspect;
  length: Length;
  order: string[];
}

const draftKey = (galleryId: string) => `g-gallery:social-video:${galleryId}`;

function readDraft(galleryId: string, known: Set<string>): Draft | null {
  try {
    const raw = localStorage.getItem(draftKey(galleryId));
    if (!raw) return null;
    const draft = JSON.parse(raw) as Draft;
    if (!(draft.aspect in FORMATS) || !LENGTHS.includes(draft.length)) return null;
    const order = draft.order.filter((id) => known.has(id));
    return order.length > 0 ? { ...draft, order } : null;
  } catch {
    return null;
  }
}

function writeDraft(galleryId: string, draft: Draft) {
  try {
    localStorage.setItem(draftKey(galleryId), JSON.stringify(draft));
  } catch {
    // Private mode or full storage: the draft is a convenience, not state.
  }
}

/** "… se nenačetla": the verb agrees with the count. */
const NOT_LOADED = {
  one: "fotka se nenačetla",
  few: "fotky se nenačetly",
  many: "fotek se nenačetlo",
};
/** After "z": the genitive. */
const PHOTO_GENITIVE = { one: "fotky", few: "fotek", many: "fotek" };

type Scan =
  | { kind: "idle" }
  | { kind: "running"; done: number; total: number }
  | { kind: "finished"; failed: number };

/** A photo's bytes at the size a 9:16 video fetches it — the default format,
 * so its render finds the transform already cached. */
async function fetchForFaces(photo: StudioPhoto): Promise<Blob> {
  const { width, height } = photo.candidate;
  const url = imageLoader({
    src: photo.objectKey,
    width: sourceWidth({ width: width!, height: height! }, FORMATS["9:16"]),
    quality: QUALITY,
  });
  const response = await fetch(url, { mode: "cors", credentials: "omit" });
  if (!response.ok) throw new Error(`PHOTO_${response.status}`);
  return response.blob();
}

type Status =
  | { kind: "idle" }
  | { kind: "preparing"; text: string }
  | { kind: "rendering"; share: number }
  | { kind: "uploading" };

interface Result {
  url: string;
  blob: Blob;
  codec: EncodeCodec;
  fileName: string;
}

export function SocialVideoStudio({
  galleryId,
  galleryTitle,
  photos,
  chapterStarts,
}: {
  galleryId: string;
  galleryTitle: string;
  photos: StudioPhoto[];
  chapterStarts: TimelinePosition[];
}) {
  const byId = useMemo(() => new Map(photos.map((p) => [p.id, p])), [photos]);
  const [faces, setFaces] = useState<Record<string, PhotoFaces | null>>(() =>
    Object.fromEntries(photos.map((p) => [p.id, p.candidate.faces])),
  );
  const [aspect, setAspect] = useState<Aspect>("9:16");
  const [length, setLength] = useState<Length>(15);
  const [order, setOrder] = useState<string[]>([]);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [added, setAdded] = useState(false);
  const [codec, setCodec] = useState<EncodeCodec | null | undefined>(undefined);
  const [picking, setPicking] = useState(false);
  const [playing, setPlaying] = useState(true);
  const format = FORMATS[aspect];

  const candidatesNow = useCallback(
    () => photos.map((p) => ({ ...p.candidate, faces: faces[p.id] ?? null })),
    [photos, faces],
  );

  const suggest = useCallback(
    (forAspect: Aspect, forLength: Length) =>
      suggestPhotos(candidatesNow(), chapterStarts, FORMATS[forAspect], photoCountFor(forLength)),
    [candidatesNow, chapterStarts],
  );

  // The last draft of this gallery, or a fresh suggestion. In an effect, not
  // in useState's initialiser: localStorage does not exist on the server.
  useEffect(() => {
    const draft = readDraft(galleryId, new Set(byId.keys()));
    /* eslint-disable react-hooks/set-state-in-effect -- one-time restore after mount */
    if (draft) {
      setAspect(draft.aspect);
      setLength(draft.length);
      setOrder(draft.order);
    } else {
      setOrder(suggest("9:16", 15));
    }
    /* eslint-enable react-hooks/set-state-in-effect */
    // Once, on mount — later suggestions are the photographer's call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (order.length > 0) writeDraft(galleryId, { aspect, length, order });
  }, [galleryId, aspect, length, order]);

  useEffect(() => {
    let live = true;
    void chooseCodec(format.width, format.height).then((c) => live && setCodec(c));
    return () => {
      live = false;
    };
  }, [format.width, format.height]);

  // ---- The plan: photos → timeline → camera moves ----
  const timeline = useMemo(() => buildTimeline(order.length, length), [order.length, length]);
  const slidePhotos: SlidePhoto[] = useMemo(
    () =>
      order.flatMap((id) => {
        const photo = byId.get(id);
        const { width, height } = photo?.candidate ?? {};
        if (!photo || !width || !height) return [];
        return [
          {
            id,
            width,
            height,
            url: imageLoader({
              src: photo.objectKey,
              width: sourceWidth({ width, height }, format),
              quality: QUALITY,
            }),
          },
        ];
      }),
    [order, byId, format],
  );
  const shots = useMemo(() => {
    const seconds = moveSeconds(timeline);
    return directShots(
      slidePhotos.map((p, i) =>
        planShot(
          { width: p.width, height: p.height, faces: faces[p.id]?.faces ?? [] },
          format,
          seconds[i] ?? seconds.at(-1) ?? 3,
        ),
      ),
      slidePhotos.map((p) => faces[p.id]?.faces.length ?? 0),
    );
  }, [slidePhotos, faces, format, timeline]);

  // ---- Photos in memory: one store per format (the fetch size differs) ----
  // Closing only clears the store's caches, so a store React reuses after a
  // dev-mode remount still works — it fetches again.
  const images = useMemo(() => new SlideImages(format), [format]);
  useEffect(() => () => images.close(), [images]);

  const planWith = useCallback(
    (store: SlideImages, planFormat = format): FramePlan => ({
      format: planFormat,
      timeline,
      slides: slidePhotos.map((p, i) => ({
        image: store.imageOf(p.id),
        width: p.width,
        height: p.height,
        shot: shots[i]!,
        backdrop:
          shots[i]!.kind === "fit"
            ? (store.backdropOf(p.id, p.width, p.height) ?? undefined)
            : undefined,
      })),
    }),
    [format, timeline, slidePhotos, shots],
  );

  // ---- Prepare: fetch every picked photo, find faces where none are stored ----
  // One face worker for the page — the picked photos and the whole-gallery
  // scan queue in it — started on first use.
  const finderRef = useRef<FaceFinder | null>(null);
  const finder = useCallback(() => (finderRef.current ??= createFaceFinder()), []);
  useEffect(
    () => () => {
      finderRef.current?.close();
      finderRef.current = null;
    },
    [],
  );
  const prepared = useRef(new Set<string>());
  useEffect(() => {
    if (!images) return;
    prepared.current = new Set();
  }, [images]);

  useEffect(() => {
    if (!images || slidePhotos.length === 0) return;
    const missing = slidePhotos.filter((p) => !prepared.current.has(p.id));
    if (missing.length === 0) return;
    let cancelled = false;

    void (async () => {
      setError(null);
      let done = 0;
      setStatus({ kind: "preparing", text: `Načítám fotky 0/${missing.length}` });
      const queue = [...missing];
      const failed: string[] = [];
      await Promise.all(
        Array.from({ length: FETCH_CONCURRENCY }, async () => {
          for (let p = queue.shift(); p; p = queue.shift()) {
            try {
              await images.fetch(p);
            } catch {
              failed.push(p.id);
            }
            done += 1;
            if (!cancelled) {
              setStatus({ kind: "preparing", text: `Načítám fotky ${done}/${missing.length}` });
            }
          }
        }),
      );
      if (cancelled) return;
      if (failed.length > 0) {
        setError(
          `${pluralize(failed.length, NOT_LOADED)} — ` +
            "nejspíš chybí CORS pravidlo GET na úložišti (docs/SETUP.md §3). Video je bez nich.",
        );
      }

      const unknown = missing.filter((p) => !failed.includes(p.id) && !faces[p.id]);
      const found: { photoId: string; faces: PhotoFaces }[] = [];
      if (unknown.length > 0) {
        setStatus({ kind: "preparing", text: "Načítám rozpoznávání tváří…" });
        try {
          for (const [i, p] of unknown.entries()) {
            if (cancelled) return;
            setStatus({ kind: "preparing", text: `Hledám tváře ${i + 1}/${unknown.length}` });
            found.push({ photoId: p.id, faces: await finder().find(await images.fetch(p)) });
          }
        } catch (cause) {
          // The worker stays: a gallery-wide search may be queued in it, and
          // it tries a failed start again on the next photo.
          console.warn("[g-gallery/social-video] face detection unavailable", cause);
          setNotice("Tváře se nepodařilo rozpoznat — kamera u těch fotek míří na střed.");
        }
      }
      for (const p of missing) prepared.current.add(p.id);
      if (cancelled) return;
      if (found.length > 0) {
        setFaces((prev) => ({
          ...prev,
          ...Object.fromEntries(found.map((f) => [f.photoId, f.faces])),
        }));
        // Stored so the next video of this gallery skips the detection; a
        // failure here costs only that.
        saveFaces(galleryId, found).catch((cause) =>
          console.warn("[g-gallery/social-video] faces not saved", cause),
        );
      }
      setStatus({ kind: "idle" });
    })();
    return () => {
      cancelled = true;
    };
    // `faces` is read for the photos being prepared, not a reason to prepare again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images, slidePhotos, galleryId, finder]);

  /** The photos on screen at `t` and the one after — what must be decoded. */
  const onScreen = useCallback(
    (t: number) => {
      const visible = slidesAt(timeline, t).map((v) => v.index);
      const next = visible.length > 0 ? Math.max(...visible) + 1 : 0;
      return [...new Set([...visible, next])]
        .filter((i) => i >= 0 && i < slidePhotos.length)
        .map((i) => slidePhotos[i]!);
    },
    [timeline, slidePhotos],
  );

  // ---- Preview: the same drawFrame, at a fraction of the size ----
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Time lives in a ref and is painted straight into the slider and the label:
  // React state here would re-render the whole page sixty times a second.
  const timeRef = useRef(0);
  const sliderRef = useRef<HTMLInputElement>(null);
  const clockRef = useRef<HTMLSpanElement>(null);
  const busy = status.kind !== "idle";
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !images || busy || timeline.duration === 0) return;
    const previewFormat = {
      ...format,
      width: Math.round(format.width * PREVIEW_SCALE),
      height: Math.round(format.height * PREVIEW_SCALE),
    };
    canvas.width = previewFormat.width;
    canvas.height = previewFormat.height;
    let frame = 0;
    let windowKey = "";
    let last = performance.now();
    const tick = (now: number) => {
      if (playing) timeRef.current = (timeRef.current + (now - last) / 1000) % timeline.duration;
      last = now;
      const t = timeRef.current;
      // Decode what is on screen and the slide after it; release the rest.
      const wanted = onScreen(t);
      const key = wanted.map((p) => p.id).join();
      if (key !== windowKey) {
        windowKey = key;
        void images.keepOnly(wanted).catch(() => {});
      }
      drawFrame(ctx, planWith(images, previewFormat), t);
      if (sliderRef.current) sliderRef.current.value = String(t);
      if (clockRef.current) clockRef.current.textContent = `${t.toFixed(1)} s`;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [images, busy, playing, timeline, onScreen, planWith, format]);

  // ---- Render ----
  const abortRef = useRef<AbortController | null>(null);
  const render = async () => {
    if (!images || !codec) return;
    setError(null);
    setAdded(false);
    if (result) URL.revokeObjectURL(result.url);
    setResult(null);
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus({ kind: "rendering", share: 0 });
    let windowKey = "";
    try {
      const blob = await encodeVideo({
        width: format.width,
        height: format.height,
        duration: timeline.duration,
        codec,
        signal: controller.signal,
        onProgress: (share) => setStatus({ kind: "rendering", share }),
        drawAt: async (ctx, t) => {
          const wanted = onScreen(t);
          const key = wanted.map((p) => p.id).join();
          if (key !== windowKey) {
            windowKey = key;
            await images.keepOnly(wanted);
          }
          drawFrame(ctx, planWith(images), t);
        },
      });
      const name = `${slugify(galleryTitle) || "video"}-${aspect === "9:16" ? "9x16" : "16x9"}-${length}s.mp4`;
      setResult({ url: URL.createObjectURL(blob), blob, codec, fileName: name });
    } catch (cause) {
      if (!controller.signal.aborted) {
        console.error("[g-gallery/social-video] render failed", cause);
        setError("Video se nepodařilo vykreslit. Zkus to znovu, případně v Chrome.");
      }
    } finally {
      abortRef.current = null;
      setStatus({ kind: "idle" });
    }
  };

  const addToGallery = async () => {
    if (!result) return;
    setError(null);
    setStatus({ kind: "uploading" });
    const file = new File([result.blob], result.fileName, { type: "video/mp4" });
    let ok = false;
    await runUploads({
      files: [file],
      credentials: { kind: "owner", galleryId },
      resumeIds: [undefined],
      onItem: (_, patch) => {
        if (patch.state === "done") ok = true;
        if (patch.state === "error") setError(`Nahrání se nepovedlo (${patch.error ?? "chyba"}).`);
      },
      onFatal: (rejection) => setError(`Nahrání se nepovedlo (${rejection.code}).`),
    });
    setAdded(ok);
    setStatus({ kind: "idle" });
  };

  useEffect(() => () => abortRef.current?.abort(), []);

  // ---- Faces for the whole gallery, on a click (docs/SOCIAL-VIDEO.md §4) ----
  const [scan, setScan] = useState<Scan>({ kind: "idle" });
  const scanAbortRef = useRef<AbortController | null>(null);
  useEffect(() => () => scanAbortRef.current?.abort(), []);
  const withFaces = photos.filter((p) => faces[p.id]).length;
  const findAllFaces = async () => {
    const missing = photos.filter((p) => !faces[p.id]);
    if (missing.length === 0) return;
    const controller = new AbortController();
    scanAbortRef.current = controller;
    setScan({ kind: "running", done: 0, total: missing.length });
    try {
      const { failed } = await scanFaces({
        photos: missing,
        fetchPhoto: fetchForFaces,
        find: (blob) => finder().find(blob),
        save: (entries) => saveFaces(galleryId, entries),
        onFound: (entries) =>
          setFaces((prev) => ({
            ...prev,
            ...Object.fromEntries(entries.map((e) => [e.photoId, e.faces])),
          })),
        onProgress: ({ done, total }) => setScan({ kind: "running", done, total }),
        signal: controller.signal,
      });
      setScan(controller.signal.aborted ? { kind: "idle" } : { kind: "finished", failed });
    } catch (cause) {
      console.warn("[g-gallery/social-video] face scan failed", cause);
      setScan({ kind: "idle" });
      setError("Tváře se nepodařilo uložit — zkus hledání spustit znovu, naváže, kde skončilo.");
    } finally {
      scanAbortRef.current = null;
    }
  };

  // ---- Editing the selection ----
  const selected = new Set(order);
  const toggle = (id: string) => {
    setOrder((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };
  const reSuggest = (nextAspect = aspect, nextLength = length) =>
    setOrder(suggest(nextAspect, nextLength));

  const seconds = timeline.duration;
  const stripItems = order.flatMap((id) => {
    const photo = byId.get(id);
    return photo ? [photo] : [];
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <div className="min-w-0 space-y-6">
        <Card>
          <CardTitle>Formát a délka</CardTitle>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Formát">
            {(Object.keys(FORMATS) as Aspect[]).map((a) => (
              <Button
                key={a}
                role="radio"
                aria-checked={aspect === a}
                variant={aspect === a ? "primary" : "secondary"}
                disabled={busy}
                onClick={() => setAspect(a)}
              >
                {ASPECT_LABEL[a]}
              </Button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Délka">
            {LENGTHS.map((l) => (
              <Button
                key={l}
                role="radio"
                aria-checked={length === l}
                variant={length === l ? "primary" : "secondary"}
                disabled={busy}
                onClick={() => setLength(l)}
              >
                {l} s · cca {photoCountFor(l)} fotek
              </Button>
            ))}
          </div>
        </Card>

        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="mb-0">
              Fotky ve videu ({order.length}) · {seconds.toFixed(0)} s
            </CardTitle>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => reSuggest()}>
                Navrhnout znovu
              </Button>
              <Button
                size="sm"
                variant="secondary"
                aria-expanded={picking}
                onClick={() => setPicking((v) => !v)}
              >
                {picking ? "Hotovo" : "Přidat nebo odebrat fotky"}
              </Button>
            </div>
          </div>
          <p className="text-admin-muted text-caption mb-3 dark:text-neutral-400">
            Pořadí změníš přetažením (na telefonu za ⠿), nebo šipkami na klávesnici. První a
            poslední fotka jsou ty nejsilnější.
          </p>
          <SortableList
            items={stripItems}
            label="Pořadí fotek ve videu"
            itemName={(photo, index) => `Fotka ${index + 1} (${photo.fileName})`}
            onReorder={(next) => setOrder(next.map((p) => p.id))}
            className="grid grid-cols-3 gap-2 sm:grid-cols-5 xl:grid-cols-7"
            renderItem={(photo, index) => (
              <div
                className="bg-brand-tint relative aspect-square overflow-hidden rounded"
                style={
                  photo.placeholder
                    ? { backgroundColor: placeholderStyle(photo.placeholder) }
                    : undefined
                }
              >
                <AdminPhotoImage
                  objectKey={photo.objectKey}
                  thumbObjectKey={photo.thumbObjectKey}
                  alt={photo.fileName}
                  sizes="(max-width: 640px) 33vw, 140px"
                />
                <span className="text-caption absolute bottom-1 left-1 rounded-full bg-black/60 px-2 py-0.5 font-semibold text-white tabular-nums">
                  {index + 1}
                </span>
                <button
                  type="button"
                  aria-label={`Odebrat z videa: ${photo.fileName}`}
                  disabled={busy}
                  onClick={() => toggle(photo.id)}
                  className="absolute top-1 right-1 grid size-8 place-items-center rounded-full bg-black/55 text-white pointer-coarse:size-11"
                >
                  <span aria-hidden>×</span>
                </button>
              </div>
            )}
          />
          {picking && (
            <div className="mt-4 max-h-[28rem] overflow-y-auto">
              <ul className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 xl:grid-cols-8">
                {photos.map((photo) => {
                  const position = order.indexOf(photo.id);
                  return (
                    <li key={photo.id}>
                      <button
                        type="button"
                        aria-pressed={selected.has(photo.id)}
                        aria-label={`${selected.has(photo.id) ? "Odebrat" : "Přidat"}: ${photo.fileName}`}
                        disabled={busy}
                        onClick={() => toggle(photo.id)}
                        className="bg-brand-tint aria-pressed:ring-brand-primary relative block aspect-square w-full overflow-hidden rounded aria-pressed:ring-4 aria-pressed:ring-inset"
                      >
                        <AdminPhotoImage
                          objectKey={photo.objectKey}
                          thumbObjectKey={photo.thumbObjectKey}
                          alt=""
                          sizes="(max-width: 640px) 25vw, 110px"
                        />
                        {position >= 0 && (
                          <span className="bg-brand-primary text-caption absolute top-1 left-1 rounded-full px-2 py-0.5 font-semibold text-white tabular-nums">
                            {position + 1}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </Card>

        <Card>
          <CardTitle>Tváře v galerii</CardTitle>
          <p className="mb-3">
            Tváře známe u {withFaces} z {pluralize(photos.length, PHOTO_GENITIVE)}.
          </p>
          <p className="text-admin-muted text-caption mb-3 dark:text-neutral-400">
            Podle nich návrh vybírá fotky a kamera míří na lidi. U fotek ve videu se hledají samy;
            pro celou galerii hledání spusť tady. Běží v prohlížeči na pozadí — u 400 fotek pět až
            deset minut — a stránku můžeš dál používat. Co najde, se ukládá průběžně.
          </p>
          {scan.kind === "running" ? (
            <div className="space-y-2" role="status">
              <p>
                Hledám tváře {scan.done}/{scan.total}
              </p>
              <progress className="w-full" value={scan.done} max={scan.total} />
              <Button size="sm" variant="secondary" onClick={() => scanAbortRef.current?.abort()}>
                Pozastavit
              </Button>
            </div>
          ) : (
            <Button
              variant="secondary"
              disabled={withFaces === photos.length}
              onClick={() => void findAllFaces()}
            >
              {withFaces === photos.length
                ? "Tváře jsou u všech fotek"
                : `Najít tváře (${pluralize(photos.length - withFaces, FORMS.photo)})`}
            </Button>
          )}
          {scan.kind === "finished" && (
            <p className="text-caption mt-3" role="status">
              Hotovo. Návrh teď počítá s tvářemi — zkus „Navrhnout znovu“.
              {scan.failed > 0 &&
                ` ${pluralize(scan.failed, NOT_LOADED)}, zkusí se při dalším hledání.`}
            </p>
          )}
        </Card>
      </div>

      <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
        <Card>
          <CardTitle>Náhled</CardTitle>
          <div
            className={`mx-auto overflow-hidden rounded bg-black ${aspect === "9:16" ? "aspect-[9/16] max-w-[18rem]" : "aspect-video"}`}
          >
            <canvas ref={canvasRef} className="size-full" aria-label="Náhled videa" role="img" />
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setPlaying((p) => !p)}
              disabled={busy}
            >
              {playing ? "Pozastavit" : "Přehrát"}
            </Button>
            <input
              ref={sliderRef}
              type="range"
              min={0}
              max={Math.max(0, seconds - 0.01)}
              step={0.01}
              defaultValue={0}
              aria-label="Čas v náhledu"
              disabled={busy}
              onChange={(e) => {
                timeRef.current = Number(e.target.value);
                setPlaying(false);
              }}
              className="accent-brand-primary min-w-0 flex-1"
            />
            <span ref={clockRef} className="text-caption w-12 text-right tabular-nums">
              0.0 s
            </span>
          </div>
          {status.kind === "preparing" && (
            <p className="text-caption mt-3" role="status">
              {status.text}
            </p>
          )}
        </Card>

        <Card>
          <CardTitle>Video</CardTitle>
          {codec === null ? (
            <Alert>
              Tenhle prohlížeč neumí video vytvořit (chybí WebCodecs). Otevři stránku v Chrome nebo
              v Safari 26+.
            </Alert>
          ) : status.kind === "rendering" ? (
            <div className="space-y-2" role="status">
              <p>Vykresluji… {Math.round(status.share * 100)} %</p>
              <progress className="w-full" value={status.share} max={1} />
              <p className="text-admin-muted text-caption dark:text-neutral-400">
                Nech tuhle kartu otevřenou, video vzniká přímo v prohlížeči.
              </p>
              <Button variant="secondary" size="sm" onClick={() => abortRef.current?.abort()}>
                Zrušit
              </Button>
            </div>
          ) : (
            <Button
              size="lg"
              className="w-full"
              disabled={busy || order.length < 2 || !codec}
              onClick={() => void render()}
            >
              Vytvořit video ({format.width}×{format.height}, {seconds.toFixed(0)} s)
            </Button>
          )}

          {result && (
            <div className="mt-4 space-y-3">
              <video
                src={result.url}
                controls
                muted
                playsInline
                className={`mx-auto w-full rounded bg-black ${aspect === "9:16" ? "max-w-[18rem]" : ""}`}
              />
              <a
                href={result.url}
                download={result.fileName}
                className="border-brand-primary bg-brand-primary hover:bg-brand-primary-dark flex min-h-11 items-center justify-center rounded-lg border px-5 text-sm font-semibold text-white"
              >
                Stáhnout MP4
              </a>
              {result.codec === "avc" ? (
                <Button
                  variant="secondary"
                  className="w-full"
                  disabled={busy || added}
                  onClick={() => void addToGallery()}
                >
                  {added
                    ? "Přidáno do galerie ✓"
                    : status.kind === "uploading"
                      ? "Nahrávám…"
                      : "Přidat do galerie jako video"}
                </Button>
              ) : (
                <p className="text-admin-muted text-caption dark:text-neutral-400">
                  Tenhle prohlížeč umí jen VP9 — video stáhneš a nahraješ na sítě, ale do galerie
                  patří jen H.264. Pro přidání do galerie ho vytvoř v Chrome nebo Safari na Macu.
                </p>
              )}
            </div>
          )}
          {notice && (
            <Alert tone="info" compact className="mt-3">
              {notice}
            </Alert>
          )}
          {error && (
            <Alert tone="danger" compact className="mt-3">
              {error}
            </Alert>
          )}
        </Card>
      </div>
    </div>
  );
}
