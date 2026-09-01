"use client";

import { useId, useState } from "react";
import { createPromoCard, deletePromoCard, updatePromoCard } from "@/app/admin/promo-actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Hint, Input, Label, Select, Textarea } from "@/components/ui/input";
import { PROMO_THEMES, type PromoTheme } from "@/lib/promo-card";

export interface PromoCardValues {
  id: string;
  name: string;
  eyebrow: string | null;
  headline: string;
  body: string | null;
  ctaLabel: string | null;
  ctaUrl: string;
  theme: PromoTheme;
}

const THEME_LABELS: Record<PromoTheme, string> = {
  LIGHT: "Světlá (krémová)",
  DARK: "Tmavá (hnědá)",
  BRAND: "Terakota",
};

/**
 * Writing a promo card, with the tile itself rendered live beside the fields.
 *
 * The preview is the point: the card is laid out at the width the justified
 * grid happens to give it, so "does this text fit" is not a question the owner
 * can answer from a textarea. The preview box is deliberately sized like a
 * real phone tile (the tightest case), not like a desktop one.
 */
export function PromoCardForm({ card, onDone }: { card?: PromoCardValues; onDone?: () => void }) {
  const fieldId = useId();
  const [values, setValues] = useState({
    name: card?.name ?? "",
    eyebrow: card?.eyebrow ?? "",
    headline: card?.headline ?? "",
    body: card?.body ?? "",
    ctaLabel: card?.ctaLabel ?? "",
    ctaUrl: card?.ctaUrl ?? "",
    theme: card?.theme ?? ("LIGHT" as PromoTheme),
  });

  const set = (key: keyof typeof values) => (value: string) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  return (
    <Card
      as="form"
      action={async (formData: FormData) => {
        if (card) await updatePromoCard(card.id, formData);
        else await createPromoCard(formData);
        onDone?.();
      }}
      className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]"
    >
      <div className="space-y-3">
        <div>
          <Label htmlFor={`${fieldId}-name`}>Název karty</Label>
          <Input
            id={`${fieldId}-name`}
            name="name"
            required
            maxLength={80}
            value={values.name}
            onChange={(e) => set("name")(e.target.value)}
            placeholder="Web 2027"
          />
          <Hint>Jen pro tebe v administraci — klient ho nikdy neuvidí.</Hint>
        </div>

        <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
          <div>
            <Label htmlFor={`${fieldId}-eyebrow`}>Nadřádek</Label>
            <Input
              id={`${fieldId}-eyebrow`}
              name="eyebrow"
              maxLength={40}
              value={values.eyebrow}
              onChange={(e) => set("eyebrow")(e.target.value)}
              placeholder="Fotografie"
            />
          </div>
          <div>
            <Label htmlFor={`${fieldId}-headline`}>Nadpis</Label>
            <Input
              id={`${fieldId}-headline`}
              name="headline"
              required
              maxLength={120}
              value={values.headline}
              onChange={(e) => set("headline")(e.target.value)}
              placeholder="Fotil Pavel Prokeš"
            />
          </div>
        </div>

        <div>
          <Label htmlFor={`${fieldId}-body`}>Text</Label>
          <Textarea
            id={`${fieldId}-body`}
            name="body"
            maxLength={400}
            rows={3}
            value={values.body}
            onChange={(e) => set("body")(e.target.value)}
            placeholder="Svatby po celé republice i v zahraničí. Termíny na příští sezónu beru od ledna."
          />
          <Hint>
            Na mobilu se text skryje a zůstane jen nadpis a odkaz — dlaždice je tam úzká. Napiš
            proto nadpis tak, aby dával smysl i sám o sobě.
          </Hint>
        </div>

        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <div>
            <Label htmlFor={`${fieldId}-url`}>Odkaz</Label>
            <Input
              id={`${fieldId}-url`}
              name="ctaUrl"
              type="url"
              required
              maxLength={500}
              value={values.ctaUrl}
              onChange={(e) => set("ctaUrl")(e.target.value)}
              placeholder="https://svatebni-fotograf-cechy.cz"
            />
          </div>
          <div>
            <Label htmlFor={`${fieldId}-cta`}>Text odkazu</Label>
            <Input
              id={`${fieldId}-cta`}
              name="ctaLabel"
              maxLength={60}
              value={values.ctaLabel}
              onChange={(e) => set("ctaLabel")(e.target.value)}
              placeholder="(adresa webu)"
            />
          </div>
        </div>

        <div>
          <Label htmlFor={`${fieldId}-theme`}>Barva</Label>
          <Select
            id={`${fieldId}-theme`}
            name="theme"
            value={values.theme}
            onChange={(e) => set("theme")(e.target.value)}
            className="sm:max-w-56"
          >
            {PROMO_THEMES.map((theme) => (
              <option key={theme} value={theme}>
                {THEME_LABELS[theme]}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <Button type="submit">{card ? "Uložit změny" : "Vytvořit kartu"}</Button>
          {onDone && (
            <Button type="button" variant="secondary" onClick={onDone}>
              Zrušit
            </Button>
          )}
          {card && (
            <Button
              type="button"
              variant="destructive"
              className="ml-auto"
              onClick={async () => {
                if (!confirm(`Smazat kartu „${card.name}"? Zmizí ze všech galerií, kde je.`))
                  return;
                await deletePromoCard(card.id);
                onDone?.();
              }}
            >
              Smazat
            </Button>
          )}
        </div>
      </div>

      <div>
        <Label>Náhled na mobilu</Label>
        <PromoPreview values={values} />
        <Hint>Skutečná dlaždice v galerii — na širším displeji bude větší.</Hint>
      </div>
    </Card>
  );
}

/**
 * The tile as the guest sees it, at the tightest width it ever gets: half of a
 * 390 px phone, minus the grid gap. Rendered from the same container-query
 * type scale as `PromoTile` rather than importing it, because the real one
 * needs a translation context and a valid URL, and the preview must keep
 * working while the URL field is still half-typed.
 */
function PromoPreview({
  values,
}: {
  values: {
    eyebrow: string;
    headline: string;
    body: string;
    ctaLabel: string;
    ctaUrl: string;
    theme: PromoTheme;
  };
}) {
  const width = 193;
  const theme = PREVIEW_THEMES[values.theme] ?? PREVIEW_THEMES.LIGHT;
  const cta = values.ctaLabel.trim() || hostOf(values.ctaUrl) || "odkaz";

  return (
    <div
      className={`@container flex flex-col justify-between overflow-hidden ${theme.surface}`}
      style={{
        width,
        height: Math.round(width / 1.5),
        padding: "clamp(0.625rem, 5.5cqi, 1.75rem)",
      }}
    >
      <div className="min-h-0">
        {values.eyebrow && (
          <p
            className={`truncate font-semibold tracking-[0.14em] uppercase ${theme.eyebrow}`}
            style={{ fontSize: "clamp(0.5rem, 2.5cqi, 0.75rem)", lineHeight: 1.5 }}
          >
            {values.eyebrow}
          </p>
        )}
        <p
          className={`mt-[0.35em] font-semibold text-balance ${theme.headline}`}
          style={{ fontSize: "clamp(0.8125rem, 6.4cqi, 1.875rem)", lineHeight: 1.22 }}
        >
          {values.headline || "Nadpis karty"}
        </p>
      </div>
      <p
        className={`mt-[0.5em] flex shrink-0 items-center gap-[0.4em] font-semibold ${theme.cta}`}
        style={{ fontSize: "clamp(0.625rem, 3.2cqi, 0.9375rem)", lineHeight: 1.4 }}
      >
        <span className="truncate underline decoration-from-font underline-offset-[0.3em]">
          {cta}
        </span>
        <span aria-hidden>→</span>
      </p>
    </div>
  );
}

function hostOf(value: string): string | null {
  try {
    return new URL(value).host.replace(/^www\./, "");
  } catch {
    return null;
  }
}

const PREVIEW_THEMES: Record<PromoTheme, Record<string, string>> = {
  LIGHT: {
    surface: "bg-brand-tint",
    eyebrow: "text-brand-primary",
    headline: "text-brand-ink",
    cta: "text-brand-primary-dark",
  },
  DARK: {
    surface: "bg-brand-ink",
    eyebrow: "text-brand-border",
    headline: "text-brand-tint",
    cta: "text-brand-border",
  },
  BRAND: {
    surface: "bg-brand-primary",
    eyebrow: "text-white/80",
    headline: "text-white",
    cta: "text-white",
  },
};
