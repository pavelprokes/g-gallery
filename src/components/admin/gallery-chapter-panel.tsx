"use client";

import Link from "next/link";
import { useId } from "react";
import { deleteChapter, updateChapter } from "@/app/admin/chapter-actions";
import { AdminPhotoImage } from "@/components/admin/admin-photo-image";
import { TranslationFields } from "@/components/admin/translation-fields";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Hint, Input, Label } from "@/components/ui/input";
import type { ContentTranslations } from "@/lib/content-translations";
import { CHAPTER_PRESETS, MAX_CHAPTER_TITLE, presetTranslations } from "@/lib/gallery-chapters";

export interface AdminChapter {
  id: string;
  title: string;
  translations: ContentTranslations<"title">;
  count: number;
  /** The photo the chapter currently begins with; null when it has none. */
  firstPhoto: { objectKey: string; thumbObjectKey: string | null; fileName: string } | null;
}

/** Translations exactly as the preset supplied them — nothing to review. */
function isPresetOnly(chapter: AdminChapter): boolean {
  const preset = presetTranslations(chapter.title);
  return (
    !!preset &&
    chapter.translations.en?.title === preset.en &&
    chapter.translations.fr?.title === preset.fr
  );
}

/** The `<datalist>` both this panel and the timeline's "start here" forms offer. */
export const CHAPTER_PRESETS_LIST_ID = "chapter-presets";

export function ChapterPresetsList() {
  return (
    <datalist id={CHAPTER_PRESETS_LIST_ID}>
      {CHAPTER_PRESETS.map((preset) => (
        <option key={preset.cs} value={preset.cs} />
      ))}
    </datalist>
  );
}

/**
 * The gallery's chapters (docs/CHAPTERS.md): rename, translate, remove.
 * Starting one happens on a photo, in the timeline view — that is where the
 * photographer can see where the ceremony actually begins.
 */
export function GalleryChapterPanel({
  chapters,
  timelineHref,
  timelineActive,
}: {
  chapters: AdminChapter[];
  timelineHref: string;
  timelineActive: boolean;
}) {
  const fieldId = useId();

  return (
    <Card as="section">
      <CardTitle className="mb-3">Kapitoly</CardTitle>

      {chapters.length === 0 && (
        <p className="text-admin-muted mb-3 text-sm dark:text-neutral-400">
          Galerie zatím nemá kapitoly. Hosté ji procházejí jako jeden dlouhý proud fotek.
        </p>
      )}

      <ul className="space-y-2">
        {chapters.map((chapter) => (
          <li
            key={chapter.id}
            className="border-admin-border rounded-lg border p-3 dark:border-neutral-800"
          >
            <form action={updateChapter.bind(null, chapter.id)} className="space-y-3">
              <div className="flex flex-wrap items-end gap-3">
                <div className="relative size-14 shrink-0 overflow-hidden rounded bg-neutral-100 dark:bg-neutral-900">
                  {chapter.firstPhoto && (
                    <AdminPhotoImage
                      objectKey={chapter.firstPhoto.objectKey}
                      thumbObjectKey={chapter.firstPhoto.thumbObjectKey}
                      alt={chapter.firstPhoto.fileName}
                    />
                  )}
                </div>
                <div className="min-w-48 flex-1">
                  <Label htmlFor={`${fieldId}-${chapter.id}`} className="mb-1">
                    Název
                  </Label>
                  <Input
                    id={`${fieldId}-${chapter.id}`}
                    name="title"
                    list={CHAPTER_PRESETS_LIST_ID}
                    required
                    maxLength={MAX_CHAPTER_TITLE}
                    defaultValue={chapter.title}
                  />
                </div>
                <Button type="submit" variant="secondary" size="lg">
                  Uložit
                </Button>
                <Button
                  type="submit"
                  variant="destructive"
                  size="lg"
                  formAction={deleteChapter.bind(null, chapter.id)}
                  formNoValidate
                >
                  Odebrat
                </Button>
              </div>
              <p className="text-admin-muted text-xs dark:text-neutral-400">
                {chapter.firstPhoto
                  ? `${chapter.count} fotek · začíná fotkou ${chapter.firstPhoto.fileName}`
                  : "Prázdná — fotky, u kterých začínala, jsou smazané. Hostům se neukazuje."}
              </p>
              <TranslationFields
                fields={[
                  {
                    name: "title",
                    label: "Název",
                    maxLength: MAX_CHAPTER_TITLE,
                    original: chapter.title,
                  },
                ]}
                values={chapter.translations}
                open={isPresetOnly(chapter) ? false : undefined}
                note="Názvy z nabídky (Obřad, Hostina…) se přeloží samy."
              />
            </form>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!timelineActive && (
          <Link
            href={timelineHref}
            className="text-brand-primary-dark text-sm font-semibold underline underline-offset-4"
          >
            {chapters.length === 0 ? "Přidat kapitoly na časové ose" : "Upravit na časové ose"}
          </Link>
        )}
      </div>

      <Hint className="mt-2">
        Kapitola začíná u fotky, kterou vybereš na časové ose, a končí tam, kde začíná další. Hostům
        se nahoře v galerii ukážou jako záložky, přes které skočí rovnou na obřad nebo první tanec.
        Fotky přidané později se do kapitol zařadí samy podle času pořízení.
      </Hint>
    </Card>
  );
}
