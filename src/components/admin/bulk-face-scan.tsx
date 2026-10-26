"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { FORMS, pluralize } from "@/lib/czech-plural";
import { scanFaces } from "@/lib/social-video/face-scan";
import { saveFaces } from "@/app/admin/social-video-actions";
import {
  fetchForFaces,
  NOT_LOADED,
  useFaceFinder,
  type ScanPhoto,
} from "@/components/admin/face-scan";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export interface RescanGallery {
  id: string;
  title: string;
  photos: ScanPhoto[];
}

type State =
  | { kind: "idle" }
  | { kind: "running"; gallery: number; done: number }
  | { kind: "paused"; gallery: number; done: number }
  | { kind: "finished"; failed: number };

/**
 * Every gallery's photos that the face scan still owes something — faces never
 * searched, or the sharp part not yet looked for (docs/SOCIAL-VIDEO.md §4–§5) —
 * searched one gallery after another in this tab, with the same worker and the
 * same saving the gallery page does on its own. Paused or closed halfway, the
 * saved part stays saved and the page lists only the rest next time.
 */
export function BulkFaceScan({ galleries }: { galleries: RescanGallery[] }) {
  const router = useRouter();
  const finder = useFaceFinder();
  const [state, setState] = useState<State>({ kind: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  const failedRef = useRef(0);
  useEffect(() => () => abortRef.current?.abort(), []);

  const total = galleries.reduce((sum, g) => sum + g.photos.length, 0);
  const before = (index: number) =>
    galleries.slice(0, index).reduce((sum, g) => sum + g.photos.length, 0);

  const run = async (fromGallery: number, skip: number) => {
    const controller = new AbortController();
    abortRef.current = controller;
    for (let index = fromGallery; index < galleries.length; index++) {
      const gallery = galleries[index]!;
      const offset = index === fromGallery ? skip : 0;
      const photos = gallery.photos.slice(offset);
      setState({ kind: "running", gallery: index, done: before(index) + offset });
      try {
        const { done, failed } = await scanFaces({
          photos,
          fetchPhoto: fetchForFaces,
          find: (blob) => finder().find(blob),
          save: (entries) => saveFaces(gallery.id, entries),
          onProgress: (progress) =>
            setState({
              kind: "running",
              gallery: index,
              done: before(index) + offset + progress.done,
            }),
          signal: controller.signal,
        });
        failedRef.current += failed;
        if (controller.signal.aborted) {
          setState({ kind: "paused", gallery: index, done: before(index) + offset + done });
          return;
        }
      } catch (cause) {
        // A save that failed leaves this gallery for the next run; the others go on.
        console.warn("[g-gallery/faces] bulk scan: gallery failed", gallery.id, cause);
        failedRef.current += photos.length;
      }
    }
    abortRef.current = null;
    setState({ kind: "finished", failed: failedRef.current });
    router.refresh();
  };

  if (total === 0) {
    return (
      <Card className="text-sm" role="status">
        Všechny fotky jsou přepočítané. Není co dělat.
      </Card>
    );
  }

  const current = state.kind === "running" || state.kind === "paused" ? state : null;
  return (
    <Card className="space-y-4">
      <p className="text-sm">
        K přepočtu: {pluralize(total, FORMS.photo)}, {pluralize(galleries.length, FORMS.gallery)}.
        Běží v tomto okně — nech ho otevřené, dokud nedoběhne. Co se uloží, zůstane uložené, i když
        okno zavřeš dřív.
      </p>
      {current && (
        <div className="space-y-2" role="status">
          <p className="text-sm">
            {galleries[current.gallery]!.title} — celkem {current.done}/{total}
            {state.kind === "paused" && " (pozastaveno)"}
          </p>
          <progress className="w-full" value={current.done} max={total} />
        </div>
      )}
      {state.kind === "finished" && (
        <p className="text-sm" role="status">
          Hotovo.
          {state.failed > 0 && ` ${pluralize(state.failed, NOT_LOADED)}, zkusí se příště.`}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {state.kind === "idle" && <Button onClick={() => void run(0, 0)}>Přepočítat vše</Button>}
        {state.kind === "running" && (
          <Button variant="secondary" onClick={() => abortRef.current?.abort()}>
            Pozastavit
          </Button>
        )}
        {state.kind === "paused" && (
          <Button onClick={() => void run(state.gallery, state.done - before(state.gallery))}>
            Pokračovat
          </Button>
        )}
      </div>
    </Card>
  );
}
