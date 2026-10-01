"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { deleteChapter, updateChapter } from "@/app/admin/chapter-actions";
import { AdminPhotoImage } from "@/components/admin/admin-photo-image";
import { TranslationFields } from "@/components/admin/translation-fields";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/copy-button";
import { Card, CardTitle } from "@/components/ui/card";
import { Hint, Input, Label } from "@/components/ui/input";
import type { ContentTranslations } from "@/lib/content-translations";
import { FORMS, pluralize } from "@/lib/czech-plural";
import { CHAPTER_PRESETS, MAX_CHAPTER_TITLE, presetTranslations } from "@/lib/gallery-chapters";

export interface AdminChapter {
  id: string;
  /** The link hash, `#obrad` — frozen at creation (docs/CHAPTERS.md §Links). */
  anchor: string;
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

/**
 * "Tady začíná kapitola" on one photo of the timeline. The form — a field and
 * a row of name buttons — is only rendered once opened: the timeline shows it
 * on every photo, and a 700-photo wedding would otherwise ship 700 of them.
 */
export function StartChapterDetails({
  summary,
  defaultTitle,
  action,
}: {
  summary: string;
  /** The chapter's title, when this photo already starts one (a rename). */
  defaultTitle?: string;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details className="text-sm" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="text-brand-primary-dark cursor-pointer font-semibold dark:text-neutral-200">
        {summary}
      </summary>
      {open && (
        <form action={action} className="mt-1 space-y-2">
          <ChapterTitleField
            placeholder="Obřad"
            label="Název kapitoly"
            defaultValue={defaultTitle}
          />
          <Button type="submit" size="sm">
            Uložit
          </Button>
        </form>
      )}
    </details>
  );
}

/**
 * A chapter's title: a text field, and under it the usual chapter names as
 * buttons that fill it in. Replaces a `<datalist>`, which a phone either never
 * opens (iOS offers it only above the keyboard, once typing has started) or
 * opens under the thumb — and the timeline, where chapters are started, is
 * exactly where the photographer is on a phone.
 */
export function ChapterTitleField({
  id,
  defaultValue = "",
  placeholder,
  label,
}: {
  id?: string;
  defaultValue?: string;
  placeholder?: string;
  /** For a field with no visible `<Label>`. */
  label?: string;
}) {
  const [value, setValue] = useState(defaultValue);
  return (
    <div className="min-w-0">
      <Input
        id={id}
        name="title"
        required
        maxLength={MAX_CHAPTER_TITLE}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        autoComplete="off"
      />
      <div role="group" aria-label="Běžné názvy kapitol" className="mt-2 flex flex-wrap gap-1.5">
        {CHAPTER_PRESETS.map((preset) => {
          const chosen = value.trim() === preset.cs;
          return (
            <button
              key={preset.cs}
              type="button"
              aria-pressed={chosen}
              onClick={() => setValue(preset.cs)}
              className={`min-h-9 rounded-full border px-3 text-sm transition-colors ${
                chosen
                  ? "border-brand-primary bg-brand-tint text-brand-primary-dark font-semibold"
                  : "border-admin-border hover:border-brand-primary text-brand-ink bg-white dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
              }`}
            >
              {preset.cs}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The gallery's chapters (docs/CHAPTERS.md): rename, translate, remove.
 * Starting one happens on a photo, in the timeline view — that is where the
 * photographer can see where the ceremony actually begins.
 */
export function GalleryChapterPanel({
  chapters,
  shareUrl,
  timelineHref,
  timelineActive,
}: {
  chapters: AdminChapter[];
  /** The gallery's live share link, or null when it has none to link through. */
  shareUrl: string | null;
  timelineHref: string;
  timelineActive: boolean;
}) {
  const fieldId = useId();
  // Two chapters with one name are two identical tabs for the guests — an
  // empty chapter shows no tab, so it does not count.
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const chapter of chapters) {
    if (!chapter.firstPhoto) continue;
    const key = chapter.title.trim().toLocaleLowerCase("cs");
    if (seen.has(key)) duplicated.add(key);
    seen.add(key);
  }

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
              <div className="flex items-start gap-3">
                <div className="relative size-14 shrink-0 overflow-hidden rounded bg-neutral-100 dark:bg-neutral-900">
                  {chapter.firstPhoto && (
                    <AdminPhotoImage
                      objectKey={chapter.firstPhoto.objectKey}
                      thumbObjectKey={chapter.firstPhoto.thumbObjectKey}
                      alt={chapter.firstPhoto.fileName}
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <Label htmlFor={`${fieldId}-${chapter.id}`} className="mb-1">
                    Název
                  </Label>
                  <ChapterTitleField
                    // Remounted when the saved title changes (a rename on the
                    // timeline), so the field never saves a stale one back.
                    key={chapter.title}
                    id={`${fieldId}-${chapter.id}`}
                    defaultValue={chapter.title}
                  />
                  {chapter.firstPhoto &&
                    duplicated.has(chapter.title.trim().toLocaleLowerCase("cs")) && (
                      <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
                        Stejný název má i jiná kapitola — hosté uvidí dvě stejné záložky.
                      </p>
                    )}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
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
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-admin-muted text-xs dark:text-neutral-400">
                  {chapter.firstPhoto
                    ? `${pluralize(chapter.count, FORMS.photo)} · začíná fotkou ${chapter.firstPhoto.fileName}`
                    : "Prázdná — fotky, u kterých začínala, jsou smazané. Hostům se neukazuje."}
                </p>
                {shareUrl && chapter.firstPhoto && (
                  <CopyButton
                    value={`${shareUrl}#${chapter.anchor}`}
                    label={`Kopírovat odkaz rovnou na kapitolu ${chapter.title}`}
                    // A chapter from before slugs anchors on its id — frozen, but
                    // not worth showing.
                    text={
                      chapter.anchor === chapter.id
                        ? "Odkaz na kapitolu"
                        : `Odkaz #${chapter.anchor}`
                    }
                  />
                )}
              </div>
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
        Fotky přidané později se do kapitol zařadí samy podle pořadí galerie (názvu souboru nebo
        času pořízení).
      </Hint>
    </Card>
  );
}
