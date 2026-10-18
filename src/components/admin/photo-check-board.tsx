"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import imageLoader from "@/lib/image-loader";
import { QUALITY } from "@/lib/image-sizes";
import { pluralize } from "@/lib/czech-plural";
import { checkPhoto } from "@/lib/photo-check";
import type { Face, PhotoFaces } from "@/lib/social-video/faces";
import { deletePhotos } from "@/app/admin/actions";
import { keepCheckedPhoto } from "@/app/admin/photo-check-actions";
import {
  FaceScanControls,
  PHOTO_GENITIVE,
  useFaceFinder,
  useFaceScan,
} from "@/components/admin/face-scan";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";

// docs/SOCIAL-VIDEO.md §4, "The photo check": the flags come from
// src/lib/photo-check.ts; this is their list and the two answers to each —
// keep it, or take it out of the gallery.

export interface CheckPhoto {
  id: string;
  objectKey: string;
  fileName: string;
  width: number;
  height: number;
  faces: PhotoFaces | null;
  /** The photographer already looked at its flags and kept it. */
  kept: boolean;
}

const FLAGGED = { one: "fotka", few: "fotky", many: "fotek" };
const FACES = { one: "tvář", few: "tváře", many: "tváří" };
/** A full-width variant the lightbox already uses — no new transformation. */
const FULL_WIDTH = 1920;

interface Flagged {
  photo: CheckPhoto;
  closed: Face[];
  soft: Face[];
}

export function PhotoCheckBoard({
  galleryId,
  photos: initial,
}: {
  galleryId: string;
  photos: CheckPhoto[];
}) {
  const [photos, setPhotos] = useState(initial);
  const [showKept, setShowKept] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const finder = useFaceFinder();
  const withFaces = photos.filter((p) => p.faces).length;
  const faceScan = useFaceScan({
    galleryId,
    finder,
    missing: () => photos.filter((p) => !p.faces),
    onSaved: (entries) => {
      const found = new Map(entries.map((e) => [e.photoId, e.faces]));
      setPhotos((prev) =>
        prev.map((p) => (found.has(p.id) ? { ...p, faces: found.get(p.id)! } : p)),
      );
    },
  });

  const flagged = useMemo(
    () =>
      photos.flatMap((photo): Flagged[] => {
        if (!photo.faces) return [];
        const { closed, soft } = checkPhoto(photo.faces.faces);
        return closed.length + soft.length > 0 ? [{ photo, closed, soft }] : [];
      }),
    [photos],
  );
  const open = flagged.filter((f) => !f.photo.kept);
  const kept = flagged.filter((f) => f.photo.kept);

  const keep = async (photo: CheckPhoto, value: boolean) => {
    setError(null);
    setBusy(photo.id);
    try {
      await keepCheckedPhoto(photo.id, value);
      setPhotos((prev) => prev.map((p) => (p.id === photo.id ? { ...p, kept: value } : p)));
    } catch {
      setError("Nepodařilo se to uložit. Zkus to znovu.");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (photo: CheckPhoto) => {
    if (!window.confirm(`Smazat ${photo.fileName} z galerie? Tohle nejde vrátit.`)) return;
    setError(null);
    setBusy(photo.id);
    try {
      await deletePhotos([photo.id]);
      setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
    } catch {
      setError("Fotku se nepodařilo smazat. Zkus to znovu.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardTitle>Tváře v galerii</CardTitle>
        <p className="mb-3">
          Tváře známe u {withFaces} z {pluralize(photos.length, PHOTO_GENITIVE)}.
        </p>
        <p className="text-admin-muted text-caption mb-3 dark:text-neutral-400">
          Kontrola hledá zavřené oči ve skupinách a neostré oči hlavních tváří. Polibek se zavřenýma
          očima nebo záměrně rozostřené pozadí jsou v pořádku — rozhodnutí je vždycky na tobě.
          Hledání běží v prohlížeči na pozadí, u 400 fotek pět až deset minut, a co najde, se ukládá
          průběžně.
        </p>
        <FaceScanControls
          scan={faceScan.scan}
          missing={photos.length - withFaces}
          onStart={() => void faceScan.start()}
          onPause={faceScan.pause}
          idleLabel={(count) => `Zkontrolovat (${count})`}
          doneLabel="Všechny fotky jsou zkontrolované"
          finishedText="Hotovo."
        />
      </Card>

      {error && (
        <Alert tone="danger" compact>
          {error}
        </Alert>
      )}

      <section aria-labelledby="check-open">
        <h2 id="check-open" className="mb-3 text-lg font-semibold">
          K prohlédnutí ({open.length})
        </h2>
        {withFaces === 0 ? (
          <p className="text-admin-muted dark:text-neutral-400">
            Nejdřív je potřeba najít tváře — klikni na „Zkontrolovat“.
          </p>
        ) : open.length === 0 ? (
          <p className="text-admin-muted dark:text-neutral-400">
            Nic k řešení: u zkontrolovaných fotek nikdo nemrká a oči jsou ostré.
          </p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {open.map((item) => (
              <FlaggedCard
                key={item.photo.id}
                item={item}
                busy={busy === item.photo.id}
                actions={
                  <>
                    <Button
                      size="sm"
                      disabled={busy !== null}
                      onClick={() => void keep(item.photo, true)}
                    >
                      Ponechat
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy !== null}
                      onClick={() => void remove(item.photo)}
                    >
                      Smazat z galerie
                    </Button>
                  </>
                }
              />
            ))}
          </ul>
        )}
      </section>

      {kept.length > 0 && (
        <section aria-labelledby="check-kept">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h2 id="check-kept" className="text-lg font-semibold">
              Ponechané ({pluralize(kept.length, FLAGGED)})
            </h2>
            <Button
              size="sm"
              variant="secondary"
              aria-expanded={showKept}
              onClick={() => setShowKept((v) => !v)}
            >
              {showKept ? "Skrýt" : "Zobrazit"}
            </Button>
          </div>
          {showKept && (
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {kept.map((item) => (
                <FlaggedCard
                  key={item.photo.id}
                  item={item}
                  busy={busy === item.photo.id}
                  actions={
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy !== null}
                      onClick={() => void keep(item.photo, false)}
                    >
                      Vrátit do kontroly
                    </Button>
                  }
                />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function FlaggedCard({
  item: { photo, closed, soft },
  busy,
  actions,
}: {
  item: Flagged;
  busy: boolean;
  actions: React.ReactNode;
}) {
  const shown = closed[0] ?? soft[0]!;
  const reasons = [
    closed.length > 0 &&
      (closed.length === 1 ? "Zavřené oči" : `Zavřené oči · ${pluralize(closed.length, FACES)}`),
    soft.length > 0 && "Neostré oči",
  ].filter(Boolean);
  return (
    <li
      className="border-admin-border flex gap-3 rounded-lg border p-3 dark:border-neutral-700"
      aria-busy={busy}
    >
      <FaceZoom photo={photo} face={shown} />
      <div className="min-w-0 flex-1 space-y-2">
        <p className="truncate font-medium" title={photo.fileName}>
          {photo.fileName}
        </p>
        <p className="text-caption">{reasons.join(" · ")}</p>
        <a
          href={imageLoader({ src: photo.objectKey, width: FULL_WIDTH, quality: QUALITY })}
          target="_blank"
          rel="noreferrer"
          className="text-caption text-brand-primary underline"
        >
          Celá fotka
        </a>
        <div className="flex flex-wrap gap-2">{actions}</div>
      </div>
    </li>
  );
}

/** The face that raised the flag, cut out of the photo: the reason, at a glance. */
function FaceZoom({ photo, face }: { photo: CheckPhoto; face: Face }) {
  const SIZE = 128;
  const side = Math.max(face.w * photo.width, face.h * photo.height) * 1.6;
  const k = SIZE / side;
  const width = Math.round(photo.width * k);
  const height = Math.round(photo.height * k);
  return (
    <div className="bg-brand-tint relative size-32 shrink-0 overflow-hidden rounded">
      <Image
        src={photo.objectKey}
        alt={`Tvář na fotce ${photo.fileName}`}
        width={width}
        height={height}
        sizes={`${width}px`}
        className="absolute max-w-none"
        style={{
          left: Math.round(SIZE / 2 - (face.x + face.w / 2) * photo.width * k),
          top: Math.round(SIZE / 2 - (face.y + face.h / 2) * photo.height * k),
        }}
      />
    </div>
  );
}
