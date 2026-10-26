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

/** Photos in a row that fail to load or search: past it, something is wrong
 * with the connection or the worker, not with the photos, and going on would
 * only fetch the rest of the library for nothing. */
const FAILURE_STREAK = 10;

type State =
  | { kind: "idle" }
  | { kind: "running"; gallery: number; done: number }
  | { kind: "paused"; gallery: number; done: number }
  | { kind: "stopped"; reason: "streak" | "save" }
  | { kind: "finished"; failed: number };

/**
 * Every gallery's photos that the face scan still owes something — faces never
 * searched, or the sharp part not yet looked for (docs/SOCIAL-VIDEO.md §4–§5) —
 * searched one gallery after another in this tab, with the same worker, fetch
 * and saving as the gallery page's own scan (`scanFaces`). Paused or closed
 * halfway, the saved part stays saved and the page lists only the rest next
 * time. Its own driver rather than `useFaceScan`, which holds one gallery.
 */
export function BulkFaceScan({ galleries }: { galleries: RescanGallery[] }) {
  const router = useRouter();
  const finder = useFaceFinder();
  const [state, setState] = useState<State>({ kind: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const total = galleries.reduce((sum, g) => sum + g.photos.length, 0);
  const before = (index: number) =>
    galleries.slice(0, index).reduce((sum, g) => sum + g.photos.length, 0);

  const run = async (fromGallery: number, skip: number) => {
    const controller = new AbortController();
    abortRef.current = controller;
    let failed = 0;
    let streak = 0;
    const counted = async <T,>(work: Promise<T>): Promise<T> => {
      try {
        const result = await work;
        streak = 0;
        return result;
      } catch (cause) {
        streak += 1;
        if (streak >= FAILURE_STREAK) controller.abort();
        throw cause;
      }
    };
    for (let index = fromGallery; index < galleries.length; index++) {
      const gallery = galleries[index]!;
      const offset = index === fromGallery ? skip : 0;
      setState({ kind: "running", gallery: index, done: before(index) + offset });
      try {
        const progress = await scanFaces({
          photos: gallery.photos.slice(offset),
          fetchPhoto: (photo) => counted(fetchForFaces(photo)),
          find: (blob) => counted(finder().find(blob)),
          save: (entries) => saveFaces(gallery.id, entries),
          onProgress: ({ done }) =>
            setState({ kind: "running", gallery: index, done: before(index) + offset + done }),
          signal: controller.signal,
        });
        failed += progress.failed;
        if (controller.signal.aborted) {
          setState(
            streak >= FAILURE_STREAK
              ? { kind: "stopped", reason: "streak" }
              : { kind: "paused", gallery: index, done: before(index) + offset + progress.done },
          );
          abortRef.current = null;
          return;
        }
      } catch (cause) {
        // Saving failed — the session, the database: not something the next
        // gallery would get past. What was saved before stays saved.
        console.warn("[g-gallery/faces] bulk scan: save failed", gallery.id, cause);
        setState({ kind: "stopped", reason: "save" });
        abortRef.current = null;
        router.refresh();
        return;
      }
    }
    abortRef.current = null;
    setState({ kind: "finished", failed });
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
  const canStart = state.kind === "idle" || state.kind === "finished" || state.kind === "stopped";
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
      {state.kind === "stopped" && (
        <p className="text-admin-danger text-sm" role="status">
          {state.reason === "streak"
            ? `Zastaveno: ${FAILURE_STREAK} fotek po sobě se nepodařilo načíst nebo projít. Zkontroluj připojení a zkus to znovu.`
            : "Zastaveno: výsledky se nepodařilo uložit. Co se uložilo předtím, zůstává; zkus to znovu."}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {canStart && (
          <Button onClick={() => void run(0, 0)}>
            {state.kind === "idle" ? "Přepočítat vše" : "Přepočítat zbytek"}
          </Button>
        )}
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
