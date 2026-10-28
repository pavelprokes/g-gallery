"use client";

import { parse, type Font } from "opentype.js";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Hint, Input, Label, Select } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import {
  DEFAULT_ENGRAVING_FONT,
  ENGRAVING_FONTS,
  engravingFont,
  type EngravingFontId,
} from "@/lib/engraving/fonts";
import {
  JOINERS,
  PLATE_DPI,
  PLATE_HEIGHT,
  PLATE_WIDTH,
  coupleLine,
  framePathData,
  layoutPlate,
  plateSvg,
  setJpegDpi,
  type Couple,
} from "@/lib/engraving/plate";
import {
  DEFAULT_MONOGRAM_WIDTH_MM,
  MAX_MONOGRAM_WIDTH_MM,
  MIN_MONOGRAM_WIDTH_MM,
  MONOGRAM_DPI,
  MONOGRAM_LETTER_SPACING,
  clampMonogramWidth,
  initialOf,
  layoutMonogram,
  monogramSvg,
  monogramText,
} from "@/lib/engraving/monogram";
import { slugify } from "@/lib/gallery-slug";

const FRAME_URL = "/vendor/engraving/leaf-frame.svg";

// One download per file for the life of the tab: switching back to a face
// already seen is instant, and nothing is fetched twice.
const fontCache = new Map<string, Promise<Font>>();
let frameCache: Promise<string> | null = null;

function loadFont(file: string): Promise<Font> {
  let font = fontCache.get(file);
  if (!font) {
    font = fetch(file)
      .then((response) => {
        if (!response.ok) throw new Error(`${file}: ${response.status}`);
        return response.arrayBuffer();
      })
      .then((buffer) => parse(buffer));
    font.catch(() => fontCache.delete(file));
    fontCache.set(file, font);
  }
  return font;
}

function loadFrame(): Promise<string> {
  frameCache ??= fetch(FRAME_URL)
    .then((response) => {
      if (!response.ok) throw new Error(`${FRAME_URL}: ${response.status}`);
      return response.text();
    })
    .then(framePathData)
    .catch((error: unknown) => {
      frameCache = null;
      throw error;
    });
  return frameCache;
}

type Loaded = { namesFont: Font; dateFont: Font; frameD: string };

function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * An outlined SVG on white as a JPG of the given pixel size, its resolution
 * written into the header so the file opens at its physical size.
 */
async function svgJpeg(svg: string, width: number, height: number, dpi: number): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2d context");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.95),
    );
    if (!blob) throw new Error("toBlob returned null");
    const bytes = setJpegDpi(new Uint8Array(await blob.arrayBuffer()), dpi);
    return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "image/jpeg" });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * The engraving plate generator (docs/ENGRAVING.md): the photographer's leaf
 * frame with the couple's names and date, exported as outlined SVG for the
 * laser, as SVG with live text for Affinity, and as JPG at the template's size.
 * Everything happens in the browser — the fonts and the frame are static files,
 * and nothing is uploaded or stored.
 */
export function EngravingPlate({
  initialCouple,
  initialDate,
  isoDate,
}: {
  initialCouple: Couple;
  initialDate: string;
  /** For the file name; null when the wedding has no date. */
  isoDate: string | null;
}) {
  const [couple, setCouple] = useState<Couple>(initialCouple);
  const [date, setDate] = useState(initialDate);
  const [fontId, setFontId] = useState<EngravingFontId>(DEFAULT_ENGRAVING_FONT);
  const [uppercase, setUppercase] = useState(false);
  const [scalePercent, setScalePercent] = useState(100);
  const [loaded, setLoaded] = useState<{ fontId: EngravingFontId; value: Loaded } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const meta = engravingFont(fontId);

  useEffect(() => {
    let cancelled = false;
    const dateMeta = meta.dateFont ? engravingFont(meta.dateFont) : meta;
    Promise.all([loadFont(meta.file), loadFont(dateMeta.file), loadFrame()])
      .then(([namesFont, dateFont, frameD]) => {
        if (cancelled) return;
        setLoaded({ fontId: meta.id, value: { namesFont, dateFont, frameD } });
        setLoadError(null);
      })
      .catch(() => {
        if (!cancelled)
          setLoadError("Písmo nebo rámeček se nepodařilo načíst. Zkus obnovit stránku.");
      });
    return () => {
      cancelled = true;
    };
  }, [meta]);

  const names = coupleLine(couple);

  const plate = useMemo(() => {
    if (!loaded) return null;
    const { namesFont, dateFont, frameD } = loaded.value;
    const fontMeta = engravingFont(loaded.fontId);
    const layout = layoutPlate({
      namesFont,
      dateFont,
      names,
      date,
      uppercase,
      namesScale: scalePercent / 100,
      fontNamesScale: fontMeta.namesScale,
    });
    const dateMeta = fontMeta.dateFont ? engravingFont(fontMeta.dateFont) : fontMeta;
    return {
      outlines: plateSvg(layout, frameD),
      text: plateSvg(layout, frameD, "text", {
        names: { family: fontMeta.family, weight: fontMeta.weight },
        date: { family: dateMeta.family, weight: dateMeta.weight },
      }),
      stale: loaded.fontId !== fontId,
    };
  }, [loaded, fontId, names, date, uppercase, scalePercent]);

  // A font still loading would export the previous face under the new one's name.
  const ready = plate !== null && !plate.stale;
  const fileBase = `gravirovani-${slugify(names) || "svatba"}${isoDate ? `-${isoDate}` : ""}`;
  const dateMeta = meta.dateFont ? engravingFont(meta.dateFont) : meta;
  const fontFiles = meta.dateFont ? [meta, dateMeta] : [meta];

  async function downloadJpeg() {
    if (!plate || !ready) return;
    setBusy(true);
    try {
      download(
        await svgJpeg(plate.outlines, PLATE_WIDTH, PLATE_HEIGHT, PLATE_DPI),
        `${fileBase}.jpg`,
      );
    } finally {
      setBusy(false);
    }
  }

  const setName = (key: keyof Couple) => (value: string) =>
    setCouple((current) => ({ ...current, [key]: value }));

  return (
    <div className="space-y-10">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <Card as="section" className="space-y-4 self-start">
          <CardTitle className="mb-0">Text</CardTitle>
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-2">
            <div>
              <Label htmlFor="engrave-first">První jméno</Label>
              <Input
                id="engrave-first"
                value={couple.first}
                onChange={(event) => setName("first")(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="engrave-joiner" className="sr-only">
                Spojka
              </Label>
              <Select
                id="engrave-joiner"
                value={couple.joiner}
                onChange={(event) => setName("joiner")(event.target.value)}
                className="w-16"
              >
                {JOINERS.map((joiner) => (
                  <option key={joiner} value={joiner}>
                    {joiner}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="engrave-second">Druhé jméno</Label>
              <Input
                id="engrave-second"
                value={couple.second}
                onChange={(event) => setName("second")(event.target.value)}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="engrave-date">Datum</Label>
            <Input
              id="engrave-date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              placeholder="22. 8. 2026"
            />
            <Hint>Napiš ho, jak má být vyryté. Prázdné pole datum vynechá.</Hint>
          </div>

          <CardTitle className="mt-2 mb-0">Písmo</CardTitle>
          <div>
            <Label htmlFor="engrave-font">Font</Label>
            <Select
              id="engrave-font"
              value={fontId}
              onChange={(event) => setFontId(event.target.value as EngravingFontId)}
            >
              {ENGRAVING_FONTS.map((font) => (
                <option key={font.id} value={font.id}>
                  {font.label}
                </option>
              ))}
            </Select>
            {meta.dateFont && (
              <Hint>Datum zůstává v {dateMeta.family} — psací číslice se gravírují špatně.</Hint>
            )}
          </div>
          <div>
            <Label htmlFor="engrave-scale">Velikost jmen: {scalePercent} %</Label>
            <input
              id="engrave-scale"
              type="range"
              min={70}
              max={120}
              step={5}
              value={scalePercent}
              onChange={(event) => setScalePercent(Number(event.target.value))}
              className="accent-brand-primary w-full"
            />
            <Hint>Dlouhá jména se zmenší sama, aby nepřesáhla linky.</Hint>
          </div>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={uppercase}
              onChange={(event) => setUppercase(event.target.checked)}
              className="accent-brand-primary size-4"
            />
            Jména velkými písmeny
          </label>
        </Card>

        <div className="space-y-4">
          {loadError && <Alert>{loadError}</Alert>}
          <div
            className={`border-admin-border mx-auto w-full max-w-xl overflow-hidden rounded-xl border bg-white transition-opacity dark:border-neutral-800 [&>svg]:block [&>svg]:h-auto [&>svg]:w-full ${
              !plate || plate.stale ? "opacity-60" : ""
            }`}
            style={{ aspectRatio: `${PLATE_WIDTH} / ${PLATE_HEIGHT}` }}
            role="img"
            aria-label={`Náhled gravírování: ${names}${date ? `, ${date}` : ""}`}
            // Our own markup: outlines and a fixed frame, no user text survives as text.
            dangerouslySetInnerHTML={plate ? { __html: plate.outlines } : undefined}
          />

          <div className="mx-auto flex max-w-xl flex-wrap gap-2">
            <Button
              disabled={!ready}
              onClick={() =>
                plate &&
                download(new Blob([plate.outlines], { type: "image/svg+xml" }), `${fileBase}.svg`)
              }
            >
              Stáhnout SVG (křivky)
            </Button>
            <Button
              variant="secondary"
              disabled={!ready || busy}
              onClick={() => void downloadJpeg()}
            >
              {busy ? "Připravuji JPG…" : "Stáhnout JPG"}
            </Button>
            <Button
              variant="secondary"
              disabled={!ready}
              onClick={() =>
                plate &&
                download(new Blob([plate.text], { type: "image/svg+xml" }), `${fileBase}-text.svg`)
              }
            >
              SVG s textem
            </Button>
          </div>
          <div className="text-admin-muted mx-auto max-w-xl space-y-1 text-sm dark:text-neutral-400">
            <p>
              Ořezané do krajů: {PLATE_WIDTH} × {PLATE_HEIGHT} px při {PLATE_DPI} dpi, kresba ve
              stejném měřítku jako předloha. SVG s&nbsp;křivkami gravírka přečte bez fontu
              a&nbsp;nemá pozadí, JPG je na bílé.
            </p>
            <p>
              SVG s textem jde dál upravovat v Affinity, jen musíš mít písmo nainstalované:{" "}
              {fontFiles.map((font, index) => (
                <span key={font.id}>
                  {index > 0 && ", "}
                  <a href={font.file} download className="underline">
                    {font.family}
                  </a>
                </span>
              ))}
              .
            </p>
          </div>
        </div>
      </div>
      <EngravingMonogram first={couple.first} second={couple.second} isoDate={isoDate} />
    </div>
  );
}

/**
 * The couple's initials, "A&P", at an exact width in millimetres
 * (docs/ENGRAVING.md §Monogram). Follows the names above until the
 * photographer types an initial of their own — "Ch", say, which a first
 * letter cannot guess.
 */
function EngravingMonogram({
  first,
  second,
  isoDate,
}: {
  first: string;
  second: string;
  isoDate: string | null;
}) {
  const [fontId, setFontId] = useState<EngravingFontId>(DEFAULT_ENGRAVING_FONT);
  const [widthText, setWidthText] = useState(String(DEFAULT_MONOGRAM_WIDTH_MM));
  const [overrides, setOverrides] = useState<[string | null, string | null]>([null, null]);
  const [loaded, setLoaded] = useState<{ fontId: EngravingFontId; font: Font } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const meta = engravingFont(fontId);

  useEffect(() => {
    let cancelled = false;
    loadFont(meta.file)
      .then((font) => {
        if (cancelled) return;
        setLoaded({ fontId: meta.id, font });
        setLoadError(null);
      })
      .catch(() => {
        if (!cancelled) setLoadError("Písmo se nepodařilo načíst. Zkus obnovit stránku.");
      });
    return () => {
      cancelled = true;
    };
  }, [meta]);

  const initials: [string, string] = [
    overrides[0] ?? initialOf(first),
    overrides[1] ?? initialOf(second),
  ];
  const text = monogramText(initials[0], initials[1]);
  const widthMm = clampMonogramWidth(Number(widthText.replace(",", ".")));

  const result = useMemo(() => {
    if (!loaded) return null;
    const monogram = layoutMonogram({
      font: loaded.font,
      text,
      widthMm,
      letterSpacing: engravingFont(loaded.fontId).script ? 0 : MONOGRAM_LETTER_SPACING,
    });
    return monogram && { monogram, svg: monogramSvg(monogram), stale: loaded.fontId !== fontId };
  }, [loaded, fontId, text, widthMm]);

  const ready = result !== null && !result.stale;
  const fileBase = `monogram-${slugify(text) || "svatba"}${isoDate ? `-${isoDate}` : ""}`;
  const size = result
    ? `${formatMm(result.monogram.widthMm)} × ${formatMm(result.monogram.heightMm)} mm`
    : null;

  const setInitial = (index: 0 | 1) => (value: string) =>
    setOverrides((current) => {
      const next: [string | null, string | null] = [...current];
      next[index] = value;
      return next;
    });

  async function downloadJpeg() {
    if (!result || !ready) return;
    setBusy(true);
    try {
      const { monogram, svg } = result;
      download(
        await svgJpeg(
          svg,
          Math.round(monogram.widthPx),
          Math.round(monogram.heightPx),
          MONOGRAM_DPI,
        ),
        `${fileBase}.jpg`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="monogram-title" className="space-y-4">
      <h2 id="monogram-title" className="text-brand-ink text-xl font-bold dark:text-neutral-100">
        Monogram
      </h2>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <Card className="space-y-4 self-start">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-2">
            <div>
              <Label htmlFor="monogram-first">První iniciála</Label>
              <Input
                id="monogram-first"
                value={initials[0]}
                maxLength={3}
                onChange={(event) => setInitial(0)(event.target.value)}
              />
            </div>
            <span aria-hidden className="text-brand-ink pb-2.5 text-lg dark:text-neutral-100">
              &amp;
            </span>
            <div>
              <Label htmlFor="monogram-second">Druhá iniciála</Label>
              <Input
                id="monogram-second"
                value={initials[1]}
                maxLength={3}
                onChange={(event) => setInitial(1)(event.target.value)}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="monogram-width">Šířka v mm</Label>
            <Input
              id="monogram-width"
              type="number"
              inputMode="decimal"
              min={MIN_MONOGRAM_WIDTH_MM}
              max={MAX_MONOGRAM_WIDTH_MM}
              step={0.5}
              value={widthText}
              onChange={(event) => setWidthText(event.target.value)}
            />
            <Hint>Šířka samotných písmen, výška se dopočítá.</Hint>
          </div>
          <div>
            <Label htmlFor="monogram-font">Font</Label>
            <Select
              id="monogram-font"
              value={fontId}
              onChange={(event) => setFontId(event.target.value as EngravingFontId)}
            >
              {ENGRAVING_FONTS.map((font) => (
                <option key={font.id} value={font.id}>
                  {font.label}
                </option>
              ))}
            </Select>
          </div>
        </Card>

        <div className="space-y-4">
          {loadError && <Alert>{loadError}</Alert>}
          <div
            className={`border-admin-border mx-auto flex w-full max-w-xl items-center justify-center rounded-xl border bg-white p-8 transition-opacity dark:border-neutral-800 [&>svg]:block [&>svg]:h-auto [&>svg]:max-h-48 [&>svg]:w-full [&>svg]:max-w-sm ${
              !ready ? "opacity-60" : ""
            }`}
            role="img"
            aria-label={`Náhled monogramu: ${text || "bez iniciál"}${size ? `, ${size}` : ""}`}
            // Our own markup: an outline, no user text survives as text.
            dangerouslySetInnerHTML={result ? { __html: result.svg } : undefined}
          />
          <div className="mx-auto flex max-w-xl flex-wrap gap-2">
            <Button
              disabled={!ready}
              onClick={() =>
                result &&
                download(new Blob([result.svg], { type: "image/svg+xml" }), `${fileBase}.svg`)
              }
            >
              Stáhnout SVG (křivky)
            </Button>
            <Button
              variant="secondary"
              disabled={!ready || busy}
              onClick={() => void downloadJpeg()}
            >
              {busy ? "Připravuji JPG…" : "Stáhnout JPG"}
            </Button>
          </div>
          <p className="text-admin-muted mx-auto max-w-xl text-sm dark:text-neutral-400">
            {size ? <>Ořezané do krajů: {size}. </> : null}
            SVG má rozměr v&nbsp;milimetrech, gravírka ho načte ve správné velikosti. JPG má{" "}
            {MONOGRAM_DPI} dpi.
          </p>
        </div>
      </div>
    </section>
  );
}

/** "14,2" — one decimal, Czech comma. */
function formatMm(mm: number): string {
  return (Math.round(mm * 10) / 10).toLocaleString("cs-CZ");
}
