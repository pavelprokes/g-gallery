"use client";

// The public slideshow maker (docs/SLIDESHOW-MAKER.md): the admin's social
// video pipeline — the face worker, the camera, `drawFrame`, the encoder — run
// on a visitor's own photos, entirely in their browser. Nothing is uploaded,
// stored or sent anywhere; closing the page is deleting everything.

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { buttonClasses } from "@/components/ui/button";
import { checkPhoto } from "@/lib/photo-check";
import { type Aspect } from "@/lib/social-video/camera";
import { createFaceFinder, type FaceFinder } from "@/lib/social-video/detect";
import { chooseCodec, encodeVideo, type EncodeCodec } from "@/lib/social-video/encode";
import type { PhotoFaces } from "@/lib/social-video/faces";
import { drawFrame, type FramePlan } from "@/lib/social-video/frame";
import { shotsFor } from "@/lib/social-video/shots";
import { SlideImages } from "@/lib/social-video/slide-images";
import { buildTimeline, slidesAt } from "@/lib/social-video/timeline";
import {
  byName,
  byTakenAt,
  preparePhoto,
  type IntakeProblem,
  type PreparedPhoto,
} from "@/lib/slideshow/intake";
import { ACCEPTED_TYPES, MAX_PHOTOS, MIN_PHOTOS, room } from "@/lib/slideshow/limits";
import { formatFor, keptLength, lengthOptions, PACINGS, type Mode } from "@/lib/slideshow/pacing";

type Order = "time" | "name";

type Status =
  | { kind: "idle" }
  | { kind: "preparing"; done: number; total: number }
  | { kind: "checking"; done: number; total: number }
  | { kind: "rendering"; share: number };

interface Rejected {
  name: string;
  problem: IntakeProblem;
}

interface Result {
  url: string;
  fileName: string;
  seconds: number;
}

/** The preview is drawn at this share of the video's size. */
const PREVIEW_SCALE = 0.4;
/** Photos decoded and shrunk at once — enough to keep a desktop busy without
 * a phone holding several full-size decodes in memory. */
const PREPARE_CONCURRENCY = 2;

let nextId = 0;

const action = (...args: Parameters<typeof buttonClasses>) =>
  `${buttonClasses(...args)} disabled:cursor-not-allowed disabled:opacity-55`;

export function SlideshowMaker() {
  const t = useTranslations("slideshowMaker.tool");
  const [photos, setPhotos] = useState<PreparedPhoto[]>([]);
  const [faces, setFaces] = useState<Record<string, PhotoFaces | null>>({});
  const [rejected, setRejected] = useState<Rejected[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<Order>("time");
  const [aspect, setAspect] = useState<Aspect>("9:16");
  const [mode, setMode] = useState<Mode>("normal");
  const [wantedLength, setWantedLength] = useState<number | null>(null);
  const [playing, setPlaying] = useState(true);
  const [result, setResult] = useState<Result | null>(null);
  const [dragging, setDragging] = useState(false);
  const [images] = useState(() => new SlideImages());
  const finderRef = useRef<FaceFinder | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const photosRef = useRef<PreparedPhoto[]>([]);
  const resultRef = useRef<Result | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);
  useEffect(() => {
    resultRef.current = result;
  }, [result]);

  // Leaving the page drops every photo, the worker and the video with it.
  useEffect(
    () => () => {
      abortRef.current?.abort();
      finderRef.current?.close();
      images.close();
      for (const p of photosRef.current) {
        URL.revokeObjectURL(p.url);
        URL.revokeObjectURL(p.thumbUrl);
      }
      if (resultRef.current) URL.revokeObjectURL(resultRef.current.url);
    },
    [images],
  );

  const ordered = useMemo(
    () => [...photos].sort(order === "time" ? byTakenAt : byName),
    [photos, order],
  );
  const count = ordered.length;
  const format = formatFor(aspect, mode);
  const lengths = useMemo(() => lengthOptions(Math.max(count, 1), mode), [count, mode]);
  const length = keptLength(wantedLength ?? 0, Math.max(count, 1), mode);
  const timeline = useMemo(
    () => buildTimeline(count, length, PACINGS[mode]),
    [count, length, mode],
  );
  const shots = useMemo(
    () => shotsFor(ordered, faces, format, timeline),
    [ordered, faces, format, timeline],
  );
  const flagged = useMemo(
    () =>
      new Set(
        photos
          .filter((p) => {
            const found = faces[p.id];
            return found ? checkPhoto(found.faces, p.width, p.height).closed.length > 0 : false;
          })
          .map((p) => p.id),
      ),
    [photos, faces],
  );

  const clearResult = useCallback(() => {
    setResult((previous) => {
      if (previous) URL.revokeObjectURL(previous.url);
      return null;
    });
  }, []);

  const addFiles = async (list: FileList | File[]) => {
    if (status.kind !== "idle") return;
    const files = [...list].filter((f) => f.type.startsWith("image/") || f.type === "");
    const fits = room(photosRef.current.length, files.length);
    setSkipped(files.length - fits);
    setRejected([]);
    setError(null);
    setNotice(null);
    if (fits === 0) return;
    clearResult();

    const taken = files.slice(0, fits);
    const ready: PreparedPhoto[] = [];
    const refused: Rejected[] = [];
    let done = 0;
    setStatus({ kind: "preparing", done, total: taken.length });
    const queue = [...taken];
    await Promise.all(
      Array.from({ length: PREPARE_CONCURRENCY }, async () => {
        for (let file = queue.shift(); file; file = queue.shift()) {
          const outcome = await preparePhoto(file, `p${nextId++}`);
          if (outcome.ok) ready.push(outcome.photo);
          else refused.push({ name: outcome.name, problem: outcome.problem });
          setStatus({ kind: "preparing", done: ++done, total: taken.length });
        }
      }),
    );
    setRejected(refused);
    setPhotos((prev) => [...prev, ...ready]);

    // The check runs photo by photo in a worker; the photos are usable
    // before it ends, and a photo it could not read is simply not marked.
    finderRef.current ??= createFaceFinder();
    let failed = false;
    for (const [i, photo] of ready.entries()) {
      setStatus({ kind: "checking", done: i, total: ready.length });
      if (failed) break;
      try {
        const found = await finderRef.current.find(photo.blob);
        setFaces((prev) => ({ ...prev, [photo.id]: found }));
      } catch (cause) {
        console.warn("[g-gallery/slideshow] photo check unavailable", cause);
        failed = true;
        setNotice(t("checkUnavailable"));
      }
    }
    setStatus({ kind: "idle" });
  };

  const removePhotos = (ids: ReadonlySet<string>) => {
    clearResult();
    setPhotos((prev) =>
      prev.filter((p) => {
        if (!ids.has(p.id)) return true;
        images.drop(p.id);
        URL.revokeObjectURL(p.url);
        URL.revokeObjectURL(p.thumbUrl);
        return false;
      }),
    );
  };

  const startOver = () => {
    removePhotos(new Set(photos.map((p) => p.id)));
    setFaces({});
    setRejected([]);
    setSkipped(0);
    setNotice(null);
    setError(null);
  };

  const planWith = useCallback(
    (scale: number): FramePlan => {
      const scaled = {
        ...format,
        width: Math.round(format.width * scale),
        height: Math.round(format.height * scale),
      };
      return {
        format: scaled,
        timeline,
        slides: ordered.map((p, i) => ({
          image: images.imageOf(p.id),
          width: p.width,
          height: p.height,
          shot: shots[i]!,
          backdrop: shots[i]!.kind === "fit" ? (images.backdropOf(p.id) ?? undefined) : undefined,
        })),
      };
    },
    [format, timeline, ordered, images, shots],
  );

  /** The photos on screen at `t` and the one after — what must be decoded. */
  const onScreen = useCallback(
    (at: number) => {
      const visible = slidesAt(timeline, at).map((v) => v.index);
      const next = visible.length > 0 ? Math.max(...visible) + 1 : 0;
      return [...new Set([...visible, next])]
        .filter((i) => i >= 0 && i < ordered.length)
        .map((i) => ordered[i]!);
    },
    [timeline, ordered],
  );

  // ---- Preview: the same drawFrame as the file, at a fraction of the size ----
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timeRef = useRef(0);
  const sliderRef = useRef<HTMLInputElement>(null);
  const canPreview = count >= MIN_PHOTOS && status.kind !== "rendering";
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !canPreview || timeline.duration === 0) return;
    const plan = planWith(PREVIEW_SCALE);
    canvas.width = plan.format.width;
    canvas.height = plan.format.height;
    let frame = 0;
    let windowKey = "";
    let last = performance.now();
    const tick = (now: number) => {
      if (playing) timeRef.current = (timeRef.current + (now - last) / 1000) % timeline.duration;
      last = now;
      const at = Math.min(timeRef.current, timeline.duration);
      const wanted = onScreen(at);
      const key = wanted.map((p) => p.id).join();
      if (key !== windowKey) {
        windowKey = key;
        void images.keepOnly(wanted).catch(() => {});
      }
      drawFrame(ctx, planWith(PREVIEW_SCALE), at);
      if (sliderRef.current) sliderRef.current.value = String(at);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [canPreview, playing, timeline, onScreen, planWith, images]);

  // ---- The file ----
  const create = async () => {
    setError(null);
    clearResult();
    const codec: EncodeCodec | null = await chooseCodec(format.width, format.height);
    if (!codec) {
      setError(t("unsupported"));
      return;
    }
    setNotice(codec === "vp9" ? t("vp9Note") : null);
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
        drawAt: async (ctx, at) => {
          const wanted = onScreen(at);
          const key = wanted.map((p) => p.id).join();
          if (key !== windowKey) {
            windowKey = key;
            await images.keepOnly(wanted);
          }
          drawFrame(ctx, planWith(1), at);
        },
      });
      const tag = aspect === "9:16" ? "9x16" : "16x9";
      setResult({
        url: URL.createObjectURL(blob),
        fileName: `video-z-fotek-${tag}-${Math.round(timeline.duration)}s.mp4`,
        seconds: Math.round(timeline.duration),
      });
    } catch (cause) {
      if (!controller.signal.aborted) {
        console.error("[g-gallery/slideshow] render failed", cause);
        setError(t("renderFailed"));
      }
    } finally {
      abortRef.current = null;
      setStatus({ kind: "idle" });
    }
  };

  const busy = status.kind !== "idle";
  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    void addFiles(event.dataTransfer.files);
  };

  const choice = (selected: boolean) =>
    `flex min-h-11 flex-col items-start justify-center rounded-lg border px-3 py-2 text-left text-sm ${
      selected
        ? "border-brand-primary bg-brand-tint text-brand-ink dark:bg-neutral-900 dark:text-neutral-100"
        : "border-brand-border/70 text-neutral-700 hover:border-brand-primary dark:border-neutral-700 dark:text-neutral-300"
    }`;
  const lengthLabel = (seconds: number) =>
    seconds >= 60 && seconds % 60 === 0
      ? t("minutes", { minutes: seconds / 60 })
      : t("seconds", { seconds });

  return (
    <div className="grid gap-6">
      <label
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center ${
          dragging
            ? "border-brand-primary bg-brand-tint dark:bg-neutral-900"
            : "border-brand-border dark:border-neutral-700"
        } ${busy || count >= MAX_PHOTOS ? "pointer-events-none opacity-60" : ""}`}
      >
        <span className={buttonClasses(count > 0 ? "secondary" : "primary", "lg")}>
          {count > 0 ? t("addPhotos") : t("pickPhotos")}
        </span>
        <span className="text-sm text-neutral-600 dark:text-neutral-400">{t("dropHint")}</span>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED_TYPES.join(",")}
          disabled={busy || count >= MAX_PHOTOS}
          className="sr-only"
          onChange={(event) => {
            const files = event.target.files;
            if (files) void addFiles([...files]);
            event.target.value = "";
          }}
        />
      </label>

      <div aria-live="polite" className="grid gap-2 text-sm">
        {status.kind === "preparing" && (
          <p>{t("preparing", { done: status.done, total: status.total })}</p>
        )}
        {status.kind === "checking" && (
          <p>{t("checking", { done: status.done, total: status.total })}</p>
        )}
        {count > 0 && count < MIN_PHOTOS && !busy && (
          <p>{t("needMore", { count: MIN_PHOTOS - count, min: MIN_PHOTOS })}</p>
        )}
        {count >= MAX_PHOTOS && <p>{t("full", { max: MAX_PHOTOS })}</p>}
        {skipped > 0 && <p>{t("skipped", { count: skipped, max: MAX_PHOTOS })}</p>}
        {notice && <p>{notice}</p>}
        {error && (
          <p role="alert" className="text-red-700 dark:text-red-400">
            {error}
          </p>
        )}
      </div>

      {rejected.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950">
          <p className="font-medium">{t("rejectedHeading")}</p>
          <ul className="mt-1 list-disc pl-5">
            {rejected.map((r, i) => (
              <li key={`${r.name}-${i}`}>
                {r.name} – {t(`problem.${r.problem}`)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {count > 0 && (
        <section aria-label={t("photoCount", { count })} className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-brand-ink font-medium dark:text-neutral-100">
              {t("photoCount", { count })}
            </p>
            <button
              type="button"
              onClick={startOver}
              disabled={busy}
              className={action("ghost", "sm")}
            >
              {t("startOver")}
            </button>
          </div>
          {flagged.size > 0 && (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <p>{t("flaggedCount", { count: flagged.size })}</p>
              <button
                type="button"
                disabled={busy}
                onClick={() => removePhotos(flagged)}
                className={action("secondary", "sm")}
              >
                {t("removeFlagged")}
              </button>
            </div>
          )}
          <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6">
            {ordered.map((p) => (
              <li key={p.id} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL, never a CDN photo */}
                <img
                  src={p.thumbUrl}
                  alt={p.name}
                  className="aspect-square w-full rounded-md object-cover"
                />
                {flagged.has(p.id) && (
                  <span
                    title={t("flaggedHint")}
                    className="absolute bottom-1 left-1 rounded bg-amber-400 px-1.5 py-0.5 text-[11px] font-semibold text-neutral-900"
                  >
                    {t("flagged")}
                    <span className="sr-only">: {t("flaggedHint")}</span>
                  </span>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => removePhotos(new Set([p.id]))}
                  aria-label={t("remove", { name: p.name })}
                  className="absolute top-1 right-1 flex size-8 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
                >
                  <span aria-hidden>×</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {count >= MIN_PHOTOS && (
        <div className="grid gap-6 md:grid-cols-[1fr_auto] md:items-start">
          <div className="grid gap-5">
            <fieldset>
              <legend className="text-brand-ink mb-2 text-sm font-medium dark:text-neutral-100">
                {t("aspectLabel")}
              </legend>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ["9:16", t("aspectVertical"), t("aspectVerticalHint")],
                    ["16:9", t("aspectHorizontal"), t("aspectHorizontalHint")],
                  ] as const
                ).map(([value, label, hint]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={aspect === value}
                    disabled={busy}
                    onClick={() => {
                      setAspect(value);
                      clearResult();
                    }}
                    className={choice(aspect === value)}
                  >
                    <span className="font-medium">{label}</span>
                    <span className="text-xs text-neutral-500">{hint}</span>
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className="text-brand-ink mb-2 text-sm font-medium dark:text-neutral-100">
                {t("modeLabel")}
              </legend>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ["normal", t("modeNormal"), t("modeNormalHint")],
                    ["dynamic", t("modeDynamic"), t("modeDynamicHint")],
                  ] as const
                ).map(([value, label, hint]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={mode === value}
                    disabled={busy}
                    onClick={() => {
                      setMode(value);
                      clearResult();
                    }}
                    className={choice(mode === value)}
                  >
                    <span className="font-medium">{label}</span>
                    <span className="text-xs text-neutral-500">{hint}</span>
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className="text-brand-ink mb-2 text-sm font-medium dark:text-neutral-100">
                {t("lengthLabel")}
              </legend>
              <div className="flex flex-wrap gap-2">
                {lengths.map((seconds) => (
                  <button
                    key={seconds}
                    type="button"
                    aria-pressed={length === seconds}
                    disabled={busy}
                    onClick={() => {
                      setWantedLength(seconds);
                      clearResult();
                    }}
                    className={`${choice(length === seconds)} min-w-16 items-center`}
                  >
                    {lengthLabel(seconds)}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className="text-brand-ink mb-2 text-sm font-medium dark:text-neutral-100">
                {t("orderLabel")}
              </legend>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ["time", t("orderTime")],
                    ["name", t("orderName")],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={order === value}
                    disabled={busy}
                    onClick={() => {
                      setOrder(value);
                      clearResult();
                    }}
                    className={choice(order === value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="grid gap-3">
              {status.kind === "rendering" ? (
                <div className="flex flex-wrap items-center gap-3">
                  <progress
                    max={1}
                    value={status.share}
                    className="accent-brand-primary h-2 w-48"
                    aria-label={t("rendering", { percent: Math.round(status.share * 100) })}
                  />
                  <span className="text-sm" aria-live="polite">
                    {t("rendering", { percent: Math.round(status.share * 100) })}
                  </span>
                  <button
                    type="button"
                    onClick={() => abortRef.current?.abort()}
                    className={action("ghost", "sm")}
                  >
                    {t("cancel")}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void create()}
                  className={`${action(result ? "secondary" : "primary", "lg")} justify-self-start`}
                >
                  {t("create")}
                </button>
              )}
              {result && (
                <div className="grid gap-2">
                  <a
                    href={result.url}
                    download={result.fileName}
                    className={`${buttonClasses("primary", "lg")} justify-self-start`}
                  >
                    {t("download")}
                  </a>
                  <p className="text-sm text-neutral-600 dark:text-neutral-400">
                    {t("doneNote", { seconds: result.seconds })}
                  </p>
                </div>
              )}
            </div>
          </div>

          <figure className="grid justify-items-center gap-2">
            <canvas
              ref={canvasRef}
              aria-label={t("previewLabel")}
              role="img"
              className={`rounded-lg bg-black ${
                aspect === "9:16" ? "h-[60vh] max-h-[34rem] w-auto" : "w-full max-w-xl"
              }`}
            />
            <figcaption className="flex w-full max-w-xl items-center gap-2">
              <button
                type="button"
                onClick={() => setPlaying((p) => !p)}
                disabled={!canPreview}
                className={action("secondary", "sm")}
              >
                {playing ? t("pause") : t("play")}
              </button>
              <input
                ref={sliderRef}
                type="range"
                min={0}
                max={timeline.duration}
                step={0.05}
                defaultValue={0}
                aria-label={t("previewLabel")}
                onChange={(event) => {
                  timeRef.current = Number(event.target.value);
                }}
                className="accent-brand-primary min-w-0 flex-1"
              />
            </figcaption>
          </figure>
        </div>
      )}
    </div>
  );
}
