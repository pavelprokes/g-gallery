"use client";

import { useEffect, useRef, useState } from "react";
import { FORMS, pluralize } from "@/lib/czech-plural";
import {
  NOT_LOADED,
  useFaceFinder,
  useFaceScan,
  type ScanPhoto,
} from "@/components/admin/face-scan";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * Faces for the whole gallery, found on their own (docs/SOCIAL-VIDEO.md §4,
 * "The whole gallery"): whenever the gallery page holds photos without current
 * faces — a fresh upload refreshes it — the search starts in the face worker,
 * so the projection's camera, the video's suggestion and the photo check know
 * where the people are without anyone clicking. Pausing holds for this visit.
 */
export function GalleryFaceScan({
  galleryId,
  missing,
}: {
  galleryId: string;
  /** The gallery's stills without current faces, as the page last rendered. */
  missing: ScanPhoto[];
}) {
  const finder = useFaceFinder();
  // Photos this visit already settled — found, or failed and left for the
  // next visit — stay off the list until the page re-renders without them.
  const [settled, setSettled] = useState<ReadonlySet<string>>(new Set());
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const left = missing.filter((photo) => !settled.has(photo.id));
  const settle = (ids: string[]) => setSettled((prev) => new Set([...prev, ...ids]));
  const { scan, start, pause } = useFaceScan({
    galleryId,
    missing: () => left,
    finder,
    onSaved: (entries) => settle(entries.map((entry) => entry.photoId)),
  });

  const running = scan.kind === "running";
  const waiting = left.length > 0 && !paused && !running && scan.kind !== "failed";
  useEffect(() => {
    if (!waiting) return;
    const handedOver = left.map((photo) => photo.id);
    void start().then(() => {
      // Paused halfway, the rest is still to do once resumed.
      if (!pausedRef.current) settle(handedOver);
    });
    // `start` and `left` are new every render; `waiting` is what decides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting]);

  if (running) {
    return (
      <Card className="flex flex-wrap items-center gap-3 text-sm" role="status">
        <p className="min-w-0 flex-1">
          Hledám tváře na fotkách ({scan.done}/{scan.total}) — kvůli projekci, videu a kontrole
          fotek. Můžeš pracovat dál.
        </p>
        <progress className="w-40" value={scan.done} max={scan.total} />
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            pausedRef.current = true;
            setPaused(true);
            pause();
          }}
        >
          Pozastavit
        </Button>
      </Card>
    );
  }
  if (paused && left.length > 0) {
    return (
      <Card className="flex flex-wrap items-center gap-3 text-sm" role="status">
        <p className="min-w-0 flex-1">
          Hledání tváří je pozastavené — zbývá {pluralize(left.length, FORMS.photo)}.
        </p>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            pausedRef.current = false;
            setPaused(false);
          }}
        >
          Pokračovat
        </Button>
      </Card>
    );
  }
  if (scan.kind === "failed") {
    return (
      <Card className="text-admin-danger text-sm" role="status">
        Tváře se nepodařilo uložit. Zkusí se to znovu při dalším otevření galerie.
      </Card>
    );
  }
  if (scan.kind === "finished" && scan.failed > 0) {
    return (
      <Card className="text-admin-muted text-sm" role="status">
        Tváře jsou hledané. {pluralize(scan.failed, NOT_LOADED)}, zkusí se při dalším otevření
        galerie.
      </Card>
    );
  }
  return null;
}
