"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import imageLoader from "@/lib/image-loader";
import { QUALITY } from "@/lib/image-sizes";
import { FORMS, pluralize } from "@/lib/czech-plural";
import { FORMATS, sourceWidth, type VideoFormat } from "@/lib/social-video/camera";
import { createFaceFinder, type FaceFinder } from "@/lib/social-video/detect";
import { scanFaces } from "@/lib/social-video/face-scan";
import type { PhotoFaces } from "@/lib/social-video/faces";
import { fetchPhotoBytes } from "@/lib/social-video/slide-images";
import { saveFaces } from "@/app/admin/social-video-actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

// Faces for a whole gallery on the photographer's click (docs/SOCIAL-VIDEO.md
// §4, "The whole gallery") — shared by the video page and the photo check.

/** "… se nenačetla": the verb agrees with the count. */
export const NOT_LOADED = {
  one: "fotka se nenačetla",
  few: "fotky se nenačetly",
  many: "fotek se nenačetlo",
};
/** After "z": the genitive. */
export const PHOTO_GENITIVE = { one: "fotky", few: "fotek", many: "fotek" };

export interface ScanPhoto {
  id: string;
  objectKey: string;
  width: number;
  height: number;
}

export type Scan =
  | { kind: "idle" }
  | { kind: "running"; done: number; total: number }
  | { kind: "finished"; failed: number }
  | { kind: "failed" };

/** The transform URL a video of `format` fetches a photo at. */
export function sourceUrl(
  objectKey: string,
  size: { width: number; height: number },
  format: VideoFormat,
) {
  return imageLoader({ src: objectKey, width: sourceWidth(size, format), quality: QUALITY });
}

/** A photo's bytes at the size a 9:16 video fetches it — the default format,
 * so its render finds the transform already cached. */
function fetchForFaces(photo: ScanPhoto): Promise<Blob> {
  return fetchPhotoBytes(sourceUrl(photo.objectKey, photo, FORMATS["9:16"]));
}

/** One face worker for a page, started on first use and stopped with it. */
export function useFaceFinder(): () => FaceFinder {
  const finderRef = useRef<FaceFinder | null>(null);
  useEffect(
    () => () => {
      finderRef.current?.close();
      finderRef.current = null;
    },
    [],
  );
  return useCallback(() => (finderRef.current ??= createFaceFinder()), []);
}

/**
 * Searches every photo without faces, saving as it goes. `onSaved` hands the
 * page each saved batch, so what it shows is always what is stored.
 */
export function useFaceScan({
  galleryId,
  missing,
  finder,
  onSaved,
}: {
  galleryId: string;
  /** The photos without current faces, at the moment of the click. */
  missing: () => ScanPhoto[];
  finder: () => FaceFinder;
  onSaved: (entries: { photoId: string; faces: PhotoFaces }[]) => void;
}) {
  const [scan, setScan] = useState<Scan>({ kind: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const start = async () => {
    const photos = missing();
    if (photos.length === 0) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setScan({ kind: "running", done: 0, total: photos.length });
    try {
      const { failed } = await scanFaces({
        photos,
        fetchPhoto: fetchForFaces,
        find: (blob) => finder().find(blob),
        save: (entries) => saveFaces(galleryId, entries),
        onSaved,
        onProgress: ({ done, total }) => setScan({ kind: "running", done, total }),
        signal: controller.signal,
      });
      setScan(controller.signal.aborted ? { kind: "idle" } : { kind: "finished", failed });
    } catch (cause) {
      console.warn("[g-gallery/faces] face scan failed", cause);
      setScan({ kind: "failed" });
    } finally {
      abortRef.current = null;
    }
  };

  return { scan, start, pause: () => abortRef.current?.abort() };
}

/** The scan's button, progress and outcome. */
export function FaceScanControls({
  scan,
  missing,
  onStart,
  onPause,
  idleLabel,
  doneLabel,
  finishedText,
}: {
  scan: Scan;
  missing: number;
  onStart: () => void;
  onPause: () => void;
  /** The button, given how many photos it will search. */
  idleLabel: (count: string) => string;
  /** The button when there is nothing left to search. */
  doneLabel: string;
  finishedText: string;
}) {
  return (
    <>
      {scan.kind === "running" ? (
        <div className="space-y-2" role="status">
          <p>
            Hledám tváře {scan.done}/{scan.total}
          </p>
          <progress className="w-full" value={scan.done} max={scan.total} />
          <Button size="sm" variant="secondary" onClick={onPause}>
            Pozastavit
          </Button>
        </div>
      ) : (
        <Button variant="secondary" disabled={missing === 0} onClick={onStart}>
          {missing === 0 ? doneLabel : idleLabel(pluralize(missing, FORMS.photo))}
        </Button>
      )}
      {scan.kind === "finished" && (
        <p className="text-caption mt-3" role="status">
          {finishedText}
          {scan.failed > 0 &&
            ` ${pluralize(scan.failed, NOT_LOADED)}, zkusí se při dalším hledání.`}
        </p>
      )}
      {scan.kind === "failed" && (
        <Alert tone="danger" compact className="mt-3">
          Tváře se nepodařilo uložit — zkus hledání spustit znovu, naváže, kde skončilo.
        </Alert>
      )}
    </>
  );
}
